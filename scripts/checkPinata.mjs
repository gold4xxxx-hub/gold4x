#!/usr/bin/env node
/**
 * Diagnose why Pinata pinning fails, without exposing the credential.
 *
 * Context: production returns HTTP 403 from /pinning/pinFileToIPFS. Pinata's
 * own docs define 403 as "authenticated, but the action isn't allowed", which
 * is a different problem from 401 ("your credential is wrong"). The two have
 * completely different fixes, so it is worth telling them apart precisely.
 *
 * A Pinata JWT is a normal HS256 JSON Web Token. The signature covers the
 * payload, so the payload can be READ without the secret. That makes the
 * token's own claims - the user id, the granted endpoint permissions and the
 * expiry - inspectable offline. This script prints those claims and never
 * prints the token.
 *
 * Usage:
 *   $env:PINATA_JWT = "<the same value Vercel has>"
 *   node scripts/checkPinata.mjs
 *
 * Add --live to also attempt a real pin of a 1x1 PNG. That writes one tiny
 * file to the Pinata account, so it is opt-in.
 */

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');

const jwt = (process.env.PINATA_JWT || '').trim();

function line(s = '') { console.log(s); }
function ok(s) { line(`  PASS  ${s}`); }
function bad(s) { line(`  FAIL  ${s}`); }
function warn(s) { line(`  WARN  ${s}`); }
function info(s) { line(`  INFO  ${s}`); }

// ---------------------------------------------------------------------------
// 1. Token shape and claims
// ---------------------------------------------------------------------------

line('== Token ==');
if (!jwt) {
  bad('PINATA_JWT is not set in this shell.');
  line('');
  line('   Fetch it from Vercel:  Project > Settings > Environment Variables');
  line('   Then:  $env:PINATA_JWT = "<value>"   and re-run this script.');
  process.exit(1);
}

const parts = jwt.split('.');
if (parts.length !== 3) {
  bad(`Expected a JWT with 3 dot-separated parts, found ${parts.length}.`);
  line('       If this is a pinata_api_key / pinata_secret pair instead of a JWT,');
  line('       generate a JWT at https://app.pinata.cloud/developers/keys.');
  process.exit(1);
}
ok('Token has JWT structure (header.payload.signature)');

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

let claims;
try {
  claims = decodeSegment(parts[1]);
  ok('Payload decodes as JSON');
} catch {
  bad('Payload is not valid base64url JSON. The value is probably truncated.');
  line('       This is the single most common cause: a JWT copied with a missing');
  line('       character, or wrapped onto two lines when pasted.');
  process.exit(1);
}

// Never print the token, but do print a fingerprint so a value can be matched
// against the one in Vercel without revealing it. The digest returns an
// ArrayBuffer, so it has to be wrapped before slicing or it stringifies as
// "[object ArrayBuffer]".
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwt));
const fingerprint = [...new Uint8Array(digest).slice(0, 6)]
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');
line(`        sha256:${fingerprint}  (use to confirm you copied the right token)`);

if (claims.user_id) {
  info(`user_id        ${claims.user_id}`);
} else {
  warn('user_id missing from claims. Pinata answers "Missing userId" for these,');
  line('        which means the token cannot be resolved to an account.');
}

if (claims.iat) {
  const iat = new Date(claims.iat * 1000);
  info(`issued (iat)   ${iat.toISOString()}`);
}
if (claims.exp) {
  const exp = new Date(claims.exp * 1000);
  const minsLeft = Math.round((exp.getTime() - Date.now()) / 60000);
  if (minsLeft <= 0) {
    bad(`EXPIRED         ${exp.toISOString()} (${Math.abs(minsLeft)} min ago)`);
    line('        Generate a new JWT. Nothing else will work until you do.');
  } else if (minsLeft < 60) {
    warn(`expires soon   ${exp.toISOString()} (${minsLeft} min left)`);
    line('        If uploads start failing in an hour, this is why.');
  } else {
    ok(`expires (exp)  ${exp.toISOString()} (${minsLeft} min left)`);
  }
} else {
  warn('No exp claim. Pinata keys are normally time-limited.');
}

