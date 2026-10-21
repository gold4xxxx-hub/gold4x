import { NextResponse } from 'next/server';
import joinDates from '@/data/userJoinDates.json';
import joinMeta from '@/data/userJoinDates.meta.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Join date lookup for the JSAVIOR (Gold4x) contract on BSC.
 *
 * The contract stores no registration timestamp, so the join date is derived
 * from the moment a wallet first paid into the contract (the REG_FEE transfer
 * performed by register() / registerWithStable()).
 *
 * Two tiers:
 *
 *  Tier 1 - static snapshot (0 RPC calls, ~0 ms).
 *    src/data/userJoinDates.json holds every user registered up to
 *    meta.checkpointBlock, mapped to the exact timestamp of their
 *    registration. This covers the whole existing user base with no RPC
 *    traffic at all, so the free endpoints are never touched for them.
 *
 *  Tier 2 - recent block scan (only for wallets missing from the snapshot).
 *    Such a wallet must have registered after meta.checkpointBlock, so only
 *    that (small) window has to be searched. The window is walked backwards
 *    in chunks sized to what each endpoint allows, and every match is cached
 *    in memory so the chain is never queried twice for the same wallet.
 */

const JSAVIOR = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';
const JSAVIOR_TOPIC = '0x' + JSAVIOR.slice(2).padStart(64, '0');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';

const SEL_USERS = '0xa87430ba'; // users(address) -> (bool,address,uint32,uint128)

/**
 * Last block covered by the static snapshot.
 * JOIN_DATE_CHECKPOINT can override it - used by the local test harness to
 * exercise the Tier 2 scan against a wallet that is also in the snapshot.
 * JOIN_DATE_IGNORE_SNAPSHOT=1 skips the Tier 1 lookup for the same reason.
 */
const CHECKPOINT_BLOCK = Number(process.env.JOIN_DATE_CHECKPOINT) || joinMeta.checkpointBlock;
const IGNORE_SNAPSHOT = process.env.JOIN_DATE_IGNORE_SNAPSHOT === '1';

/** TTL for the in-memory cache of Tier 2 results. */
const CACHE_TTL = 30 * 60 * 1000;
/**
 * A failed lookup is cached for much less time than a successful one. A
 * rate limited endpoint must not blank the tile for half an hour.
 */
const FAILURE_CACHE_TTL = 30 * 1000;
/** How many block windows the fallback will walk before giving up. */
const MAX_WINDOWS = 40;
/**
 * The walk is also bounded in time. Public endpoints answer a burst with 403
 * or "limit exceeded", and a walk that keeps retrying the same ground in
 * smaller steps would otherwise hold the request open for most of a minute.
 */
const SCAN_BUDGET_MS = 12_000;
const walletCache = new Map<string, { date: string | null; ts: number }>();

/**
 * Public BSC endpoints, with the largest block span each one accepts for an
 * eth_getLogs call. These limits were measured, not guessed:
 *
 *   drpc       10,000    "ranges over 10000 blocks are not supported"
 *   publicnode  5,000    beyond that it wants an archive token
 *   48.club     5,000    "exceed maximum block range: 5000"
 *   1rpc           50    "eth_getLogs is limited to 0 - 50 blocks range"
 *   blockrazor     25    "log query range must not exceed 25 blocks"
 *
 * Binance's own dataseed refuses eth_getLogs outright, so it is only used
 * for plain eth_call / eth_getBlockByNumber.
 */
type Endpoint = { url: string; range: number; logs: boolean };
const ENDPOINTS: Endpoint[] = [
  { url: 'https://rpc-bsc.48.club', range: 5000, logs: true },
  { url: 'https://bsc.drpc.org', range: 10000, logs: true },
  { url: 'https://bsc-rpc.publicnode.com', range: 5000, logs: true },
  { url: 'https://bsc.publicnode.com', range: 5000, logs: true },
  { url: 'https://1rpc.io/bnb', range: 50, logs: true },
  { url: 'https://bsc.blockrazor.xyz', range: 25, logs: true },
  { url: 'https://bsc-dataseed1.binance.org', range: 0, logs: false },
  { url: 'https://bsc-dataseed2.binance.org', range: 0, logs: false },
  { url: 'https://bsc-dataseed3.binance.org', range: 0, logs: false },
];

