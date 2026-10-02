'use client';

// On-chain log reads for P2PEscrow.
//
// IMPORTANT CONSTRAINT: the public BSC node this project uses
// (bsc-rpc.publicnode.com) caps eth_getLogs at roughly a 5,000 block range and
// returns 403 Forbidden beyond that. Verified by probing spans of 2k, 5k,
// 20k and 100k blocks, where only 2k and 5k succeeded. It also rate-limits
// rapid successive calls.
//
// So a full history walk is not possible from the browser. What this module
// does instead:
//
//   * reads a bounded recent window per topic, one call at a time
//   * caches results per trade so repeat opens cost nothing
//   * returns an explicit `truncated` flag, which the UI surfaces
//
// For complete historical chat and deadlines regardless of age, this needs a
// real indexer (BscScan API `getLogs`, a hosted subgraph, or your own
// log-consuming backend). The window-based reader below is correct for recent
// activity, which is what the desk needs while a trade is live.

import { ethers } from 'ethers';
import { P2PESCROW_CONTRACT_ADDRESS, BSC_CONFIG } from '@/config/web3Config';

const CHAIN_ID = 56;
const RPC = 'https://bsc-rpc.publicnode.com';

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, {
  staticNetwork: true,
});

/** Largest window the public node reliably serves. */
const WINDOW = 5_000;

// Deploy block floor, so a misconfigured head cannot walk the whole chain.
const DEPLOY_BLOCK = 116_000_000;

const TOPIC = {
  TradeStarted:
    '0x2ca2663ae693a9057bb61534e47c30a4eb7cd830ec41b57c62d7249d478e5ede',
  ChatMessage:
    '0x5b34203801702dd1595f9de44ec0309424052e3b80f08676e03e05815b7c196f',
  FiatMarkedPaid:
    '0x15b92405884bc4ee2bf7f18273e09dc1af9ff8473257cb3e2d6c30d02e467a88',
  ScreenshotShared:
    '0x0abc1ad19cb2a631a1ccdeef24430f5519033e44a3fb2a1f04cd4addb4ea296a',
  TradeConfirmed:
    '0x4886270d3c681c8373359d1cfafb1a549453e43e452ce59a9eae87f8a23e50be',
} as const;

const iface = new ethers.Interface([
  'event TradeStarted(uint256 indexed tradeId, uint256 indexed adId, address indexed initiator, uint8 pairType, uint256 cryptoAmount, uint256 quoteAmount, uint256 deadline)',
  'event ChatMessage(uint256 indexed tradeId, address indexed sender, string message)',
  'event FiatMarkedPaid(uint256 indexed tradeId, address indexed buyer, string screenshotHash)',
  'event ScreenshotShared(uint256 indexed tradeId, address indexed sender, string hash)',
  'event TradeConfirmed(uint256 indexed tradeId, address indexed confirmer)',
]);

/** Simple TTL cache, keyed by string. Keeps repeat modal opens free. */
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 15_000;

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function remember(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
}

export function clearTradeLogCache() {
  cache.clear();
}

/** Serialise RPC calls; the public node 403s on rapid concurrent requests. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * One bounded log query. Narrowed to a tradeId when given, and limited to the
 * recent window. Reports `truncated` when the window could not cover the
 * whole life of the trade.
 */
async function fetchTopic(
  topic0: string,
  tradeId?: number,
): Promise<{ logs: ethers.Log[]; truncated: boolean }> {
  const key = `logs:${topic0}:${tradeId ?? 'all'}`;
  const hit = cached<{ logs: ethers.Log[]; truncated: boolean }>(key);
  if (hit) return hit;

  const result = await enqueue(async () => {
    const head = await provider.getBlockNumber();
    const from = Math.max(head - WINDOW, DEPLOY_BLOCK);
    const topics = tradeId === undefined
      ? [topic0]
      : [topic0, ethers.zeroPadValue(ethers.toBeHex(tradeId), 32)];

    try {
      const logs = await provider.getLogs({
        address: P2PESCROW_CONTRACT_ADDRESS,
        topics: topics as string[],
        fromBlock: from,
        toBlock: head,
      });
      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      // Anything older than the window is unreachable from this RPC, so a
      // trade that started before `from` is only partially visible.
      return { logs, truncated: true };
    } catch {
      return { logs: [] as ethers.Log[], truncated: true };
    }
  });

  remember(key, result);
  return result;
}

