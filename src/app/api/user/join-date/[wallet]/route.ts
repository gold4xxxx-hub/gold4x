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
const walletCache = new Map<string, { date: string | null; ts: number }>();

/**
 * Public BSC endpoints. `range` is the largest block span each one accepts
 * for an eth_getLogs call (Binance's own dataseed blocks eth_getLogs
 * entirely, so it is only used for plain eth_call / eth_getBlockByNumber).
 */
type Endpoint = { url: string; range: number; logs: boolean };
const ENDPOINTS: Endpoint[] = [
  { url: 'https://bsc-rpc.publicnode.com', range: 5000, logs: true },
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
    headers: { 'Content-Type': 'application/json' },
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
 * Walks backwards from `from` to `to` looking for the first moment the
 * wallet paid into the contract. Returns the lowest matching block, or null.
 */
async function findJoinBlock(wallet: string, from: number, to: number): Promise<number | null> {
  const walletTopic = padTopic(wallet);
  // A registration is a transfer INTO the contract. JSAV is the native token
  // of the contract itself, USDT/USDC cover registerWithStable().
  const lookups: { address: string; topics: string[] }[] = [
    { address: JSAVIOR, topics: [TRANSFER_TOPIC, walletTopic, JSAVIOR_TOPIC] },
    { address: USDT, topics: [TRANSFER_TOPIC, walletTopic, JSAVIOR_TOPIC] },
    { address: USDC, topics: [TRANSFER_TOPIC, walletTopic, JSAVIOR_TOPIC] },
  ];

  let cursor = from;
  let best: number | null = null;

  while (cursor >= to) {
    let handled = false;

    for (const ep of ENDPOINTS) {
      if (!ep.logs) continue;
      const start = Math.max(to, cursor - ep.range + 1);
      let found: number | null = null;

      try {
        const results = await Promise.all(
          lookups.map(async (l) => {
            const logs = (await rpc(ep.url, 'eth_getLogs', [
              {
                address: l.address,
                fromBlock: '0x' + start.toString(16),
                toBlock: '0x' + cursor.toString(16),
                topics: l.topics,
              },
            ])) as LogEntry[];
            return logs;
          }),
        );
        for (const logs of results) {
          for (const log of logs) {
            const bn = parseInt(log.blockNumber, 16);
            if (found === null || bn < found) found = bn;
          }
        }
      } catch {
        // this endpoint refused the request - fall through to the next one,
        // which uses a smaller block range
        continue;
      }

      if (found !== null && (best === null || found < best)) best = found;
      cursor = start - 1;
      handled = true;
      break;
    }

    if (!handled) break; // every endpoint failed - give up rather than hammer
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
  if (cached && now - cached.ts < CACHE_TTL) {
    return NextResponse.json({ date: cached.date, source: 'cache' });
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
    const joinBlock = await findJoinBlock(wallet, latest, CHECKPOINT_BLOCK);

    if (joinBlock === null) {
      walletCache.set(wallet, { date: null, ts: now });
      return NextResponse.json({ date: null, source: 'chain' });
    }

    const ts = await blockTimestamp(joinBlock);
    if (!ts) {
      walletCache.set(wallet, { date: null, ts: now });
      return NextResponse.json({ date: null, source: 'chain' });
    }

    const date = new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
    walletCache.set(wallet, { date, ts: now });
    return NextResponse.json({ date, source: 'chain' });
  } catch (e) {
    console.error('[join-date] Error:', e);
    return NextResponse.json({ date: null, source: 'error' });
  }
}
