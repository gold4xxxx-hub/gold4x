/**
 * Encrypts the audit index so the ciphertext can live in git.
 *
 * Why this exists: the audit page has to be deployed to be reachable from a
 * phone, and deploying means the code goes to git. But p2p-audit.json holds
 * 391 people's PAN, bank account, IFSC, mobile, email and Aadhaar image CIDs,
 * and no git remote is a safe home for that - including a private one, because
 * git history never forgets a deletion.
 *
 * So the data is committed as ciphertext and the key lives only in the
 * deployment's environment. Clone the repo without the key and the file is
 * noise. Compromise the repository and there is still nothing readable in it.
 *
 * Encryption is AES-256-GCM, which authenticates as well as encrypts: a
 * modified file fails to decrypt rather than silently decrypting to garbage.
 *
 * Run:  node scripts/encryptAuditIndex.mjs
 * Requires AUDIT_INDEX_KEY: 64 hex characters (32 bytes).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const IN = path.join(root, 'p2p-audit.json');
const OUT = path.join(root, 'p2p-audit.enc');
const VERSION = 'gold4x-audit-index:v1';

/**
 * The key, from the environment or from a gitignored file beside this script's
 * project root.
 *
 * It is deliberately not read from .env.local. That file is committed to a
 * public repository, which is how ANKR_API_KEY and BSCSCAN_API_KEY were exposed
 * in the first place. .audit.key is gitignored and never staged.
 */
function readKey() {
  const fromEnv = (process.env.AUDIT_INDEX_KEY ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    return fs.readFileSync(path.join(root, '.audit.key'), 'utf8').trim();
  } catch {
    return '';
  }
}

function loadKey() {
  const raw = readKey();
  if (!raw) {
    console.error('No encryption key found.');
    console.error('');
    console.error('Either set it for this shell:');
    console.error('  $env:AUDIT_INDEX_KEY = "<64 hex characters>"');
    console.error('or save it once to .audit.key, which is gitignored:');
    console.error('  "<key>" | Out-File -NoNewline -Encoding ascii .audit.key');
    console.error('');
    console.error('Not in .env.local. That file is committed to a public repository.');
    return null;
  }
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    console.error('The key must be 64 hex characters (32 bytes).');
    return null;
  }
  return Buffer.from(raw, 'hex');
}

if (!fs.existsSync(IN)) {
  console.error('p2p-audit.json not found. Run: npm run audit:build');
  process.exit(1);
}

const key = loadKey();
if (!key) process.exit(1);

const plaintext = fs.readFileSync(IN);

// GCM needs a unique IV per encryption. A fresh one each build means the same
// index encrypted twice produces different ciphertext, which is correct, and it
// means a repeated IV - fatal under GCM - cannot happen.
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
cipher.setAAD(Buffer.from(VERSION, 'utf8'));
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

// version || iv || tag || ciphertext
const packed = Buffer.concat([Buffer.from(VERSION, 'utf8'), iv, tag, ciphertext]);
const out = packed.toString('base64');

// Decrypt immediately and compare, so a broken key or a truncated file is caught
// here rather than in production where it looks like a server error.
{
  let round = packed;
  const vlen = Buffer.from(VERSION, 'utf8').length;
  const ver = round.subarray(0, vlen).toString('utf8');
  const riv = round.subarray(vlen, vlen + 12);
  const rtag = round.subarray(vlen + 12, vlen + 28);
  const rdata = round.subarray(vlen + 28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, riv);
  d.setAAD(Buffer.from(ver, 'utf8'));
  d.setAuthTag(rtag);
  const back = Buffer.concat([d.update(rdata), d.final()]);
  if (!back.equals(plaintext)) {
    console.error('Round-trip failed: the decrypted bytes do not match the source.');
    process.exit(1);
  }
}

// Same atomic rename as the index itself, so an interrupted write cannot leave
// an undecryptable ciphertext committed.
const tmpOut = OUT + '.tmp';
fs.writeFileSync(tmpOut, out, 'utf8');
fs.renameSync(tmpOut, OUT);

const pct = ((out.length / plaintext.length) * 100).toFixed(0);
console.log('wrote ' + path.relative(root, OUT));
console.log('  plaintext  ' + plaintext.length.toLocaleString() + ' bytes');
console.log('  ciphertext ' + out.length.toLocaleString() + ' bytes (' + pct + '% of original)');
console.log('  scheme     AES-256-GCM, authenticated, fresh IV per build');
console.log('');
console.log('  Round-trip verified byte for byte.');
console.log('');
console.log('  Safe to commit. Useless without AUDIT_INDEX_KEY, which stays in the');
console.log('  deployment environment and never in this repository.');
console.log('');
console.log('  NOTE: every rebuild of the index must be re-encrypted. Rotating the key');
console.log('  makes the existing ciphertext unreadable, which is the intended');
console.log('  behaviour if the key is ever exposed.');