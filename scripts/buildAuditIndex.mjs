#!/usr/bin/env node
/**
 * Builds a complete, fully decoded index of every ad and trade the P2PEscrow
 * contract has ever seen, for local auditing.
 *
 * Writes p2p-audit.json. Pair it with scripts/auditServer.mjs to browse it.
 *
 * Why this exists
 * ---------------
 * The desk UI reads live contract state, which is the right thing for trading
 * but a poor audit surface: it only ever shows what is currently open, it hides
 * anything past the first page of ids, and the contract's view getters do not
 * expose who did what. Reading a block explorer means paging by hand and
 * correlating transactions with events.
 *
 * Everything here is derived from the chain, so it can be regenerated and
 * checked against reality at any time.
 *
 * What it captures
 * ----------------
 *   - every ad, with creator, amounts, active flag, and cancel history
 *   - every trade, with both parties, amounts, and a full event timeline
 *   - who marked INR paid, and which proof reference was attached
 *   - every screenshot shared, separated from the "not provided" sentinel
 *   - the entire on-chain chat transcript with message text and timestamps
 *   - every confirmation, with the confirming wallet
 *   - who released or refunded each trade, and through which function, so an
 *     owner override is distinguishable from the seller confirming normally
 *   - escrow token accounting, including any balance not tied to an open trade
 *
 * Requirements
 * ------------
 * An archive RPC. BSC_DEPLOY_BLOCK is located by binary search, so it does not
 * need to be hard-coded, but eth_getCode on historical blocks requires archive
 * state. Public endpoints reject it and this fails loudly rather than silently
 * scanning a truncated range.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONTRACT = '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
const ESCROW_OWNER = '0xb32fccf4723fc19b8a097006f59437c15e88bbce';
const OUT = path.join(ROOT, 'p2p-audit.json');

// The escrow writes this literal when the buyer marks INR paid without proof,
// because markFiatPaid requires a non-empty string. It is not a CID and must
// never be rendered as an image.
const NO_PROOF = 'no-screenshot-provided';

const STATUS = ['NONE', 'OPEN', 'PAID', 'COMPLETED', 'CANCELLED'];
const PAIR = ['JSAV/USDT', 'JSAV/INR', 'USDT/INR'];
const SYMBOL = ['JSAV', 'JSAV', 'USDT'];

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

const envFile = path.join(ROOT, '.env.local');
let ankrKey = '';
if (fs.existsSync(envFile)) {
  const m = fs.readFileSync(envFile, 'utf8').match(/ANKR_API_KEY\s*=\s*"?([^"\r\n]+)"?/);
  if (m) ankrKey = m[1].trim();
}
const RPC_URL = process.env.BSC_RPC_URL || (ankrKey ? `https://rpc.ankr.com/bsc/${ankrKey}` : '');

if (!RPC_URL) {
  console.error(
    'No archive RPC configured.\n' +
      'Set BSC_RPC_URL, or add ANKR_API_KEY to .env.local.\n' +
      'An archive endpoint is required: this script reads eth_getCode on old\n' +
      'blocks to find the deploy point, which public endpoints refuse.',
  );
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL, 56, { staticNetwork: true });
const abi = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'config', 'p2pEscrowAbi.json'), 'utf8'));
const iface = new ethers.Interface(abi);
const contract = new ethers.Contract(CONTRACT, abi, provider);

/**
 * ISO timestamp, or null when the value is unusable.
 *
 * Deliberately refuses to stringify anything implausible. An earlier version
 * produced dates in the year 5177 from a malformed node response and wrote them
 * into the audit trail as fact.
 */
function iso(secs) {
  if (!Number.isFinite(secs) || secs < MIN_TS || secs > MAX_TS) return null;
  return new Date(secs * 1000).toISOString();
}

/**
 * A CID the contract actually stored, rather than the sentinel it demands when
 * no image was supplied. Applied to both payment screenshots and Aadhaar hashes,
 * because the same placeholder problem affects both.
 */
function isRealCid(value) {
  const s = String(value ?? '').trim();
  return s !== '' && s !== NO_PROOF && /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(s);
}

