import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL = 10 * 60 * 1000;
const walletCache = new Map<string, { date: string | null; ts: number }>();

const ANKR_KEY = process.env.ANKR_API_KEY || '';
const ANKR_URL = `https://rpc.ankr.com/bsc/${ANKR_KEY}`;

const JSAVIOR = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';
const DEPLOY_BLOCK = 86700000;

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

async function rpc(body: unknown): Promise<any> {
  const res = await fetch(ANKR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function getBlockTimestamp(blockNum: number): Promise<number> {
  const block = await rpc({
    jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber',
    params: ['0x' + blockNum.toString(16), false],
  });
  return parseInt(block.timestamp, 16);
}

const USERS_SELECTOR = '0xa87430ba';

function decodeTotalInvested(result: string): bigint {
  if (!result || result === '0x') return 0n;
  const hex = result.slice(2);
  if (hex.length < 194) return 0n;
  return BigInt('0x' + hex.slice(192, 256));
}

async function findFirstInvestBlock(wallet: string): Promise<number | null> {
  const data = USERS_SELECTOR + '0'.repeat(24) + wallet.slice(2);

  const latestHex = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  const latest = parseInt(latestHex, 16);

  let lo = DEPLOY_BLOCK;
  let hi = latest;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const result = await rpc({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: JSAVIOR, data }, '0x' + mid.toString(16)],
    });
    const invested = decodeTotalInvested(result);
    if (invested > 0n) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const checkResult = await rpc({
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: JSAVIOR, data }, '0x' + lo.toString(16)],
  });
  const checkInvested = decodeTotalInvested(checkResult);

  if (checkInvested === 0n) return null;
  return lo;
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
  const cached = walletCache.get(wallet);
  if (cached && now - cached.ts < CACHE_TTL) {
    return NextResponse.json({ date: cached.date });
  }

  try {
    // Check registration
    const usersData = USERS_SELECTOR + '0'.repeat(24) + wallet.slice(2);
    const usersResult = await rpc({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: JSAVIOR, data: usersData }, 'latest'],
    });
    const registered = parseInt(usersResult.slice(2, 66), 16) === 1;

    if (!registered) {
      walletCache.set(wallet, { date: 'coming soon', ts: now });
      return NextResponse.json({ date: 'coming soon' });
    }

    const blockNum = await findFirstInvestBlock(wallet);

    if (blockNum === null) {
      walletCache.set(wallet, { date: 'coming soon', ts: now });
      return NextResponse.json({ date: 'coming soon' });
    }

    const ts = await getBlockTimestamp(blockNum);
    const date = formatDate(ts);
    walletCache.set(wallet, { date, ts: now });
    return NextResponse.json({ date });
  } catch (e) {
    console.error('[join-date] Error:', e);
    return NextResponse.json({ date: null });
  }
}
