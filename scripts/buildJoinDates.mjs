/**
 * Builds src/data/userJoinDates.json  ->  { "0xaddr": "2024-03-15T10:24:00Z", ... }
 *
 * The JSAVIOR contract stores no registration timestamp, so the join date is
 * derived from the first on-chain moment a wallet paid into the contract
 * (the REG_FEE transfer that register()/registerWithStable() performs).
 *
 * Strategy (single pass over the chain, then a batched verification pass):
 *   1. Scan every log emitted by the contract from the deploy block to head.
 *      A Transfer whose `to` is the contract itself is a STRONG join signal
 *      (the registration fee). RankUpdated / Withdraw topics are WEAK signals
 *      used only as a fallback candidate list.
 *   2. Same for USDT/USDC transfers into the contract (registerWithStable).
 *   3. Verify every candidate against users(address).registered.
 *   4. Close the referral tree so referrers without a log are not missed.
 *   5. Resolve every surviving block number to its exact timestamp.
 *
 * All RPC traffic is sent as JSON-RPC batches (100 calls per HTTP request)
 * so the free-tier endpoints are hit with a few hundred requests, not 12k.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

/**
 * The Ankr key comes from the environment first (CI passes it as a secret),
 * then from .env.local as a fallback for local runs.
 */
function readAnkrKey() {
  if (process.env.ANKR_API_KEY) return process.env.ANKR_API_KEY.trim();
  try {
    const env = fs.readFileSync('.env.local', 'utf8');
    return env.match(/ANKR_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1]?.trim();
  } catch {
    return undefined;
  }
}
const ankr = readAnkrKey();

const RPC_URLS = ankr
  ? [
      `https://rpc.ankr.com/bsc/${ankr}`,
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc-rpc.publicnode.com',
    ]
  : ['https://bsc-dataseed1.binance.org', 'https://bsc-dataseed2.binance.org', 'https://bsc-rpc.publicnode.com'];
const ANKR_URL = `https://rpc.ankr.com/bsc/${ankr}`;

const JSAV = ethers.getAddress('0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD');
const JSAV_LC = JSAV.toLowerCase();
const JSAV_TOPIC = '0x' + JSAV_LC.slice(2).padStart(64, '0');
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';

const DEPLOY = 86656188;
const ZERO = '0x0000000000000000000000000000000000000000';

const iface = new ethers.Interface(
  JSON.parse(fs.readFileSync('src/config/jsaviorAbi.json', 'utf8')),
);
const SEL_USERS = iface.getFunction('users(address)').selector;

const T_TRANSFER = ethers.id('Transfer(address,address,uint256)');
const T_RANK = ethers.id('RankUpdated(address,uint8,uint8)');
const T_WITHDRAW = ethers.id('Withdraw(address,address,uint256,uint256)');

/* ------------------------------------------------------------------ RPC -- */

let rpcUrl = RPC_URLS[0];
let rpcId = 1;

/**
 * Sends a JSON-RPC batch to one endpoint and returns the responses in the
 * same order as the requests. Per-call errors are returned as-is (the caller
 * decides what to do with them); only transport failures are retried here.
 */
async function rpcOn(url, calls) {
  if (!calls.length) return [];
  const ids = calls.map(() => rpcId++);
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: ids[i], ...c }));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error(json?.error?.message ?? `non-batch response (${res.status})`);
      }
      const byId = new Map(json.map((x) => [x.id, x]));
      return ids.map((id) => byId.get(id) ?? { id, error: { message: 'missing response' } });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Batch RPC against the current endpoint, rotating on transport failure. */
async function rpcBatch(calls) {
  try {
    return await rpcOn(rpcUrl, calls);
  } catch (e) {
    rpcUrl = RPC_URLS[(RPC_URLS.indexOf(rpcUrl) + 1) % RPC_URLS.length];
    console.log(`  [rpc] rotating to ${rpcUrl} after error: ${e?.message}`);
    return rpcBatch(calls);
  }
}

async function rpcOne(method, params) {
  const [r] = await rpcBatch([{ method, params }]);
  if (r?.error) throw new Error(r.error.message ?? JSON.stringify(r.error));
  return r.result;
}