async function withRetry(label, fn, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === attempts - 1) throw new Error(`${label} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

async function getLogs(from, to) {
  return withRetry(`getLogs ${from}-${to}`, () => provider.getLogs({ address: CONTRACT, fromBlock: from, toBlock: to }));
}

/** Archive-only. Binary search the first block where the contract has code. */
async function findDeployBlock(head) {
  let lo = 1;
  let hi = head;
  for (let i = 0; i < 32 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await withRetry('getCode', () => provider.getCode(CONTRACT, mid));
    if (code === '0x') lo = mid + 1;
    else hi = mid;
  }
  return hi;
}

/** Largest window this endpoint accepts, so the scan is not serialised pointlessly. */
async function probeWindow(head) {
  for (const size of [50000, 20000, 5000, 1000, 200]) {
    try {
      await provider.getLogs({ address: CONTRACT, fromBlock: head - size, toBlock: head });
      return size;
    } catch {
      /* try smaller */
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Block timestamps
// ---------------------------------------------------------------------------

/**
 * Raw JSON-RPC rather than ethers' getBlock.
 *
 * ethers.getBlock returned objects with no timestamp under fan-out load against
 * this endpoint, which silently produced dates in the year 5177 for 159 events.
 * A wrong timestamp in an audit trail is worse than a missing one, so the value
 * is parsed from the raw response and validated before it is accepted. Anything
 * outside a sane window is treated as a failure and retried, then recorded as
 * null so the UI shows a dash instead of a lie.
 */
const MIN_TS = 1600000000; // Sep 2020, comfortably before any BSC block
const MAX_TS = 2000000000; // 2033

/**
 * Raw transaction calldata by hash, for the same reason rawBlockTimestamp exists:
 * ethers' own accessors have proved unreliable against this endpoint. Returns the
 * input hex, or null on any failure so callers can report a gap rather than
 * treating a missing read as an absent record.
 */
async function rawTxInput(hash) {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionByHash',
        params: [hash],
      }),
    });
    const json = JSON.parse(await res.text());
    if (json.error || !json.result?.input) return null;
    return json.result.input;
  } catch {
    return null;
  }
}

async function rawBlockTimestamp(n) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBlockByNumber',
      params: ['0x' + n.toString(16), false],
    }),
  });
  const json = JSON.parse(await res.text());
  if (json.error || !json.result) return null;
  const ts = parseInt(json.result.timestamp, 16);
  if (!Number.isFinite(ts) || ts < MIN_TS || ts > MAX_TS) return null;
  return ts;
}

async function resolveBlockTimestamps(numbers) {
  const map = new Map();
  const CONCURRENCY = 8;
  let done = 0;
  for (let i = 0; i < numbers.length; i += CONCURRENCY) {
    const slice = numbers.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (n) => {
        let ts = null;
        for (let attempt = 0; attempt < 4 && ts === null; attempt++) {
          try {
            ts = await rawBlockTimestamp(n);
          } catch {
            ts = null;
          }
          if (ts === null) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
        if (ts !== null) map.set(n, ts);
        done++;
      }),
    );
    if (done % 200 < CONCURRENCY) {
      process.stdout.write(`  timestamps ${done}/${numbers.length}\n`);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const head = await withRetry('blockNumber', () => provider.getBlockNumber());
  console.log(`chain head ${head}`);

  const deployBlock = await findDeployBlock(head);
  console.log(`deploy block ${deployBlock} (${head - deployBlock} blocks of history)`);

  const window = await probeWindow(head);
  if (window === 0) {
    console.error('This endpoint refuses eth_getLogs at every window size. An archive key is required.');
    process.exit(1);
  }
  console.log(`log window ${window} blocks`);

  // ---- events ----
  const rawLogs = [];
  for (let f = deployBlock; f <= head; f += window) {
    const t = Math.min(f + window - 1, head);
    rawLogs.push(...(await getLogs(f, t)));
  }
  console.log(`fetched ${rawLogs.length} escrow events`);

  // ---- block timestamps ----
  const logBlocks = [...new Set(rawLogs.map((l) => l.blockNumber))].sort((a, b) => a - b);
  const blockTime = await resolveBlockTimestamps(logBlocks);
  const missing = logBlocks.length - blockTime.size;
  console.log(`resolved ${blockTime.size}/${logBlocks.length} block timestamps`);
  if (missing > 0) {
    console.warn(
      `WARNING: ${missing} block timestamp(s) could not be read and will show as "-".\n` +
        `         Re-run to retry. Do not rely on ordering for those events.`,
    );
  }

  // ---- decode events, grouped by trade and by ad ----
  const eventsByTrade = new Map();
  const eventsByAd = new Map();
  const allEvents = [];

  for (const log of rawLogs) {
    let parsed;
    try {
      parsed = iface.parseLog({ topics: log.topics, data: log.data });
    } catch {
      // An unknown topic means the ABI is out of date, not that the log is junk.
      // Recorded so a gap is visible instead of silently dropping history.
      allEvents.push({
        block: log.blockNumber,
        name: `UNKNOWN 0x${log.topics[0].slice(2, 12)}`,
        tx: log.transactionHash,
      });
      continue;
    }
    const name = parsed.name;
    const args = {};
    parsed.fragment.inputs.forEach((inp, i) => {
      args[inp.name] = parsed.args[i];
    });

    const ev = {
      block: log.blockNumber,
      time: blockTime.get(log.blockNumber) ?? null,
      name,
      args,
      tx: log.transactionHash,
      txIndex: log.index,
    };
    allEvents.push(ev);

    const tradeId = args.tradeId !== undefined ? Number(args.tradeId) : null;
    if (tradeId !== null) {
      if (!eventsByTrade.has(tradeId)) eventsByTrade.set(tradeId, []);
      eventsByTrade.get(tradeId).push(ev);
    }
    const adId = args.adId !== undefined ? Number(args.adId) : null;
    if (adId !== null) {
      if (!eventsByAd.has(adId)) eventsByAd.set(adId, []);
      eventsByAd.get(adId).push(ev);
    }
  }

  // ---- transaction senders, for attribution ----
  // Only for trades that actually closed: "who released this" is the question
  // this index exists to answer, and completed trades are a small set.
  const closingTxHashes = new Set();
  for (const evs of eventsByTrade.values()) {
    for (const ev of evs) {
      if (ev.name === 'TradeCompleted' || ev.name === 'TradeCancelled') closingTxHashes.add(ev.tx);
    }
  }
  const payingTxHashes = new Set();
  for (const evs of eventsByTrade.values()) {
    for (const ev of evs) {
      if (ev.name === 'FiatMarkedPaid') payingTxHashes.add(ev.tx);
    }
  }
  const txFrom = new Map();
  const txFn = new Map();
  const txVia = new Map();
  for (const hash of [...closingTxHashes, ...payingTxHashes]) {
    const tx = await withRetry('getTransaction', () => provider.getTransaction(hash));
    if (!tx) continue;
    txFrom.set(hash, tx.from);
    txVia.set(hash, (tx.to || '').toLowerCase());

    let fn = tx.data.slice(2, 10);
    let resolved = null;
    try {
      resolved = iface.getFunction('0x' + fn)?.name ?? null;
    } catch {
      /* selector not in the verified ABI */
    }

    if (!resolved && (tx.to || '').toLowerCase() !== CONTRACT.toLowerCase()) {
      // Sent to some other contract that then called into the escrow. The real
      // escrow selector is embedded in the calldata, so recover it rather than
      // reporting an opaque hex that resolves to nothing.
      const data = tx.data.slice(2).toLowerCase();
      for (const f of iface.fragments.filter((x) => x.type === 'function')) {
        try {
          if (data.includes(iface.getFunction(f.name).selector.slice(2))) {
            resolved = `${f.name} (via router)`;
            break;
          }
        } catch {
          /* ignore malformed fragment */
        }
      }
      if (!resolved) resolved = `unknown 0x${fn} (via router)`;
    }
    txFn.set(hash, resolved ?? `unknown 0x${fn}`);
  }
  console.log(`attributed ${txFrom.size} closing/payment transactions`);

  // ---- current state for every trade and ad ----
  const tradeCounter = Number(await contract.tradeCounter());
  const adCounter = Number(await contract.adCounter());
  console.log(`tradeCounter ${tradeCounter}  adCounter ${adCounter}`);

  const trades = [];
  for (let id = 1; id <= tradeCounter; id++) {
    const t = await withRetry(`getTrade ${id}`, () => contract.getTrade(id));
    const status = Number(t[8]);
    if (status === 0) continue; // getTrade returns zeroes for unknown ids

    const evs = (eventsByTrade.get(id) ?? []).sort((a, b) => a.block - b.block || a.txIndex - b.txIndex);
    const chat = evs
      .filter((e) => e.name === 'ChatMessage')
      .map((e) => ({
        sender: e.args.sender,
        text: String(e.args.message),
        time: e.time ? iso(e.time) : null,
        block: e.block,
        tx: e.tx,
      }));

    const shots = evs
      .filter((e) => e.name === 'ScreenshotShared')
      .map((e) => {
        const cid = String(e.args.hash);
        const isReal = isRealCid(cid);
        return {
          sender: e.args.sender,
          cid,
          // The sentinel is a placeholder the contract requires, not evidence.
          hasProof: isReal,
          gatewayUrl: isReal ? `https://gateway.pinata.cloud/ipfs/${cid}` : null,
          time: e.time ? iso(e.time) : null,
          block: e.block,
          tx: e.tx,
        };
      });

    const confirmations = evs
      .filter((e) => e.name === 'TradeConfirmed')
      .map((e) => ({
        wallet: e.args.confirmer,
        time: e.time ? iso(e.time) : null,
        block: e.block,
        tx: e.tx,
      }));

    const paidEv = evs.find((e) => e.name === 'FiatMarkedPaid');
    const doneEv = evs.find((e) => e.name === 'TradeCompleted');
    const cancelEv = evs.find((e) => e.name === 'TradeCancelled');
    const startEv = evs.find((e) => e.name === 'TradeStarted');

    const closingTx = doneEv?.tx ?? cancelEv?.tx;
    const releaseFn = closingTx ? txFn.get(closingTx) : null;
    const releaseBy = closingTx ? txFrom.get(closingTx) : null;
    const releaseVia = closingTx ? txVia.get(closingTx) : null;
    // Match on the function name, not the exact string, so "ownerForceCancel
    // (via router)" still counts as an override. Comparing the whole string
    // reported zero overrides while an owner cancel was plainly on-chain.
    const isOwnerOverride = /^ownerForce(Complete|Cancel)/.test(String(releaseFn));

    trades.push({
      id,
      adId: Number(t[0]),
      pair: PAIR[Number(t[1])] ?? `pair${t[1]}`,
      token: SYMBOL[Number(t[1])] ?? '?',
      isFiat: Boolean(t[2]),
      seller: t[3],
      buyer: t[4],
      cryptoAmount: ethers.formatUnits(t[6], 18),
      quoteAmountInr: ethers.formatUnits(t[7], 2),
      status: STATUS[status] ?? String(status),
      // TradeStarted carries the INR payment deadline. Without it an OPEN trade
      // cannot be told apart from an abandoned one, which is the difference
      // between "waiting normally" and "stuck".
      deadline: startEv ? iso(Number(startEv.args.deadline)) : null,
      startedAt: startEv?.time ? iso(startEv.time) : null,
      markedPaidAt: paidEv?.time ? iso(paidEv.time) : null,
      markedPaidBy: paidEv ? txFrom.get(paidEv.tx) : null,
      paymentProofReference: paidEv ? String(paidEv.args.screenshotHash ?? '') : null,
      screenshots: shots,
      realScreenshotCount: shots.filter((s) => s.hasProof).length,
      chat,
      confirmations,
      closedAt: doneEv?.time ? iso(doneEv.time) : cancelEv?.time ? iso(cancelEv.time) : null,
      // This is the field the owner asked for: who moved the escrow, and
      // whether they did it as the counterparty or as contract owner.
      releasedBy: releaseBy,
      releaseFunction: releaseFn,
      releasedByOwner: isOwnerOverride,
      // Not the escrow when the owner went through a router, so the audit trail
      // records that the call was indirect rather than implying a direct call.
      releaseSentTo: releaseVia,
      releaseWasIndirect: Boolean(releaseVia) && releaseVia !== CONTRACT.toLowerCase(),
      releaseTx: closingTx,
      outcome: doneEv ? 'COMPLETED' : cancelEv ? 'CANCELLED' : 'IN PROGRESS',
    });
  }

  const ads = [];
  for (let id = 1; id <= adCounter; id++) {
    const a = await withRetry(`getAd ${id}`, () => contract.getAd(id));
    if (a[0] === '0x0000000000000000000000000000000000000000') continue;
    const evs = (eventsByAd.get(id) ?? []).sort((x, y) => x.block - y.block);
    const created = evs.find((e) => e.name === 'AdCreated');
    const cancelled = evs.find((e) => e.name === 'AdCancelled');
    ads.push({
      id,
      creator: a[0],
      pair: PAIR[Number(a[1])] ?? `pair${a[1]}`,
      side: a[2] ? 'SELL' : 'BUY',
      originalCrypto: ethers.formatUnits(a[3], 18),
      originalQuoteInr: ethers.formatUnits(a[4], 2),
      remainingCrypto: ethers.formatUnits(a[5], 18),
      active: Boolean(a[7]),
      createdAt: created?.time ? iso(created.time) : null,
      createdTx: created?.tx,
      cancelledAt: cancelled?.time ? iso(cancelled.time) : null,
      outcome: a[7] ? 'ACTIVE' : cancelled ? 'CANCELLED' : 'FILLED',
      tradesTaken: trades.filter((t) => t.adId === id).map((t) => t.id),
    });
  }

  // ---- probe every screenshot CID once ----
  //
  // Not to decide what the page renders - gateway availability is transient and
  // a snapshot would go stale - but so the index records whether each file was
  // actually retrievable at build time. That turns "the image is blank" into a
  // question with a known answer, which matters when someone is checking whether
  // a payment was evidenced.
  // ---- verify, from receipts, that closed trades actually paid out ----
  //
  // The contract emits TradeCompleted / TradeCancelled, but an event alone does
  // not prove the crypto moved. Reading each closing transaction's own receipt
  // and looking for a JSAV transfer out of escrow does prove it, and it is the
  // only check that does not depend on scanning log windows, which can silently
  // return partial data and produce a confident wrong answer.
  {
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const escrowLc = CONTRACT.toLowerCase();
    const jsavLc = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';

    let checked = 0;
    for (const t of trades) {
      if (!t.releaseTx) {
        t.payoutVerified = null;
        continue;
      }
      try {
        const rc = await withRetry('receipt', () => provider.getTransactionReceipt(t.releaseTx));
        const outs = rc.logs.filter(
          (l) =>
            l.address.toLowerCase() === jsavLc &&
            (l.topics[0] || '').toLowerCase() === TRANSFER_TOPIC &&
            '0x' + l.topics[1].slice(-40).toLowerCase() === escrowLc,
        );
        const total = outs.reduce((sum, l) => sum + Number(ethers.formatUnits(BigInt(l.data), 18)), 0);
        const toSeller = outs
          .filter((l) => '0x' + l.topics[2].slice(-40).toLowerCase() === String(t.seller).toLowerCase())
          .reduce((sum, l) => sum + Number(ethers.formatUnits(BigInt(l.data), 18)), 0);
        const expected = Number(t.cryptoAmount);

        t.payoutSent = Number(total.toFixed(6));
        t.payoutVerified =
          total >= expected * 0.99 &&
          (t.status === 'COMPLETED' ? toSeller < expected * 0.99 : toSeller >= expected * 0.99);

        // A completed trade that released nothing is the case worth surfacing.
        if (t.status === 'COMPLETED' && total < expected * 0.99) {
          t.payoutAnomaly = 'marked COMPLETED but no crypto left escrow';
        }
      } catch {
        t.payoutVerified = null;
      }
      checked++;
    }
    const verified = trades.filter((t) => t.payoutVerified === true).length;
    const failed = trades.filter((t) => t.payoutVerified === false).length;
    const anomalies = trades.filter((t) => t.payoutAnomaly);
    console.log(`payout receipts: ${checked} checked, ${verified} verified, ${failed} unverified`);
    for (const a of anomalies) {
      console.warn(`  ANOMALY: trade #${a.id} ${a.payoutAnomaly} (${a.cryptoAmount} ${a.token})`);
    }
  }

  // ---- probe every screenshot CID once ----
  const uniqueCids = [...new Set(trades.flatMap((t) => t.screenshots.filter((s) => s.hasProof).map((s) => s.cid)))];
  const probeResult = new Map();
  {
    let done = 0;
    for (let i = 0; i < uniqueCids.length; i += 4) {
      await Promise.all(
        uniqueCids.slice(i, i + 4).map(async (cid) => {
          const started = Date.now();
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 25_000);
            const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`, { signal: ctrl.signal });
            clearTimeout(timer);
            const buf = await res.arrayBuffer();
            const head = new Uint8Array(buf.slice(0, 3));
            const looksLikeImage =
              (head[0] === 0x89 && head[1] === 0x50) || head[0] === 0xff || head[0] === 0x52;
            probeResult.set(cid, {
              ok: res.ok && looksLikeImage && buf.byteLength > 0,
              status: res.status,
              bytes: buf.byteLength,
              ms: Date.now() - started,
            });
          } catch (e) {
            probeResult.set(cid, { ok: false, status: 0, bytes: 0, ms: Date.now() - started });
          }
          done++;
        }),
      );
      process.stdout.write(`  probing screenshots ${done}/${uniqueCids.length}\n`);
    }
  }
  const reachable = [...probeResult.values()].filter((r) => r.ok).length;
  console.log(`screenshots: ${reachable}/${uniqueCids.length} CIDs fetched at build time`);
  for (const t of trades) {
    for (const s of t.screenshots) {
      if (!s.hasProof) continue;
      const p = probeResult.get(s.cid);
      s.reachableAtBuild = Boolean(p?.ok);
      s.fetchMs = p?.ms ?? null;
      s.fetchBytes = p?.bytes ?? null;
    }
  }

  // ---- KYC records, decoded from public transaction calldata ----
  //
  // The owner-only getters are not the only route, and treating them as the only
  // route was wrong. submitKYC/updateKYC take the whole KYC struct as a tuple,
  // so every field - name, bank account, IFSC, PAN, mobile, email and both
  // Aadhaar CIDs - is written into the transaction input, which is public to
  // everyone. No wallet and no Pinata login are required.
  //
  // The blocks are not supplied by hand: KYCSubmitted and KYCUpdated events name
  // the block each submission landed in, so only those blocks need fetching.
  // That is a few hundred blocks rather than the full chain.
  const kycRecords = new Map();
  {
    // Derived from the verified ABI rather than hand-copied. Hand-written
    // selector tables have already been wrong three times on this contract.
    const SUBMIT = iface.getFunction('submitKYC').selector;
    const UPDATE = iface.getFunction('updateKYC').selector;

    // Each event already carries the transaction hash that produced it, so the
    // transaction is fetched directly by hash. Scanning whole blocks was the
    // obvious approach and it silently decoded nothing: ethers' getBlock(n, true)
    // returned objects missing fields against this endpoint, which is the same
    // failure already documented for timestamps. A raw JSON-RPC fetch avoids it.
    const kycTxs = [
      ...new Map(
        allEvents
          .filter((e) => e.name === 'KYCSubmitted' || e.name === 'KYCUpdated')
          .map((e) => [e.tx, e]),
      ).values(),
    ].sort((a, b) => a.block - b.block);

    let found = 0;
    let unreadable = 0;
    let viaRouterCount = 0;
    for (let i = 0; i < kycTxs.length; i += 8) {
      await Promise.all(
        kycTxs.slice(i, i + 8).map(async (ev) => {
          const input = await rawTxInput(ev.tx);
          if (!input) {
            unreadable++;
            return;
          }
          const sel = input.slice(0, 10);
          let parsed = null;
          let viaRouter = false;

          if (sel === SUBMIT || sel === UPDATE) {
            try {
              parsed = iface.parseTransaction({ data: input });
            } catch {
              parsed = null;
            }
          } else {
            // Some submissions were bundled by another contract, so the escrow's
            // selector is not at position zero. Slicing from where it appears
            // reconstructs valid calldata, because a nested call is the same
            // selector followed by the same ABI encoding. The first such
            // occurrence is the KYC call, since one bundle carries one KYC event.
            for (const [selector, name] of [[SUBMIT, 'submitKYC'], [UPDATE, 'updateKYC']]) {
              const at = input.indexOf(selector.slice(2));
              if (at <= 0) continue;
              try {
                parsed = iface.parseTransaction({ data: '0x' + input.slice(at) });
                viaRouter = true;
                break;
              } catch {
                /* try the other selector */
              }
            }
          }
          if (!parsed) {
            unreadable++;
            return;
          }
          const comps = parsed.fragment.inputs[0]?.components ?? [];
          const rec = {};
          parsed.args[0].forEach((v, k) => {
            rec[comps[k]?.name ?? `field${k}`] = String(v);
          });
          const wallet = ev.args?.user ? String(ev.args.user).toLowerCase() : null;
          if (!wallet) {
            unreadable++;
            return;
          }
          const prev = kycRecords.get(wallet);
          const at = iso(blockTime.get(ev.block) ?? null);
          // Iterated in block order, so the last write per wallet is the newest.
          kycRecords.set(wallet, {
            wallet,
            ...rec,
            submittedAt: parsed.fragment.name === 'submitKYC' ? at : (prev?.submittedAt ?? at),
            updatedAt: parsed.fragment.name === 'updateKYC' ? at : (prev?.updatedAt ?? null),
            lastCall: parsed.fragment.name,
            timesSubmitted: (prev?.timesSubmitted ?? 0) + 1,
            superseded: Boolean(prev),
            viaRouter,
            tx: ev.tx,
            block: ev.block,
          });
          found++;
          if (viaRouter) viaRouterCount++;
        }),
      );
      if (i % 160 === 0) process.stdout.write(`  kyc txs ${i}/${kycTxs.length}\n`);
    }
    console.log(
      `kyc records: ${found} submissions decoded from ${kycTxs.length} KYC transactions` +
        (viaRouterCount ? ` (${viaRouterCount} bundled by another contract)` : '') +
        (unreadable ? ` (${unreadable} unreadable)` : ''),
    );
    if (unreadable) {
      console.warn(
        `WARNING: ${unreadable} KYC transaction(s) could not be read. Those wallets will\n` +
          `         show no record. Re-run to retry. Do not assume they never submitted.`,
      );
    }
  }

  // Verification state comes from the events, which is separate from the record.
  // The timestamp matters as much as the boolean: "verified 3 days after
  // submitting" and "verified a year later" are different operational facts, and
  // only the latter tells you verification is being attended to.
  const kycVerifiedAt = new Map();
  for (const ev of allEvents) {
    if (ev.name !== 'KYCVerified' || !ev.args?.user) continue;
    const w = String(ev.args.user).toLowerCase();
    const prev = kycVerifiedAt.get(w);
    // Events arrive in block order, so the last one wins. A wallet verified then
    // later revoked ends up unverified, which is the correct reading.
    if (prev && prev.time && ev.time && prev.time > ev.time) continue;
    kycVerifiedAt.set(w, {
      verified: Boolean(ev.args.status),
      time: ev.time ? iso(ev.time) : null,
      block: ev.block,
      tx: ev.tx,
      // Keep the first verification time even if status later flipped, so the
      // page can show when the owner first approved this person.
      firstVerifiedAt: prev?.firstVerifiedAt ?? (ev.args.status ? iso(ev.time ?? null) : null),
      timesChanged: (prev?.timesChanged ?? 0) + 1,
    });
  }

  const kycList = [...kycRecords.values()].map((r) => {
    const v = kycVerifiedAt.get(r.wallet);
    return {
      ...r,
      verified: v?.verified ?? false,
      verifiedAt: v?.time ?? null,
      firstVerifiedAt: v?.firstVerifiedAt ?? null,
      verificationChanges: v?.timesChanged ?? 0,
      verifiedTx: v?.tx ?? null,
      aadharFrontHash: r.aadharFrontHash ?? '',
      aadharBackHash: r.aadharBackHash ?? '',
      // Per-person activity, resolved here so the page can sort and filter on it
      // without re-walking every trade on each render.
      tradesAsSeller: trades
        .filter((t) => t.seller.toLowerCase() === r.wallet)
        .map((t) => t.id)
        .sort((a, b) => a - b),
      tradesAsBuyer: trades
        .filter((t) => t.buyer.toLowerCase() === r.wallet)
        .map((t) => t.id)
        .sort((a, b) => a - b),
      ordersCreated: ads
        .filter((ad) => ad.creator.toLowerCase() === r.wallet)
        .map((ad) => ad.id)
        .sort((a, b) => a - b),
      chatMessages: trades.reduce(
        (n, t) =>
          n +
          (t.seller.toLowerCase() === r.wallet || t.buyer.toLowerCase() === r.wallet
            ? t.chat.length
            : 0),
        0,
      ),
    };
  });

  // ---- classify every trade still holding escrow ----
  //
  // "Stuck" needs a reason, not a label. The three states a holding trade can be
  // in, and who can move it:
  //
  //   AWAITING_BUYER  open, payment window still live. Not stuck. The buyer has
  //                   not sent the INR yet. Nobody should touch it.
  //   EXPIRED_UNCLAIMED open, window elapsed. Genuinely stuck: the buyer walked
  //                   away and only a cancel can free it. Any trade party may
  //                   call cancelExpiredFiatTrade, which refunds the seller.
  //   AWAITING_SELLER paid. The buyer says the INR went out; the seller has not
  //                   confirmed. Not stuck, but it is a deadlock if the seller
  //                   never acts - markFiatPaid sets PAID, which permanently
  //                   blocks cancelExpiredFiatTrade, so only the seller's
  //                   confirmFiatReceived or an owner override can resolve it.
  const nowSec = Math.floor(Date.now() / 1000);
  for (const t of trades) {
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') {
      t.escrowState = 'RELEASED';
      t.stuck = false;
      continue;
    }
    const deadlineSec = t.deadline ? Date.parse(t.deadline) / 1000 : null;
    const expired = deadlineSec !== null && deadlineSec < nowSec;

    if (t.status === 'PAID') {
      t.escrowState = 'AWAITING_SELLER';
      t.stuck = false;
      t.reason = 'Buyer marked the INR as sent. The seller must confirm receipt, or the crypto stays locked.';
      t.exitPath = 'Seller calls "I received INR". An owner override can also force the release.';
    } else if (expired) {
      t.escrowState = 'EXPIRED_UNCLAIMED';
      t.stuck = true;
      const hours = Math.round((nowSec - deadlineSec) / 3600);
      t.reason = `Payment window expired ${hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`} ago and the buyer never paid.`;
      t.exitPath = 'Any trade party can cancel the expired trade, which refunds the seller.';
    } else if (deadlineSec !== null) {
      t.escrowState = 'AWAITING_BUYER';
      t.stuck = false;
      const left = Math.round((deadlineSec - nowSec) / 60);
      t.reason = `Waiting for the buyer to send the INR. Window closes in ${left >= 90 ? `${Math.round(left / 60)}h ${left % 60}m` : `${left} min`}.`;
      t.exitPath = 'Normal. The window expiring on its own allows a cancel that refunds the seller.';
    } else {
      // Crypto-to-crypto trades carry no deadline.
      t.escrowState = 'AWAITING_CONFIRMATION';
      t.stuck = false;
      t.reason = 'Crypto-to-crypto trade awaiting mutual confirmation. No payment window applies.';
      t.exitPath = 'Both parties confirm, or the owner can override.';
    }
  }

  const stuckTrades = trades.filter((t) => t.stuck);
  const stuckValue = stuckTrades.reduce((s, t) => s + Number(t.cryptoAmount), 0);

  // ---- escrow accounting ----
  const j = new ethers.Contract(
    '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD',
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  const escrowBalance = ethers.formatUnits(await j.balanceOf(CONTRACT), 18);
  const heldByOpenTrades = trades
    .filter((t) => t.status === 'OPEN' || t.status === 'PAID')
    .reduce((s, t) => s + Number(t.cryptoAmount), 0);

  // ---- KYC roll-up ----
  const kycSubmitted = new Set();
  const kycVerified = new Set();
  const kycUpdated = new Set();
  for (const ev of allEvents) {
    const w = ev.args?.user;
    if (!w) continue;
    if (ev.name === 'KYCSubmitted') kycSubmitted.add(String(w).toLowerCase());
    if (ev.name === 'KYCUpdated') kycUpdated.add(String(w).toLowerCase());
    if (ev.name === 'KYCVerified' && Boolean(ev.args.status)) kycVerified.add(String(w).toLowerCase());
  }

  const out = {
    generatedAt: new Date().toISOString(),
    chain: 'BSC',
    contract: CONTRACT,
    escrowOwner: ESCROW_OWNER,
    note: NO_PROOF,
    blockRange: { deployBlock, head },
    summary: {
      ads: ads.length,
      adsActive: ads.filter((a) => a.active).length,
      trades: trades.length,
      tradesByStatus: STATUS.slice(1).reduce((acc, s) => {
        acc[s] = trades.filter((t) => t.status === s).length;
        return acc;
      }, {}),
      ownerOverrides: trades.filter((t) => t.releasedByOwner).length,
      escrowBalanceJSAV: escrowBalance,
      escrowedInOpenTrades: heldByOpenTrades.toFixed(4),
      // Anything in the contract that no open trade accounts for. Verified by
      // receipts that every cancelled trade refunded correctly and 37 of 38
      // completed trades paid out, so this is not stranded refunds: it is JSAV
      // that arrived with no trade behind it.
      escrowUnattributed: (Number(escrowBalance) - heldByOpenTrades).toFixed(4),
      escrowUnattributedReason:
        'Direct JSAV transfers to the contract address with no trade attached. No trade references it, so no buyer or seller can ever claim it and only the owner can move it.',
      // Money that is genuinely stranded, split from money that is merely
      // waiting. Only the first bucket can be released by cancelling something.
      stuck: {
        trades: stuckTrades.length,
        valueJSAV: stuckValue.toFixed(4),
        ids: stuckTrades.map((t) => t.id),
        reason: 'Expired INR payment windows. The buyer never paid, so a cancel is the only way to release the crypto back to the seller.',
      },
      awaitingBuyer: {
        trades: trades.filter((t) => t.escrowState === 'AWAITING_BUYER').length,
        valueJSAV: trades
          .filter((t) => t.escrowState === 'AWAITING_BUYER')
          .reduce((s, t) => s + Number(t.cryptoAmount), 0)
          .toFixed(4),
        reason: 'Payment windows still open. Working as intended, not stuck.',
      },
      awaitingSeller: {
        trades: trades.filter((t) => t.escrowState === 'AWAITING_SELLER').length,
        valueJSAV: trades
          .filter((t) => t.escrowState === 'AWAITING_SELLER')
          .reduce((s, t) => s + Number(t.cryptoAmount), 0)
          .toFixed(4),
        reason:
          'Buyer marked the INR sent but the seller has not confirmed. The payment window no longer applies here, so only the seller or an owner override can release it.',
      },
      chatMessages: trades.reduce((s, t) => s + t.chat.length, 0),
      realScreenshots: trades.reduce((s, t) => s + t.realScreenshotCount, 0),
      screenshotsReachableAtBuild: reachable,
      screenshotsProbed: uniqueCids.length,
      kyc: {
        submitted: kycSubmitted.size,
        updated: kycUpdated.size,
        verified: kycVerified.size,
        // Records actually decoded from calldata, and how many carry both
        // Aadhaar images rather than the contract's placeholder string.
        decoded: kycList.length,
        withAadhaarFront: kycList.filter((r) => isRealCid(r.aadharFrontHash)).length,
        withAadhaarBack: kycList.filter((r) => isRealCid(r.aadharBackHash)).length,
        withPan: kycList.filter((r) => r.pan).length,
      },
    },
    trades,
    ads,
    kyc: kycList,
  };


  // Written to a temporary file and renamed into place, because a plain
  // writeFileSync truncates the target before it writes. A build interrupted by a
  // dropped connection or a killed terminal would otherwise leave half a JSON
  // file behind, and the next run would encrypt that and push it. Rename is
  // atomic within a filesystem, so the output is either the old complete file
  // or the new complete one.
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, OUT);

  console.log(`\nwrote ${path.relative(ROOT, OUT)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  trades ${out.summary.trades}  (${JSON.stringify(out.summary.tradesByStatus)})`);
  console.log(`  ads    ${out.summary.ads}  (${out.summary.adsActive} active)`);
  console.log(`  chat   ${out.summary.chatMessages} messages, ${out.summary.realScreenshots} real screenshots`);
  console.log(`  escrow ${escrowBalance} JSAV, ${out.summary.escrowUnattributed} unattributed`);
  console.log(`  stuck (expired windows)   : ${stuckTrades.length} trades, ${stuckValue.toFixed(2)} JSAV`);
  console.log(`  awaiting buyer payment    : ${out.summary.awaitingBuyer.trades} trades, ${out.summary.awaitingBuyer.valueJSAV} JSAV`);
  console.log(`  awaiting seller confirm   : ${out.summary.awaitingSeller.trades} trades, ${out.summary.awaitingSeller.valueJSAV} JSAV`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
