import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { date: string | null; ts: number }>();
const CONTRACT = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const LAUNCH_TIME = 1742342400; // 19 Mar 2025 00:00:00 UTC (known launch)

const BLOCKS_PER_DAY = 28800;

const BATCH_SIZE = 80000;

async function fetchRpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(BSC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getBlockByTimestamp(targetTs: number): Promise<number | null> {
  const latestResp = await fetchRpc('eth_blockNumber', []);
  if (!latestResp?.result) return null;
  const latestNum = parseInt(latestResp.result, 16);
  const blockResp = await fetchRpc('eth_getBlockByNumber', [latestResp.result, false]);
  if (!blockResp?.result) return null;
  const latestTs = parseInt(blockResp.result.timestamp, 16);
  if (targetTs >= latestTs) return latestNum;

  const estimated = Math.floor((targetTs - LAUNCH_TIME) / 3);
  let lo = Math.max(0, estimated - BLOCKS_PER_DAY);
  let hi = latestNum;

  for (let i = 0; i < 25; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const block = await fetchRpc('eth_getBlockByNumber', ['0x' + mid.toString(16), false]);
    if (!block?.result) return null;
    const ts = parseInt(block.result.timestamp, 16);
    if (ts < targetTs) lo = mid + 1;
    else hi = mid;
    if (lo >= hi) break;
  }
  return lo;
}

async function findFirstEventBlock(wallet: string, startBlock: number, endBlock: number): Promise<number | null> {
  const addr = wallet.toLowerCase().replace('0x', '');
  const padded = '0x' + addr.padStart(64, '0');
  const contractTo = '0x000000000000000000000000' + CONTRACT.toLowerCase().replace('0x', '');
  let earliestBlock: number | null = null;

  const contracts = [CONTRACT, USDT, USDC];

  for (let from = startBlock; from < endBlock; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, endBlock);
    const hexFrom = '0x' + from.toString(16);
    const hexTo = '0x' + to.toString(16);

    for (const cAddr of contracts) {
      // User as topic1 (from/owner — Transfer sending, Approval owner, Withdraw user, Rank*)
      const r1 = await fetchRpc('eth_getLogs', [{
        address: cAddr,
        fromBlock: hexFrom,
        toBlock: hexTo,
        topics: [null, padded],
      }]);
      if (r1?.result) {
        for (const log of r1.result) {
          // For stablecoin contracts, only count transfers TO the JSAVIOR contract
          if (cAddr !== CONTRACT) {
            if (!log.topics[2] || log.topics[2].toLowerCase() !== contractTo) continue;
          }
          const bn = parseInt(log.blockNumber, 16);
          if (earliestBlock === null || bn < earliestBlock) earliestBlock = bn;
        }
      }

      // User as topic2 (to/receiver — Transfer receiving, Approval spender)
      const r2 = await fetchRpc('eth_getLogs', [{
        address: cAddr,
        fromBlock: hexFrom,
        toBlock: hexTo,
        topics: [null, null, padded],
      }]);
      if (r2?.result) {
        for (const log of r2.result) {
          const bn = parseInt(log.blockNumber, 16);
          if (earliestBlock === null || bn < earliestBlock) earliestBlock = bn;
        }
      }
    }

    if (earliestBlock !== null) break;
  }
  return earliestBlock;
}

async function getBlockTimestamp(blockNum: number): Promise<number | null> {
  const block = await fetchRpc('eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  if (!block?.result) return null;
  return parseInt(block.result.timestamp, 16);
}

async function findJoinDate(wallet: string): Promise<string | null> {
  const launchBlock = await getBlockByTimestamp(LAUNCH_TIME);
  if (!launchBlock) return null;

  const now = Math.floor(Date.now() / 1000);
  const currentBlock = await getBlockByTimestamp(now) ?? launchBlock + BLOCKS_PER_DAY;

  const foundBlock = await findFirstEventBlock(wallet, launchBlock, currentBlock);
  if (!foundBlock) return null;

  const ts = await getBlockTimestamp(foundBlock);
  if (!ts) return null;

  return new Date(ts * 1000).toISOString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ wallet: string }> },
) {
  const { wallet: rawWallet } = await context.params;
  const wallet = rawWallet.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(wallet);
  if (cached && now - cached.ts < CACHE_TTL) {
    return NextResponse.json({ date: cached.date });
  }

  const iso = await findJoinDate(wallet);
  const formatted = iso ? formatDate(iso) : null;

  cache.set(wallet, { date: formatted, ts: now });
  return NextResponse.json({ date: formatted });
}
