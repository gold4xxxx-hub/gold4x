import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { date: string | null; ts: number }>();
const CONTRACT = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const LAUNCH_TIME = 1742342400; // 19 Mar 2025 00:00:00 UTC (known launch)

// Approx BSC block every 3 seconds
const BLOCKS_PER_DAY = 28800;
const MAX_BLOCKS_TO_SCAN = BLOCKS_PER_DAY * 400; // ~400 days worth

const TRANSFER_EVENT = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function fetchRpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(BSC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getBlockByTimestamp(targetTs: number): Promise<number | null> {
  // Binary search to find block number closest to target timestamp
  const latest = await fetchRpc('eth_blockNumber', []);
  if (!latest || !latest.result) return null;
  const latestNum = parseInt(latest.result, 16);
  const latestBlock = await fetchRpc('eth_getBlockByNumber', [latest.result, false]);
  if (!latestBlock?.result) return null;
  const latestTs = parseInt(latestBlock.result.timestamp, 16);
  if (targetTs >= latestTs) return latestNum;

  let lo = 0;
  let hi = latestNum;
  // Estimate start: blocks = (now - launch) / 3 secs
  const estimated = Math.floor((targetTs - LAUNCH_TIME) / 3);
  lo = Math.max(0, estimated - BLOCKS_PER_DAY);

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

async function findFirstTransferBlock(wallet: string, startBlock: number, endBlock: number): Promise<number | null> {
  const addr = wallet.toLowerCase().replace('0x', '');
  const padded = '0x' + addr.padStart(64, '0');

  const fromTopic = padded; // user as "from" (sending to contract)
  const toTopic = '0x000000000000000000000000' + CONTRACT.toLowerCase().replace('0x', ''); // contract as "to"

  const batchSize = 50000;
  for (let from = startBlock; from < endBlock; from += batchSize) {
    const to = Math.min(from + batchSize - 1, endBlock);
    const hexFrom = '0x' + from.toString(16);
    const hexTo = '0x' + to.toString(16);

    // Try both directions: user->contract (invest) and contract->user (receive)
    const result = await fetchRpc('eth_getLogs', [{
      address: CONTRACT,
      fromBlock: hexFrom,
      toBlock: hexTo,
      topics: [TRANSFER_EVENT, fromTopic],
    }]);

    if (result?.result && result.result.length > 0) {
      // Find earliest block among results
      let earliest = result.result[0];
      for (const log of result.result) {
        if (parseInt(log.blockNumber, 16) < parseInt(earliest.blockNumber, 16)) {
          earliest = log;
        }
      }
      return parseInt(earliest.blockNumber, 16);
    }
  }
  return null;
}

async function getBlockTimestamp(blockNum: number): Promise<number | null> {
  const block = await fetchRpc('eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  if (!block?.result) return null;
  return parseInt(block.result.timestamp, 16);
}

async function findJoinDate(wallet: string): Promise<string | null> {
  const launchBlock = await getBlockByTimestamp(LAUNCH_TIME);
  if (!launchBlock) return null;

  const endBlock = launchBlock + MAX_BLOCKS_TO_SCAN;
  const now = Math.floor(Date.now() / 1000);
  const estimatedEnd = LAUNCH_TIME + MAX_BLOCKS_TO_SCAN * 3;
  const actualEndBlock = estimatedEnd > now
    ? await getBlockByTimestamp(now) ?? launchBlock + BLOCKS_PER_DAY
    : endBlock;

  const foundBlock = await findFirstTransferBlock(wallet, launchBlock, actualEndBlock);
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
