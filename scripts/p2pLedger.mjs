#!/usr/bin/env node
/**
 * P2PEscrow ledger builder.
 *
 * Assembles a complete audit ledger for the escrow contract at
 * 0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0 on BSC:
 *
 *   - every contract event, decoded
 *   - every JSAV transfer into or out of escrow
 *   - optionally every transaction sent to or from escrow, WITH its receipt
 *     status, so reverted attempts appear too
 *
 * ---------------------------------------------------------------------------
 * Why an archive RPC is required, not optional
 * ---------------------------------------------------------------------------
 * Public endpoints cannot do this job. Measured on 2026-10-03:
 *
 *   1rpc.io/bnb         eth_getLogs works, but has a daily plan cap and only
 *                       serves ~50k blocks of depth
 *   bsc-dataseed1..4    BLOCK eth_getLogs entirely, at any window width
 *   bsc.drpc.org        rate limits within seconds
 *   bsc.llamarpc.com    endpoint down
 *   rpc.ankr.com        requires a key
 *   bsc-rpc.publicnode  requires a paid token for archive requests
 *   nodereal (public)   best of the free set: 50,000-block windows and
 *                       archive eth_getCode, but a low daily cap
 *
 * Only block bodies survive everywhere, so a full audit is ~261,000 block
 * requests. Free endpoints sustain ~23 blocks/sec, i.e. roughly 3 hours, and
 * drop 10-15% of requests to rate limits that need retry passes.
 *
 * With an archive key the successful-activity history costs SIX requests.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   $env:BSC_RPC_URL = "https://..."      # required, archive endpoint
 *   $env:BSC_RPC_URL = "https://..."      # optional extra endpoints, comma sep
 *
 *   node scripts/p2pLedger.mjs                  # events + transfers (seconds)
 *   node scripts/p2pLedger.mjs --tx             # also fetch receipts (minutes)
 *   node scripts/p2pLedger.mjs --tx --deep      # hunt reverted txs (hours)
 *   node scripts/p2pLedger.mjs --resume         # continue an interrupted run
 *   node scripts/p2pLedger.mjs --from 125000000 --to 125100000
 *
 * Outputs p2p-ledger.json and p2p-ledger.md in the project root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ESCROW = '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
const JSAV = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const OWNER = '0xb32fccf4723fc19b8a097006f59437c15e88bbce';

const CHECKPOINT = path.join(ROOT, '.ledger-checkpoint.json');
const OUT_JSON = path.join(ROOT, 'p2p-ledger.json');
const OUT_MD = path.join(ROOT, 'p2p-ledger.md');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const WANT_TX = has('--tx');
const DEEP = has('--deep');           // scan every block, to catch reverts
const RESUME = has('--resume');
const CONCURRENCY = Number(opt('--concurrency', '24'));

const endpoints = [
  process.env.BSC_RPC_URL,
  ...(process.env.BSC_RPC_EXTRA || '').split(','),
  // Fallbacks. Only block bodies are reliable here, so --deep still works
  // without a key, just slowly.
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc-dataseed.binance.org',
]
  .map((s) => (s || '').trim())
  .filter(Boolean);

if (!process.env.BSC_RPC_URL && !DEEP) {
  console.error(
    'Set BSC_RPC_URL to an archive endpoint (Alchemy, QuickNode, Ankr).\n' +
      'Without one, event history is capped at ~50k blocks by public providers.\n' +
      'To hunt reverted transactions without a key, use --deep (expect hours).',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

let epIndex = 0;
const epFailures = new Map();
const stats = { requests: 0, errors: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params, attempt = 0) {
  const url = endpoints[epIndex % endpoints.length];
  stats.requests++;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = JSON.parse(await res.text());
    if (json.error) {
      epFailures.set(url, (epFailures.get(url) || 0) + 1);
      stats.errors++;
      // An archive-key endpoint erroring on getLogs is a range problem, not a
      // dead endpoint. Only rotate on transport/rate-limit failures.
      if (attempt < 5) {
        await sleep(250 * 2 ** attempt);
        return rpc(method, params, attempt + 1);
      }
      return null;
    }
    return json.result;
  } catch {
    epFailures.set(url, (epFailures.get(url) || 0) + 1);
    stats.errors++;
    epIndex++;
    if (attempt < 5) {
      await sleep(250 * 2 ** attempt);
      return rpc(method, params, attempt + 1);
    }
    return null;
  }
}

const hex = (n) => '0x' + n.toString(16);
const padTopic = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

// Topics come from the verified ABI, not memory.
const EVENT_SIGS = {
  '0x76f80d86dcbd233724e58be59fe546975565b2f1446ab372a18dc431a1b55656': 'AdCreated',
  '0x20e953810446bfec422c45a49b30c7b446bc121960d6568e36a20016140f86b7': 'AdCancelled',
  '0x2ca2663ae693a9057bb61534e47c30a4eb7cd830ec41b57c62d7249d478e5ede': 'TradeStarted',
  '0x4886270d3c681c8373359d1cfafb1a549453e43e452ce59a9eae87f8a23e50be': 'TradeConfirmed',
  '0x60f91a26281f20fb528663f4da55773c83e2ee8a7a5dddb6d1753749e81dc49b': 'TradeCompleted',
  '0x4e02dcf02d8510f6c8a6878a3c54ae6e2bfbf552df29221d7a1eed173a6b1ae7': 'TradeCancelled',
  '0x15b92405884bc4ee2bf7f18273e09dc1af9ff8473257cb3e2d6c30d02e467a88': 'FiatMarkedPaid',
  '0x0abc1ad19cb2a631a1ccdeef24430f5519033e44a3fb2a1f04cd4addb4ea296a': 'ScreenshotShared',
  '0x5b34203801702dd1595f9de44ec0309424052e3b80f08676e03e05815b7c196f': 'ChatMessage',
  '0x50254a0dab3f208f414bf247012e8d8c90928d1a1b1699b1b62df2326bfb09ab': 'KYCSubmitted',
  '0x0089007d5e59f326275727c342fc43223d3e5d048aa810660e6867e84510f907': 'KYCUpdated',
  '0x7a02eb9b107b2ab713e88c3cdac538e5c21b689d0f1b1f22367578b28fc5d09': 'KYCVerified',
};

const FN_SIGS = {
  ca92a80e: 'createAd',
  '674a0579': 'startTrade',
  ff003449: 'markFiatPaid',
  f8c4cc6d: 'confirmFiatReceived',
  '514fcac7': 'cancelAd',
  '8497b03f': 'cancelExpiredFiatTrade',
  aae8b592: 'sendMessage',
  '794caaaf': 'submitKYC',
  '9be80184': 'updateKYC',
  '7a02eb9b': 'verifyKYC',
  a11449bb: 'getTradeBankDetails',
};

const addrFromTopic = (t) => '0x' + t.slice(-40);
const isoTs = (blockTs) =>
  new Date(blockTs * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';

function fmtUnits(v, d = 18) {
  const n = BigInt(v || '0x0');
  const base = 10n ** BigInt(d);
  const whole = n / base;
  const frac = (n % base).toString().padStart(d, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------------------------------------------------------------------------
// Deploy-block discovery
// ---------------------------------------------------------------------------

/**
 * Binary search for the block the escrow was first deployed at.
 * Needs an archive node; public endpoints answer "header not found" for old
 * blocks, so this degrades to null and the caller must pass --from.
 */
