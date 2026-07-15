import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL = 10 * 60 * 1000;
const walletCache = new Map<string, { date: string | null; ts: number }>();

const RPC_URLS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
];

const JSAVIOR = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';

const LAUNCH_TIME = 1773541606;
const CYCLE_SECS = 2592000;

const SEL_LAUNCH_TIME = '0x790ca413';
const SEL_MONTHLY_VOLUME = '0xc6752905';
const SEL_USERS = '0xa87430ba';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

async function rpc(body: unknown): Promise<any> {
  let lastErr: unknown;
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error?.message ?? JSON.stringify(json.error));
      return json.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function ethCall(data: string): Promise<string> {
  return rpc({
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: JSAVIOR, data }, 'latest'],
  });
}

function hasVolumeInResult(result: string): boolean {
  return parseInt(result.slice(2, 66), 16) > 0 || parseInt(result.slice(66, 130), 16) > 0;
}

async function findFirstActiveCycle(wallet: string, maxCycle: number): Promise<number | null> {
  const paddedAddr = '0x000000000000000000000000' + wallet.slice(2).toLowerCase();

  if (maxCycle < 0) return null;

  let low = 0;
  let high = maxCycle;
  let found = false;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cycleHex = '0x' + BigInt(mid).toString(16).padStart(64, '0');
    const result = await ethCall(SEL_MONTHLY_VOLUME + paddedAddr.slice(2) + cycleHex.slice(2));

    if (hasVolumeInResult(result)) {
      found = true;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return found ? low : null;
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
    const usersData = SEL_USERS + '0'.repeat(24) + wallet.slice(2).toLowerCase();
    const usersResult = await ethCall(usersData);
    const registered = parseInt(usersResult.slice(2, 66), 16) === 1;

    if (!registered) {
      walletCache.set(wallet, { date: 'coming soon', ts: now });
      return NextResponse.json({ date: 'coming soon' });
    }

    // Check totalInvested — if 0, user registered but never invested
    const totalInvested = parseInt(usersResult.slice(194, 258), 16);
    if (totalInvested === 0) {
      walletCache.set(wallet, { date: 'coming soon', ts: now });
      return NextResponse.json({ date: 'coming soon' });
    }

    // Binary search monthlyVolume cycles to find first active cycle
    const currentCycle = Math.floor((Date.now() / 1000 - LAUNCH_TIME) / CYCLE_SECS);
    const firstCycle = await findFirstActiveCycle(wallet, currentCycle);

    if (firstCycle === null) {
      walletCache.set(wallet, { date: 'coming soon', ts: now });
      return NextResponse.json({ date: 'coming soon' });
    }

    const joinTs = LAUNCH_TIME + firstCycle * CYCLE_SECS;
    const date = formatDate(joinTs);
    walletCache.set(wallet, { date, ts: now });
    return NextResponse.json({ date });
  } catch (e) {
    console.error('[join-date] Error:', e);
    return NextResponse.json({ date: null });
  }
}