/* --------------------------------------------------------------- helpers -- */

const addrOf = (topic) => '0x' + topic.slice(26).toLowerCase();
const isAddr = (a) => typeof a === 'string' && a.length === 42 && a !== ZERO;

function padAddr(a) {
  return a.slice(2).toLowerCase().padStart(64, '0');
}

/* ----------------------------------------------------------------- scan -- */

const strong = new Map(); // addr -> block (paid into the contract)
const weak = new Map(); // addr -> block (any other on-chain touch)
const strongTx = new Map(); // addr -> tx hash of that first payment
const undatable = new Set(); // registered, but no payment block could be found

function note(map, addr, block) {
  if (!isAddr(addr)) return;
  const prev = map.get(addr);
  if (prev === undefined || block < prev) map.set(addr, block);
}

/** Records the earliest payment into the contract, keeping its tx hash. */
function notePayment(addr, block, txHash) {
  if (!isAddr(addr)) return;
  const prev = strong.get(addr);
  if (prev === undefined || block < prev) {
    strong.set(addr, block);
    strongTx.set(addr, txHash);
  }
}

async function getLogsChunk(address, fromBlock, toBlock, topics) {
  const params = [
    {
      address,
      // Ankr (and other strict nodes) reject numeric block tags - they must be hex strings.
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
    },
  ];
  if (topics) params[0].topics = topics;
  // History is only served by the Ankr endpoint; the public ones either block
  // eth_getLogs or refuse archive ranges.
  const [r] = await rpcOn(ANKR_URL, [{ method: 'eth_getLogs', params }]);
  if (r?.error) throw new Error(r.error.message ?? JSON.stringify(r.error));
  return r.result ?? [];
}

/**
 * Fetch a log window, splitting the range when the node complains it is too
 * wide or would return too many results. Throws when a window cannot be
 * retrieved at all - a silently skipped window would silently drop users.
 */
async function fetchLogs(address, fromBlock, toBlock, topics) {
  const from = fromBlock;
  const to = toBlock;

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await getLogsChunk(address, from, to, topics);
    } catch (e) {
      const msg = e.message ?? String(e);

      // the node tells us which range it is willing to serve
      const hint = msg.match(/retry with the range (\d+)-(\d+)/);
      if (hint) {
        const hi = Number(hint[2]);
        if (hi > from && hi < to) {
          const a = await fetchLogs(address, from, hi, topics);
          const b = await fetchLogs(address, hi + 1, to, topics);
          return a.concat(b);
        }
      }

      const tooBig = /max results|too large|exceed|range|limit/i.test(msg);
      if (tooBig && to - from > 1000) {
        const mid = Math.floor((from + to) / 2);
        const tail = await fetchLogs(address, from, mid, topics);
        const head = await fetchLogs(address, mid + 1, to, topics);
        return tail.concat(head);
      }

      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(`could not fetch logs ${address} ${from}-${to}`);
}

async function scanContractLogs(head, start = DEPLOY) {
  console.log(`\n--- 1. scanning contract logs (${(head - start + 1).toLocaleString()} blocks) ---`);
  let win = 500000;
  let s = start;
  let done = 0;
  const total = Math.ceil((head - start + 1) / win);
  while (s <= head) {
    const to = Math.min(s + win - 1, head);
    const logs = await fetchLogs(JSAV, s, to);
    for (const l of logs) {
      const bn = parseInt(l.blockNumber, 16);
      const t0 = l.topics[0]?.toLowerCase();
      if (t0 === T_TRANSFER) {
        const from = addrOf(l.topics[1]);
        const to2 = addrOf(l.topics[2]);
        if (to2 === JSAV_LC) notePayment(from, bn, l.transactionHash);
        else note(weak, from, bn);
        note(weak, to2, bn);
      } else if (t0 === T_RANK) {
        note(weak, addrOf(l.topics[1]), bn);
      } else if (t0 === T_WITHDRAW) {
        note(weak, addrOf(l.topics[1]), bn);
      }
    }
    done++;
    s = to + 1;
    if (done % 5 === 0 || s > head) {
      console.log(`  windows ${done}/${total} | strong=${strong.size} weak=${weak.size}`);
    }
  }
  console.log(`  contract log scan done: strong=${strong.size} weak=${weak.size}`);
}