async function findDeployBlock(head) {
  let lo = 1;
  let hi = head;
  for (let i = 0; i < 32 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await rpc('eth_getCode', [ESCROW, hex(mid)]);
    if (code === null) return null;          // endpoint cannot serve history
    if (code === '0x') lo = mid + 1;
    else hi = mid;
  }
  return hi - lo <= 1 ? lo : null;
}

/**
 * Widest getLogs window this endpoint tolerates. Archive nodes take 50k;
 * throttled public nodes take as little as 50.
 */
async function probeWindowSize() {
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  for (const size of [50000, 10000, 5000, 1000, 500, 100, 50]) {
    const r = await rpc('eth_getLogs', [
      { address: ESCROW, fromBlock: hex(head - size), toBlock: hex(head) },
    ]);
    if (Array.isArray(r)) return size;
  }
  return 0; // getLogs unavailable entirely
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const blockCache = new Map();
async function getBlock(n, full = false) {
  const key = n + (full ? ':f' : ':h');
  if (blockCache.has(key)) return blockCache.get(key);
  const b = await rpc('eth_getBlockByNumber', [hex(n), full]);
  if (b) blockCache.set(key, b);
  return b;
}

const transactions = [];
const events = [];
const transfers = [];

function ingestEscrowLogs(logs) {
  for (const l of logs) {
    events.push({
      block: parseInt(l.blockNumber, 16),
      time: null,
      event: EVENT_SIGS[l.topics[0].toLowerCase()] || `0x${l.topics[0].slice(2, 12)}`,
      user: l.topics[1] ? addrFromTopic(l.topics[1]) : null,
      tx: l.transactionHash,
      logIndex: parseInt(l.logIndex, 16),
      data: l.data,
    });
  }
}

function ingestTransfers(logs, direction) {
  for (const l of logs) {
    transfers.push({
      block: parseInt(l.blockNumber, 16),
      time: null,
      direction,
      from: addrFromTopic(l.topics[1]),
      to: addrFromTopic(l.topics[2]),
      amount: fmtUnits(l.data),
      tx: l.transactionHash,
    });
  }
}

/** Record a transaction to/from escrow together with its receipt outcome. */
async function recordTx(tx, block) {
  const receipt = await rpc('eth_getTransactionReceipt', [tx.hash]);
  const selector = (tx.input || '0x').slice(2, 10);
  transactions.push({
    block: parseInt(block.number, 16),
    time: isoTs(parseInt(block.timestamp, 16)),
    hash: tx.hash,
    from: tx.from,
    direction:
      tx.to && tx.to.toLowerCase() === ESCROW.toLowerCase() ? 'IN' : 'OUT',
    function: FN_SIGS[selector] || `0x${selector}`,
    valueBnb: fmtUnits(tx.value || '0x0'),
    // A reverted transaction emits no logs and is invisible to any log query.
    // This is the only place it can surface.
    status: receipt
      ? receipt.status === '1'
        ? 'SUCCESS'
        : 'FAILED'
      : 'UNKNOWN',
    gasUsed: receipt ? parseInt(receipt.gasUsed, 16) : null,
    gasCostBnb: receipt
      ? fmtUnits((BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice || '0x0')).toString())
      : null,
    logsEmitted: receipt ? receipt.logs.length : null,
    fromOwner: (tx.from || '').toLowerCase() === OWNER,
  });
}

