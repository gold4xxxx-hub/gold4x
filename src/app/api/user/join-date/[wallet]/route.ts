import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { date: string | null; ts: number }>();
const CONTRACT = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const LAUNCH_TIME = 1773541606; // 15 Mar 2026 (matches frontend)

// BSC block 0 ~ 20 Jun 2020 (1592640000), ~3 sec per block
const BSC_GENESIS_TS = 1592640000;
const START_BLOCK = Math.floor((LAUNCH_TIME - BSC_GENESIS_TS) / 3);

const BATCH_SIZE = 500000;

async function fetchRpc(method: string, params: any[]): Promise<any> {
  try {
    const res = await fetch(BSC_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { error: `http ${res.status}` };
    return res.json();
  } catch (e: any) {
    return { error: e.message };
  }
}

async function findFirstEventBlock(wallet: string): Promise<number | null> {
  const addr = wallet.toLowerCase().replace('0x', '');
  const padded = '0x' + addr.padStart(64, '0');
  let earliestBlock: number | null = null;

  const latestResp = await fetchRpc('eth_blockNumber', []);
  if (!latestResp?.result) return null;
  const latestNum = parseInt(latestResp.result, 16);

  const startBlock = Math.max(0, START_BLOCK - BATCH_SIZE); // start a bit earlier for safety

  for (let from = startBlock; from < latestNum; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, latestNum);
    const hexFrom = '0x' + from.toString(16);
    const hexTo = '0x' + to.toString(16);

    // User as topic1 (from/owner — Transfer sending, Approval, Withdraw, Rank*)
    const r1 = await fetchRpc('eth_getLogs', [{
      address: CONTRACT,
      fromBlock: hexFrom,
      toBlock: hexTo,
      topics: [null, padded],
    }]);
    if (r1?.result) {
      for (const log of r1.result) {
        const bn = parseInt(log.blockNumber, 16);
        if (earliestBlock === null || bn < earliestBlock) earliestBlock = bn;
      }
    }

    // User as topic2 (to/receiver — Transfer receiving)
    const r2 = await fetchRpc('eth_getLogs', [{
      address: CONTRACT,
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

    if (earliestBlock !== null) break;
  }
  return earliestBlock;
}

async function getBlockTimestamp(blockNum: number): Promise<number | null> {
  const block = await fetchRpc('eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  if (!block?.result) return null;
  return parseInt(block.result.timestamp, 16);
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

  const foundBlock = await findFirstEventBlock(wallet);
  let formatted: string | null = null;
  if (foundBlock) {
    const ts = await getBlockTimestamp(foundBlock);
    if (ts) {
      formatted = formatDate(new Date(ts * 1000).toISOString());
    }
  }

  cache.set(wallet, { date: formatted, ts: now });
  return NextResponse.json({ date: formatted });
}