async function scanStableIntoContract(head, token, label, start = DEPLOY) {
  console.log(`\n--- scanning ${label} transfers into the contract ---`);
  const win = 500000;
  let s = start;
  const total = Math.ceil((head - start + 1) / win);
  let done = 0;
  while (s <= head) {
    const to = Math.min(s + win - 1, head);
    const logs = await fetchLogs(token, s, to, [T_TRANSFER, null, JSAV_TOPIC]);
    for (const l of logs) notePayment(addrOf(l.topics[1]), parseInt(l.blockNumber, 16), l.transactionHash);
    done++;
    s = to + 1;
    console.log(`  ${label} window ${done}/${total} (to ${to.toLocaleString()}) | strong=${strong.size}`);
  }
}

/* ------------------------------------------------------------- verify ---- */

/**
 * Runs a list of JSON-RPC calls, batching them but falling back to one call
 * per request when a batch is rejected. Returns the responses in order.
 */
async function callMany(calls, batchSize = 50) {
  const out = new Array(calls.length);
  let i = 0;
  while (i < calls.length) {
    const slice = calls.slice(i, i + batchSize);
    let res;
    try {
      res = await rpcBatch(slice);
    } catch (e) {
      res = slice.map(() => ({ error: { message: e.message } }));
    }

    // Any call that came back with an error is retried on its own, so one
    // bad response can never be mistaken for "not registered".
    for (let k = 0; k < slice.length; k++) {
      if (!res[k]?.error) {
        out[i + k] = res[k];
        continue;
      }
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const [r] = await rpcBatch([slice[k]]);
          if (r?.error) throw new Error(r.error.message);
          out[i + k] = r;
          ok = true;
        } catch (e2) {
          out[i + k] = { error: { message: e2.message } };
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      if (!ok) {
        throw new Error(`RPC call failed after retries: ${out[i + k].error.message}`);
      }
    }
    i += batchSize;
  }
  return out;
}

async function verifyRegistered(addrs) {
  console.log(`\n--- 3. verifying ${addrs.length} candidates against users(address) ---`);
  const out = new Map(); // addr -> block
  const BATCH = 50;
  let i = 0;
  while (i < addrs.length) {
    const slice = addrs.slice(i, i + BATCH);
    const res = await callMany(
      slice.map((a) => ({
        method: 'eth_call',
        params: [{ to: JSAV, data: SEL_USERS + padAddr(a) }, 'latest'],
      })),
      BATCH,
    );
    for (let k = 0; k < slice.length; k++) {
      const hex = res[k]?.result;
      if (!hex || hex === '0x') continue;
      const registered = parseInt(hex.slice(2, 66), 16) === 1;
      if (!registered) continue;
      // Only a user whose payment block we actually know can be dated. A
      // guessed block would put a wrong date on the dashboard.
      const block = strong.get(slice[k]) ?? weak.get(slice[k]);
      if (block === undefined) {
        undatable.add(slice[k]);
        continue;
      }
      out.set(slice[k], block);
    }
    i += BATCH;
    if (i % 1000 === 0) console.log(`  verified ${i}/${addrs.length} | registered=${out.size}`);
  }
  console.log(`  registered users found: ${out.size}`);
  return out;
}

/**
 * Walks the referral tree so a referrer that never emitted a log of its own
 * is still picked up. `alreadyKnown` holds the addresses that are already in
 * the snapshot - they must not be re-dated, their dates are final.
 */