// Optional accelerator: when a key is configured the Tier 2 window is covered
// by a single call instead of a dozen. Everything still works without it.
const ANKR_KEY = process.env.ANKR_API_KEY;
if (ANKR_KEY) {
  ENDPOINTS.unshift({ url: `https://rpc.ankr.com/bsc/${ANKR_KEY}`, range: 100000, logs: true });
}

const RPC_TIMEOUT = 8000;

function padTopic(addr: string): string {
  return '0x' + addr.slice(2).toLowerCase().padStart(64, '0');
}

type RpcResult = string | { timestamp?: string } | string[];
type LogEntry = { blockNumber: string; transactionHash?: string };

async function rpc(url: string, method: string, params: unknown[]): Promise<RpcResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Several of the public endpoints sit behind a bot filter that turns
      // away a request without a browser-like User-Agent, which is what a
      // server-side fetch sends by default.
      'User-Agent': 'Mozilla/5.0 (compatible; gold4x-join-date/1.0)',
      Accept: 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message ?? JSON.stringify(json.error));
  return json.result;
}

/** eth_call that works on every endpoint, including the ones that block logs. */
async function rpcCall(method: string, params: unknown[]): Promise<RpcResult> {
  let lastErr: unknown;
  for (const ep of ENDPOINTS) {
    try {
      return await rpc(ep.url, method, params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function getBlockNumber(): Promise<number> {
  const hex = (await rpcCall('eth_blockNumber', [])) as string;
  return parseInt(hex, 16);
}

/** users(address) -> registered? */
async function isRegistered(wallet: string): Promise<boolean> {
  const data = SEL_USERS + wallet.slice(2).toLowerCase().padStart(64, '0');
  const result = (await rpcCall('eth_call', [{ to: JSAVIOR, data }, 'latest'])) as string;
  if (!result || result === '0x') return false;
  return parseInt(result.slice(2, 66), 16) === 1;
}

/**
 * Scans one block window for a transfer INTO the contract from this wallet.
 *
 * The JSAV contract is asked on its own first. A registration almost always
 * shows up there, and every additional endpoint is another request against
 * endpoints that rate limit aggressively - asking all three at once was
 * enough to get the whole window rejected. The stablecoin lookups only run
 * when JSAV found nothing.
 *
 * Returns the lowest matching block, or null. `failed` means the endpoint
 * itself refused, which is different from "nothing there".
 */
async function scanWindow(
  ep: Endpoint,
  walletTopic: string,
  start: number,
  cursor: number,
): Promise<{ found: number | null; failed: boolean; error?: string }> {
  const topics = [TRANSFER_TOPIC, walletTopic, JSAVIOR_TOPIC];
  const fromBlock = '0x' + start.toString(16);
  const toBlock = '0x' + cursor.toString(16);

  let logs: LogEntry[];
  try {
    logs = (await rpc(ep.url, 'eth_getLogs', [
      { address: JSAVIOR, fromBlock, toBlock, topics },
    ])) as LogEntry[];
  } catch (e) {
    return { found: null, failed: true, error: e instanceof Error ? e.message : String(e) };
  }

  let found: number | null = null;
  for (const log of logs) {
    const bn = parseInt(log.blockNumber, 16);
    if (found === null || bn < found) found = bn;
  }
  if (found !== null) return { found, failed: false };

  // registerWithStable() paid in USDT or USDC, so check those too.
  for (const token of [USDT, USDC]) {
    try {
      const stableLogs = (await rpc(ep.url, 'eth_getLogs', [
        { address: token, fromBlock, toBlock, topics },
      ])) as LogEntry[];
      for (const log of stableLogs) {
        const bn = parseInt(log.blockNumber, 16);
        if (found === null || bn < found) found = bn;
      }
      if (found !== null) return { found, failed: false };
    } catch {
      // this token is not indexed here, try the next one
    }
  }

  return { found: null, failed: false };
}

/**
 * Walks backwards from `from` to `to` looking for the first moment the
 * wallet paid into the contract. Returns the lowest matching block, or null.
 */
async function findJoinBlock(
  wallet: string,
  from: number,
  to: number,
  trace?: string[],
): Promise<number | null> {
  const walletTopic = padTopic(wallet);
  const deadline = Date.now() + SCAN_BUDGET_MS;

  let cursor = from;
  let best: number | null = null;
  let windows = 0;

  while (cursor >= to && windows < MAX_WINDOWS) {
    if (Date.now() > deadline) {
      trace?.push(`budget spent at block ${cursor}`);
      break;
    }
    let handled = false;

    for (const ep of ENDPOINTS) {
      if (!ep.logs) continue;
      const start = Math.max(to, cursor - ep.range + 1);

      const { found, failed, error } = await scanWindow(ep, walletTopic, start, cursor);
      if (failed) {
        trace?.push(`${ep.url} window ${start}-${cursor}: ${error}`);
        continue; // this endpoint is unhappy, try the next one
      }

      if (found !== null && (best === null || found < best)) best = found;
      cursor = start - 1;
      handled = true;
      windows++;
      break;
    }

    if (!handled) {
      // Every endpoint refused. Stop instead of walking the same ground in
      // ever smaller steps until the request times out.
      trace?.push(`no endpoint could serve the window at ${cursor}`);
      break;
    }
  }

  return best;
}

async function blockTimestamp(block: number): Promise<number | null> {
  const blk = (await rpcCall('eth_getBlockByNumber', ['0x' + block.toString(16), false])) as {
    timestamp?: string;
  };
  return blk?.timestamp ? parseInt(blk.timestamp, 16) : null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ wallet: string }> },
) {
  const { wallet: rawWallet } = await context.params;
  const wallet = rawWallet.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  // Tier 1 - static snapshot. No RPC, no API key, instant.
  const snapshot = IGNORE_SNAPSHOT ? undefined : (joinDates as Record<string, string>)[wallet];
  if (snapshot) {
    return NextResponse.json({ date: snapshot, source: 'snapshot' });
  }

  const now = Date.now();
  const cached = walletCache.get(wallet);
  if (cached) {
    const ttl = cached.date ? CACHE_TTL : FAILURE_CACHE_TTL;
    if (now - cached.ts < ttl) {
      return NextResponse.json({ date: cached.date, source: 'cache' });
    }
  }

  try {
    // Is this wallet registered at all?
    const registered = await isRegistered(wallet);
    if (!registered) {
      walletCache.set(wallet, { date: 'coming soon', ts: now });
      return NextResponse.json({ date: 'coming soon', source: 'chain' });
    }

    // Tier 2 - the wallet is registered but is not in the snapshot, so it must
    // have registered after the checkpoint. Only that window is searched.
    const latest = await getBlockNumber();
    const trace: string[] | undefined = process.env.JOIN_DATE_DEBUG === '0' ? undefined : [];
    const joinBlock = await findJoinBlock(wallet, latest, CHECKPOINT_BLOCK, trace);

    if (joinBlock === null) {
      walletCache.set(wallet, { date: null, ts: now });
      // The wallet is registered, the date is simply not reachable right now.
      // Saying so is more honest than "coming soon", which would tell a user
      // who has already registered that they have not.
      return NextResponse.json({
        date: null,
        registered: true,
        source: 'chain',
        ...(trace ? { debug: trace } : {}),
      });
    }

    const ts = await blockTimestamp(joinBlock);
    if (!ts) {
      walletCache.set(wallet, { date: null, ts: now });
      return NextResponse.json({ date: null, registered: true, source: 'chain' });
    }

    const date = new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
    walletCache.set(wallet, { date, ts: now });
    return NextResponse.json({ date, source: 'chain' });
  } catch (e) {
    console.error('[join-date] Error:', e);
    return NextResponse.json({ date: null, source: 'error' });
  }
}