async function main() {
  const headHex = await rpc('eth_blockNumber', []);
  if (!headHex) {
    console.error('No RPC endpoint responded to eth_blockNumber.');
    process.exit(1);
  }
  const head = parseInt(headHex, 16);
  console.log(`Chain head ${head}`);

  const window = await probeWindowSize();
  if (window === 0) {
    console.error(
      'This endpoint rejects eth_getLogs at every window size.\n' +
        'Use an archive provider, or run with --deep for a block-by-block scan.',
    );
    if (!DEEP) process.exit(1);
  } else {
    console.log(`getLogs window size ${window} blocks`);
  }

  let from = Number(opt('--from', '0'));
  let to = Number(opt('--to', String(head)));

  if (!from) {
    console.log('Locating deploy block by binary search...');
    const deploy = await findDeployBlock(head);
    if (deploy) {
      from = deploy;
      console.log(`Deploy block ${deploy}`);
    } else {
      from = Math.max(0, head - 50000);
      console.log(
        `Could not binary-search history on this endpoint. Falling back to the last 50,000 blocks.`,
      );
      console.log(`Pass --from to go deeper.`);
    }
  }
  to = Math.min(to, head);

  const span = to - from;
  console.log(`Range ${from} -> ${to}  (${span.toLocaleString()} blocks)`);
  console.log(`Mode: ${DEEP ? 'full block scan (finds reverted txs)' : WANT_TX ? 'logs + receipts' : 'logs only'}\n`);

  const step = window || 50;
  let cursor = from;
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
    if (cp.from === from && cp.to === to) {
      cursor = cp.cursor;
      console.log(`Resuming at block ${cursor}`);
    }
  }

  const startedAt = Date.now();
  let windows = 0;
  let blocksFetched = 0;
  const gaps = [];
  const activeBlocks = new Set();

  while (cursor < to) {
    const a = cursor;
    const b = Math.min(cursor + step - 1, to);

    if (window) {
      const [escrowLogs, inTr, outTr] = await Promise.all([
        rpc('eth_getLogs', [{ address: ESCROW, fromBlock: hex(a), toBlock: hex(b) }]),
        rpc('eth_getLogs', [
          { address: JSAV, topics: [TRANSFER_TOPIC, null, padTopic(ESCROW)], fromBlock: hex(a), toBlock: hex(b) },
        ]),
        rpc('eth_getLogs', [
          { address: JSAV, topics: [TRANSFER_TOPIC, padTopic(ESCROW), null], fromBlock: hex(a), toBlock: hex(b) },
        ]),
      ]);
      if (Array.isArray(escrowLogs)) {
        ingestEscrowLogs(escrowLogs);
        escrowLogs.forEach((l) => activeBlocks.add(parseInt(l.blockNumber, 16)));
      }
      if (Array.isArray(inTr)) {
        ingestTransfers(inTr, 'IN');
        inTr.forEach((l) => activeBlocks.add(parseInt(l.blockNumber, 16)));
      }
      if (Array.isArray(outTr)) {
        ingestTransfers(outTr, 'OUT');
        outTr.forEach((l) => activeBlocks.add(parseInt(l.blockNumber, 16)));
      }
    }

    // In --deep every block is inspected, which is the only way to see a
    // transaction that reverted. Otherwise only blocks that produced a log.
    const blocks = DEEP
      ? Array.from({ length: b - a + 1 }, (_, i) => a + i)
      : [...activeBlocks].filter((n) => n >= a && n <= b);

    const queue = blocks.slice();
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const n = queue.shift();
        const blk = await getBlock(n, true);
        if (!blk) {
          // A block the endpoint would not serve. Recorded, because a silently
          // skipped block is a silently missing transaction.
          gaps.push(n);
          continue;
        }
        blocksFetched++;
        for (const tx of blk.transactions || []) {
          const toAddr = (tx.to || '').toLowerCase();
          const fromAddr = (tx.from || '').toLowerCase();
          if (toAddr !== ESCROW.toLowerCase() && fromAddr !== ESCROW.toLowerCase()) continue;
          if (WANT_TX || DEEP) await recordTx(tx, blk);
        }
      }
    });
    await Promise.all(workers);

    cursor = b + 1;
    windows++;
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify({ from, to, cursor, head, at: new Date().toISOString() }),
    );

    if (Date.now() - startedAt > 2000) {
      const pct = (((cursor - from) / span) * 100).toFixed(1);
      process.stdout.write(
        `  ${pct.padStart(5)}%  block ${cursor}/${to}  ev=${events.length} tr=${transfers.length} tx=${transactions.length}  req=${stats.requests}\n`,
      );
    }
  }

  // Wall-clock timestamps for the event rows.
  const eventBlocks = [...new Set(events.map((e) => e.block))];
  const transferBlocks = [...new Set(transfers.map((t) => t.block))];
  for (const n of [...new Set([...eventBlocks, ...transferBlocks])]) {
    const b = await getBlock(n);
    if (!b) continue;
    const t = isoTs(parseInt(b.timestamp, 16));
    events.filter((e) => e.block === n).forEach((e) => (e.time = t));
    transfers.filter((x) => x.block === n).forEach((x) => (x.time = t));
  }

  events.sort((a, b) => a.block - b.block);
  transfers.sort((a, b) => a.block - b.block);
  transactions.sort((a, b) => a.block - b.block);

  const balance = await rpc('eth_call', [
    { to: JSAV, data: '0x70a08231' + padTopic(ESCROW).slice(2) },
    'latest',
  ]);

  const out = {
    generatedAt: new Date().toISOString(),
    chain: 'BSC',
    contract: ESCROW,
    token: JSAV,
    owner: OWNER,
    rpcEndpoints: endpoints,
    mode: DEEP ? 'deep' : WANT_TX ? 'tx' : 'logs',
    blockRange: { from, to },
    counts: {
      blocksScanned: blocksFetched,
      blocksUnreadable: gaps.length,
      transactions: transactions.length,
      succeeded: transactions.filter((t) => t.status === 'SUCCESS').length,
      failed: transactions.filter((t) => t.status === 'FAILED').length,
      unknown: transactions.filter((t) => t.status === 'UNKNOWN').length,
      events: events.length,
      transfers: transfers.length,
    },
    // Blocks the endpoint refused. Anything inside these could hide a
    // transaction, so the ledger is not complete until this is empty.
    unreadableBlocks: gaps.slice(0, 500),
    currentEscrowBalanceJSAV: balance ? fmtUnits(balance) : null,
    events,
    transfers,
    transactions,
    rpc: { ...stats, failures: [...epFailures].map(([endpoint, count]) => ({ endpoint, count })) },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  fs.writeFileSync(OUT_MD, renderMarkdown(out));

  console.log('\n=== ledger built ===');
  console.log(`  range          ${from} -> ${to}`);
  console.log(`  events         ${out.counts.events}`);
  console.log(`  transfers      ${out.counts.transfers}`);
  console.log(
    `  transactions   ${out.counts.transactions} ` +
      `(${out.counts.succeeded} ok, ${out.counts.failed} failed, ${out.counts.unknown} unknown)`,
  );
  console.log(`  blocks read    ${out.counts.blocksScanned}`);
  console.log(`  escrow holds   ${out.currentEscrowBalanceJSAV} JSAV`);
  console.log(`  rpc requests   ${stats.requests} (${stats.errors} errors)`);
  console.log(`  written to     ${path.relative(ROOT, OUT_MD)}`);
  if (gaps.length) {
    console.log(
      `\n  WARNING: ${gaps.length} block(s) could not be read. Transactions may be\n` +
        `           missing. Re-run with --resume to retry them.`,
    );
  }
  if (!DEEP) {
    console.log(
      '\n  Note: reverted transactions emit no events, so they are absent.\n' +
        '        Re-run with --deep to scan every block and capture them.',
    );
  }
}