async function referralClosure(registered, alreadyKnown = new Set()) {
  console.log('\n--- 4. referral closure ---');
  const known = new Set([...registered.keys(), ...alreadyKnown]);
  for (let round = 1; round <= 8; round++) {
    // gather referrers of every registered user
    const refs = new Set();
    const users = [...registered.keys()];
    const BATCH = 100;
    for (let i = 0; i < users.length; i += BATCH) {
      const slice = users.slice(i, i + BATCH);
      const res = await callMany(
        slice.map((a) => ({
          method: 'eth_call',
          params: [{ to: JSAV, data: SEL_USERS + padAddr(a) }, 'latest'],
        })),
        50,
      );
      for (let k = 0; k < slice.length; k++) {
        const hex = res[k]?.result;
        if (!hex || hex === '0x') continue;
        const ref = '0x' + hex.slice(66 + 24, 66 + 64);
        if (isAddr(ref) && !known.has(ref)) refs.add(ref);
      }
    }
    if (!refs.size) {
      console.log(`  closure round ${round}: nothing missing`);
      break;
    }
    const list = [...refs];
    const res = await callMany(
      list.map((a) => ({
        method: 'eth_call',
        params: [{ to: JSAV, data: SEL_USERS + padAddr(a) }, 'latest'],
      })),
      50,
    );
    let added = 0;
    for (let k = 0; k < list.length; k++) {
      const hex = res[k]?.result;
      if (!hex || hex === '0x') continue;
      if (parseInt(hex.slice(2, 66), 16) !== 1) continue;
      if (known.has(list[k])) continue;
      // A referrer we cannot date is left out rather than given a guess.
      const block = strong.get(list[k]) ?? weak.get(list[k]);
      if (block === undefined) {
        undatable.add(list[k]);
        continue;
      }
      known.add(list[k]);
      registered.set(list[k], block);
      added++;
    }
    console.log(`  closure round ${round}: +${added} -> total ${registered.size}`);
    if (!added) break;
  }
  if (undatable.size) {
    console.log(`  WARNING: ${undatable.size} registered wallet(s) could not be dated:`);
    for (const a of [...undatable].slice(0, 10)) console.log(`    ${a}`);
  }
  return registered;
}

/* ---------------------------------------------------------- timestamps --- */

async function blockTimestamps(blocks) {
  console.log(`\n--- 5. resolving ${blocks.length} exact block timestamps ---`);
  const list = [...blocks];
  const out = new Map();
  const BATCH = 100;
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const res = await callMany(
      slice.map((b) => ({ method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] })),
      BATCH,
    );
    for (let k = 0; k < slice.length; k++) {
      const blk = res[k]?.result;
      if (blk?.timestamp) out.set(slice[k], parseInt(blk.timestamp, 16));
    }
    if (i % 2000 === 0) console.log(`  timestamps ${i}/${list.length}`);
  }
  console.log(`  resolved ${out.size}/${list.length}`);
  return out;
}

/* ---------------------------------------------------------------- main --- */

const SCAN_CACHE = '.tmp-joinscan-cache.json';
const TARGET_DIR = path.resolve('src/data');
const TARGET_FILE = path.join(TARGET_DIR, 'userJoinDates.json');
const META_FILE = path.join(TARGET_DIR, 'userJoinDates.meta.json');

/**
 * Incremental mode: only the blocks after the current checkpoint are scanned
 * and merged into the existing snapshot. That is what a scheduled refresh
 * needs - a handful of RPC calls instead of a 42M block sweep.
 */
const INCREMENTAL = process.argv.includes('--incremental');