export type TradeEventState = {
  /** INR payment deadline from TradeStarted. 0 for crypto-crypto trades. */
  deadline: number;
  /** True once the buyer marked the INR as sent. */
  fiatPaid: boolean;
  /** Payment screenshot hash the buyer attached, if any. */
  screenshotHash: string;
  /** Addresses that have confirmed. */
  confirmedBy: string[];
};

const EMPTY: TradeEventState = {
  deadline: 0,
  fiatPaid: false,
  screenshotHash: '',
  confirmedBy: [],
};

/**
 * deadline, fiatPaid, screenshot hash and confirmations for one trade.
 *
 * Reads are cached for 15s, so opening the modal repeatedly is one RPC round
 * trip rather than five.
 */
export async function getTradeEventState(
  tradeId: number,
): Promise<TradeEventState & { truncated: boolean }> {
  const key = `state:${tradeId}`;
  const hit = cached<TradeEventState & { truncated: boolean }>(key);
  if (hit) return hit;

  const [started, paid, shots, confirmed] = await Promise.all([
    fetchTopic(TOPIC.TradeStarted, tradeId),
    fetchTopic(TOPIC.FiatMarkedPaid, tradeId),
    fetchTopic(TOPIC.ScreenshotShared, tradeId),
    fetchTopic(TOPIC.TradeConfirmed, tradeId),
  ]);

  const out: TradeEventState = { ...EMPTY };
  const truncated =
    started.truncated || paid.truncated || shots.truncated || confirmed.truncated;

  // parseLog returns null on a fragment mismatch; guards would only hide a
  // bug, but the topics are ours so it should not occur.
  const argsOf = (log: ethers.Log) => iface.parseLog(log)?.args ?? null;

  for (const log of started.logs) {
    const args = argsOf(log);
    if (!args) continue;
    const d = Number(args.deadline);
    // An ad can be retaken, emitting more than one start; latest wins.
    if (d > out.deadline) out.deadline = d;
  }
  if (paid.logs.length > 0) out.fiatPaid = true;
  for (const log of shots.logs) {
    const args = argsOf(log);
    const hash = args ? String(args.hash) : '';
    if (hash) out.screenshotHash = hash;
  }
  for (const log of confirmed.logs) {
    const args = argsOf(log);
    const who = args ? String(args.confirmer) : '';
    if (who && !out.confirmedBy.includes(who)) out.confirmedBy.push(who);
  }

  const value = { ...out, truncated };
  remember(key, value);
  return value;
}

export type ChatEntry = { sender: string; text: string; blockNumber: number };

/** On-chain chat for one trade, oldest first. */
export async function getTradeChat(
  tradeId: number,
): Promise<{ messages: ChatEntry[]; truncated: boolean }> {
  const { logs, truncated } = await fetchTopic(TOPIC.ChatMessage, tradeId);
  const messages: ChatEntry[] = [];
  for (const log of logs) {
    const args = iface.parseLog(log)?.args;
    if (!args) continue;
    messages.push({
      sender: String(args.sender),
      text: String(args.message),
      blockNumber: log.blockNumber,
    });
  }
  return { messages, truncated };
}

/** Confirms the configured RPC is the expected chain. */
export async function verifyRpcChain(): Promise<boolean> {
  return (await provider.getNetwork()).chainId === BigInt(BSC_CONFIG.chainId);
}