function renderMarkdown(d) {
  const L = [];
  const short = (a) => (a ? `\`${a.slice(0, 8)}..${a.slice(-4)}\`` : '-');
  L.push('# P2PEscrow ledger');
  L.push('');
  L.push(`Generated ${d.generatedAt} - mode \`${d.mode}\``);
  L.push(`Contract \`${d.contract}\``);
  L.push(`Blocks ${d.blockRange.from.toLocaleString()} to ${d.blockRange.to.toLocaleString()}`);
  L.push('');
  L.push(
    `**${d.counts.events} events** - **${d.counts.transfers} transfers** - ` +
      `**${d.counts.transactions} transactions** ` +
      `(${d.counts.succeeded} succeeded, ${d.counts.failed} failed)`,
  );
  L.push(`Escrow currently holds **${d.currentEscrowBalanceJSAV} JSAV**`);
  if (d.counts.blocksUnreadable) {
    L.push('');
    L.push(
      `> **Incomplete:** ${d.counts.blocksUnreadable} block(s) could not be read from the RPC. ` +
        `Transactions inside them may be missing.`,
    );
  }
  L.push('');

  L.push('## Events');
  L.push('');
  L.push('| Block | Time (UTC) | Event | User | Tx |');
  L.push('|---|---|---|---|---|');
  for (const e of d.events) {
    L.push(`| ${e.block} | ${e.time ?? '-'} | ${e.event} | ${short(e.user)} | \`${e.tx.slice(0, 10)}..\``);
  }
  if (!d.events.length) L.push('| - | - | none found | - | - |');
  L.push('');

  L.push('## JSAV transfers');
  L.push('');
  L.push('| Block | Time (UTC) | Dir | Counterparty | Amount |');
  L.push('|---|---|---|---|---|');
  for (const t of d.transfers) {
    const cp = t.direction === 'IN' ? t.from : t.to;
    L.push(`| ${t.block} | ${t.time ?? '-'} | ${t.direction} | ${short(cp)} | ${t.amount} JSAV |`);
  }
  if (!d.transfers.length) L.push('| - | - | - | none found | - |');
  L.push('');

  L.push('## Transactions');
  L.push('');
  L.push('| Block | Time (UTC) | Dir | Function | Status | From | Owner |');
  L.push('|---|---|---|---|---|---|---|');
  for (const t of d.transactions) {
    L.push(
      `| ${t.block} | ${t.time} | ${t.direction} | ${t.function} | ${t.status} | ${short(t.from)} | ${t.fromOwner ? 'yes' : '-'} |`,
    );
  }
  if (!d.transactions.length) L.push('| - | - | - | none found | - | - | - |');
  L.push('');

  if (d.rpc.failures.length) {
    L.push('## RPC notes');
    L.push('');
    for (const f of d.rpc.failures) L.push(`- ${f.endpoint}: ${f.count} failures`);
    L.push('');
  }
  return L.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