// Scoped keys carry a permissions tree. Absent one usually means a full-access
// key, which is fine.
const perms = claims.permissions?.endpoints?.pinning;
if (perms && typeof perms === 'object') {
  if (perms.pinFileToIPFS === true) {
    ok('scope          pinFileToIPFS is granted');
  } else {
    bad('scope          pinFileToIPFS is NOT granted on this key');
    line(`        granted: ${Object.entries(perms).filter(([, v]) => v).map(([k]) => k).join(', ') || '(none)'}`);
    line('        Create a key that includes pinFileToIPFS. This alone causes 403.');
  }
} else {
  info('scope          no scoped-permissions claim (looks like a full-access key)');
}
line('');

// ---------------------------------------------------------------------------
// 2. Live API checks
// ---------------------------------------------------------------------------

line('== Pinata API ==');

const API = 'https://api.pinata.cloud';

async function call(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, ...(init.headers || {}) },
  });
  let body = '';
  try { body = (await res.text()).slice(0, 400); } catch { /* ignore */ }
  return { status: res.status, body };
}

// Auth check. Note the path is /data/, not /pinning/ - the older
// /pinning/testAuthentication route now answers 404 INVALID_ROUTE, so a script
// using it reports every token as broken.
//
// A valid token that fails here is genuinely invalid. A valid token that passes
// here but fails to pin below points at permissions or the account.
try {
  const t = await call('/data/testAuthentication');
  if (t.status === 200) ok('auth check       200 - token is valid');
  else if (t.status === 401) bad(`auth check       401 - ${t.body}`);
  else bad(`auth check       ${t.status} - ${t.body}`);
} catch (e) {
  bad(`could not reach Pinata: ${String(e.message || e)}`);
  line('');
  line('   If Pinata itself is unreachable, this is a network problem, not a');
  line('   credential problem.');
  process.exit(1);
}

// Storage used against the plan allowance. An account that has pinned more than
// its tier allows keeps returning 403 on new pins, and this is the only way to
// see that from outside the dashboard.
try {
  const q = await call('/data/userPinnedDataTotal');
  if (q.status === 200) {
    const m = q.body.match(/"total_size_in_bytes"\s*:\s*(\d+)/);
    if (m) {
      const gb = Number(m[1]) / 1e9;
      info(`storage used     ${gb.toFixed(3)} GB pinned`);
      if (gb >= 1) {
        warn('               free Pinata allows roughly 1 GB total.');
        warn('               Over the limit produces exactly this 403.');
      }
    } else {
      info(`storage used     ${q.body.slice(0, 80)}`);
    }
  } else if (q.status === 403) {
    warn('storage check   403 - cannot read usage; the account may be restricted.');
  } else {
    info(`storage check   ${q.status}`);
  }
} catch {
  info('storage check   could not read usage');
}

// A pin attempt separates "token invalid" from "pinning not allowed".
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

try {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'pinata-check.png');
  const p = await call('/pinning/pinFileToIPFS', { method: 'POST', body: fd });

  if (p.status === 200) {
    const cid = (p.body.match(/"IpfsHash"\s*:\s*"([^"]+)"/) || [])[1];
    ok(`pinFileToIPFS   200 - pinning works${cid ? ` (CID ${cid})` : ''}`);
    line('');
    line('   Pinata is working from this machine.');
    line('   If production still fails, the token in VERCEL differs from this one.');
  } else if (p.status === 401) {
    bad(`pinFileToIPFS   401 - token rejected`);
    line(`        ${p.body}`);
    line('        The JWT is invalid, expired or malformed. Generate a new one.');
  } else if (p.status === 403) {
    bad(`pinFileToIPFS   403 - authenticated but not allowed to pin`);
    line(`        ${p.body}`);
    line('');
    line('   The token is valid, so the cause is one of:');
    line('     1. Account email not verified. Pinata blocks the API until it is.');
    line('        Check https://app.pinata.cloud/account for a banner.');
    line('     2. Free-plan limit reached (total storage or monthly bandwidth).');
    line('     3. The key lacks pinFileToIPFS. Regenerate with that permission.');
    line('     4. Account suspended or payment method failed.');
    line('     5. Vercel is holding a different token than the one tested here.');
  } else if (p.status === 429) {
    warn(`pinFileToIPFS   429 - rate limited. Wait a minute and re-run.`);
    line(`        ${p.body}`);
  } else {
    warn(`pinFileToIPFS   ${p.status}`);
    line(`        ${p.body}`);
  }
} catch (e) {
  bad(`pin attempt failed: ${String(e.message || e)}`);
}

if (!LIVE) {
  line('');
  line('   (A 1x1 PNG is uploaded by this check. Re-run with --live to skip it.)');
}
line('');