async function main() {
  const head = await rpcOne('eth_blockNumber', []);
  const headNum = parseInt(head, 16);
  console.log(`head block: ${headNum.toLocaleString()}`);

  let existingDates = {};
  let fromBlock = DEPLOY;

  if (INCREMENTAL) {
    if (!fs.existsSync(TARGET_FILE) || !fs.existsSync(META_FILE)) {
      throw new Error('incremental mode needs an existing snapshot - run without --incremental first');
    }
    existingDates = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8'));
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    fromBlock = meta.checkpointBlock + 1;
    console.log(
      `incremental: ${Object.keys(existingDates).length} existing users, scanning from block ${fromBlock.toLocaleString()}`,
    );
    if (fromBlock > headNum) {
      console.log('already up to date, nothing to do');
      return;
    }
    console.log(`  window: ${(headNum - fromBlock + 1).toLocaleString()} blocks`);
    await scanContractLogs(headNum, fromBlock);
    await scanStableIntoContract(headNum, USDT, 'USDT', fromBlock);
    await scanStableIntoContract(headNum, USDC, 'USDC', fromBlock);
  } else {
    // The chain scan is the expensive part (85 windows per token over 42M
    // blocks), so it is cached. Re-runs only redo the cheap verify/timestamp
    // phases.
    let cached = null;
    if (fs.existsSync(SCAN_CACHE)) {
      try {
        const c = JSON.parse(fs.readFileSync(SCAN_CACHE, 'utf8'));
        if (c.head >= headNum - 2000) cached = c;
      } catch { /* ignore a broken cache */ }
    }

    if (cached) {
      console.log(`\nusing cached scan (head ${cached.head.toLocaleString()})`);
      for (const [a, b] of cached.strong) strong.set(a, b);
      for (const [a, b] of cached.weak) weak.set(a, b);
      for (const [a, t] of cached.strongTx ?? []) strongTx.set(a, t);
      console.log(`  strong=${strong.size} weak=${weak.size}`);
    } else {
      await scanContractLogs(headNum);
      await scanStableIntoContract(headNum, USDT, 'USDT');
      await scanStableIntoContract(headNum, USDC, 'USDC');
      fs.writeFileSync(
        SCAN_CACHE,
        JSON.stringify({
          head: headNum,
          strong: [...strong.entries()],
          weak: [...weak.entries()],
          strongTx: [...strongTx.entries()],
        }),
      );
    }
  }

  if (INCREMENTAL) {
    // Only addresses that are not in the snapshot yet matter.
    const known = new Set(Object.keys(existingDates));
    for (const a of [...strong.keys(), ...weak.keys()]) {
      if (known.has(a)) {
        strong.delete(a);
        weak.delete(a);
      }
    }
  }

  console.log(`\ncandidates: strong=${strong.size} weak=${weak.size}`);
  const candidates = [...new Set([...strong.keys(), ...weak.keys()])];
  const alreadyKnown = new Set(Object.keys(existingDates));
  let registered = await verifyRegistered(candidates);
  registered = await referralClosure(registered, alreadyKnown);

  const blocks = [...new Set(registered.values())];
  const tsMap = await blockTimestamps(blocks);

  const missing = blocks.filter((b) => !tsMap.has(b));
  if (missing.length) {
    console.log(`  ${missing.length} block(s) had no timestamp, using block-time interpolation`);
    const sample = [];
    for (let b = DEPLOY; b <= headNum; b += 100000) sample.push(b);
    const sampleTs = await blockTimestamps(sample);
    const pts = [...sampleTs.entries()].sort((a, b) => a[0] - b[0]);
    const interp = (block) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [b1, t1] = pts[i];
        const [b2, t2] = pts[i + 1];
        if (block >= b1 && block <= b2) {
          return Math.round(t1 + ((block - b1) / (b2 - b1)) * (t2 - t1));
        }
      }
      return pts[pts.length - 1][1];
    };
    for (const b of missing) tsMap.set(b, interp(b));
  }

  const dates = { ...existingDates };
  let added = 0;
  for (const [addr, block] of registered.entries()) {
    const ts = tsMap.get(block);
    if (!ts) continue;
    const iso = new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
    if (dates[addr]) {
      // An existing date is final - never overwrite it.
      if (dates[addr] !== iso) {
        console.log(`  NOTE: keeping the existing date for ${addr} (${dates[addr]}) over ${iso}`);
      }
      continue;
    }
    dates[addr] = iso;
    added++;
  }

  if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });

  fs.writeFileSync(TARGET_FILE, JSON.stringify(dates));
  fs.writeFileSync(
    META_FILE,
    JSON.stringify(
      {
        checkpointBlock: headNum,
        deployBlock: DEPLOY,
        contract: JSAV,
        generatedAt: new Date().toISOString(),
        count: Object.keys(dates).length,
      },
      null,
      2,
    ),
  );

  const vals = Object.values(dates).sort();
  console.log(`\nWrote ${Object.keys(dates).length} dates to ${TARGET_FILE}`);
  console.log(`  ${INCREMENTAL ? `added ${added} new users` : 'full rebuild'}`);
  console.log(`  earliest: ${vals[0]}  latest: ${vals[vals.length - 1]}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
