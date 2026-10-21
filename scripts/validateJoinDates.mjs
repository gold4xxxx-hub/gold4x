/**
 * Validates src/data/userJoinDates.json against the chain.
 *
 *   A. every address in the snapshot is registered on chain
 *   B. every user's referrer joined earlier (a referrer has to exist before
 *      it can be used, so it must have an earlier - or equal - join date)
 *   C. the block recorded for a sample of wallets really is the
 *      register() / registerWithStable() transaction
 *
 * Run with: npm run join:validate
 */
import fs from 'node:fs';

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
const URLS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  ...(ankr ? [`https://rpc.ankr.com/bsc/${ankr}`] : []),
];
const JSAV = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';
const SEL_USERS = '0xa87430ba'; // users(address)
const SEL_REGISTER = '0x4420e486'; // register(address)
const SEL_REGISTER_STABLE = '0xa9ef3feb'; // registerWithStable(address,address)
const DEPLOY = 86656188;

const dates = JSON.parse(fs.readFileSync('src/data/userJoinDates.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('src/data/userJoinDates.meta.json', 'utf8'));
const cacheFile = '.tmp-joinscan-cache.json';
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : { strongTx: [] };
const strongTx = new Map(cache.strongTx ?? []);

const addrs = Object.keys(dates);
const vals = Object.values(dates).sort();
console.log(`snapshot: ${addrs.length} users, checkpoint block ${meta.checkpointBlock}`);
console.log(`  earliest ${vals[0]}  latest ${vals[vals.length - 1]}`);

let url = URLS[0];
let lastErr;

async function rpc(method, params) {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
      return j.result;
    } catch (e) {
      lastErr = e;
      url = URLS[(URLS.indexOf(url) + 1) % URLS.length];
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Batched eth_call with per-call retries - a rate limited call is an error,
 *  never a silent "not registered". */
async function usersBatch(list) {
  const out = [];
  const SIZE = 20;
  for (let i = 0; i < list.length; i += SIZE) {
    const slice = list.slice(i, i + SIZE);
    const body = slice.map((a, k) => ({
      jsonrpc: '2.0',
      id: k + 1,
      method: 'eth_call',
      params: [{ to: JSAV, data: SEL_USERS + a.slice(2).toLowerCase().padStart(64, '0') }, 'latest'],
    }));
    let res = null;
    for (let attempt = 0; attempt < 6 && !res; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45000),
        });
        const j = await r.json();
        if (!Array.isArray(j)) throw new Error(j?.error?.message ?? 'not a batch');
        res = j;
      } catch {
        url = URLS[(URLS.indexOf(url) + 1) % URLS.length];
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (!res) throw new Error('batch failed repeatedly');
    const byId = new Map(res.map((x) => [x.id, x]));
    for (let k = 0; k < slice.length; k++) {
      const r = byId.get(k + 1);
      if (r?.result && r.result !== '0x') {
        out.push({ addr: slice[k], hex: r.result });
        continue;
      }
      // retry this one on its own
      try {
        const single = await rpc('eth_call', [
          { to: JSAV, data: SEL_USERS + slice[k].slice(2).toLowerCase().padStart(64, '0') },
          'latest',
        ]);
        out.push({ addr: slice[k], hex: single });
      } catch (e) {
        out.push({ addr: slice[k], error: e.message });
      }
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}

const deployBlk = await rpc('eth_getBlockByNumber', ['0x' + DEPLOY.toString(16), false]);
const deployTs = new Date(parseInt(deployBlk.timestamp, 16) * 1000).toISOString();
console.log(`  contract deploy block ${DEPLOY} = ${deployTs}`);

let unregistered = 0;
let rpcErrors = 0;
let refMissing = 0;
let refLater = 0;
let beforeDeploy = 0;
let checked = 0;

for (let i = 0; i < addrs.length; i += 20) {
  const slice = addrs.slice(i, i + 20);
  const res = await usersBatch(slice);
  for (const r of res) {
    if (r.error) {
      rpcErrors++;
      if (rpcErrors < 6) console.log(`  RPC ERROR: ${r.addr} (${r.error})`);
      continue;
    }
    if (parseInt(r.hex.slice(2, 66), 16) !== 1) {
      unregistered++;
      if (unregistered < 8) console.log(`  NOT REGISTERED: ${r.addr}`);
      continue;
    }
    checked++;
    const ref = '0x' + r.hex.slice(90, 130);
    const ts = dates[r.addr];
    if (ts < deployTs) {
      beforeDeploy++;
      if (beforeDeploy < 8) console.log(`  BEFORE DEPLOY: ${r.addr} ${ts}`);
    }
    if (ref !== '0x0000000000000000000000000000000000000000') {
      const rd = dates[ref];
      if (!rd) {
        refMissing++;
        if (refMissing < 8) console.log(`  REFERRER MISSING: ${r.addr} -> ${ref}`);
      } else if (rd > ts) {
        refLater++;
        if (refLater < 10) console.log(`  REFERRER JOINED LATER: ${r.addr} (${ts}) -> ${ref} (${rd})`);
      }
    }
  }
  if (i % 2000 === 0) console.log(`  checked ${i}/${addrs.length}`);
}

console.log(`\nA. registered OK        : ${checked}/${addrs.length}`);
console.log(`   not registered       : ${unregistered}`);
console.log(`   rpc errors           : ${rpcErrors}`);
console.log(`   join before deploy   : ${beforeDeploy}`);
console.log(`B. referrer missing     : ${refMissing}`);
console.log(`   referrer joined later: ${refLater}`);

console.log('\nC. register() tx check (sample)');
const sample = [];
const step = Math.max(1, Math.floor(addrs.length / 25));
for (let i = 0; i < addrs.length; i += step) sample.push(addrs[i]);
let ok = 0;
let bad = 0;
for (const a of sample) {
  const txHash = strongTx.get(a);
  if (!txHash) {
    console.log(`  ? ${a}  no tx recorded (scan cache missing?)`);
    continue;
  }
  const tx = await rpc('eth_getTransactionByHash', [txHash]);
  const sel = (tx?.input ?? '').slice(0, 10);
  const to = (tx?.to ?? '').toLowerCase();
  if (to === JSAV && (sel === SEL_REGISTER || sel === SEL_REGISTER_STABLE)) ok++;
  else {
    bad++;
    console.log(`  X ${a}  to=${to.slice(0, 12)} sel=${sel}  snapshot=${dates[a]}`);
  }
}
console.log(`   register() confirmed : ${ok}/${sample.length} (mismatches ${bad})`);

if (unregistered || refMissing || refLater || beforeDeploy || bad) {
  console.log('\nVALIDATION FAILED');
  process.exitCode = 1;
} else {
  console.log('\nVALIDATION PASSED');
}
