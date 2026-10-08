/**
 * Decides whether the audit index has actually changed, and refreshes the
 * ciphertext only if so.
 *
 * Why this exists: AES-GCM uses a random IV per encryption, so the ciphertext is
 * different every time even when the data is byte-identical. Committing on that
 * basis would produce a commit and a Vercel deploy every single run, forever,
 * for nothing. Comparing the ciphertext is therefore useless; the comparison has
 * to happen on the decrypted bytes.
 *
 * Reads the previously committed ciphertext straight out of git rather than from
 * the working tree, so it compares against what is actually deployed.
 *
 * Sets GITHUB_OUTPUT "changed=true|false" when running in CI.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const INDEX = path.join(root, 'p2p-audit.json');
const ENC = path.join(root, 'p2p-audit.enc');
const VERSION = 'gold4x-audit-index:v1';

const key = (process.env.AUDIT_INDEX_KEY ?? '').trim();
if (!/^[0-9a-f]{64}$/i.test(key)) {
  console.error('AUDIT_INDEX_KEY must be set to 64 hex characters.');
  process.exit(1);
}
const keyBuf = Buffer.from(key, 'hex');

/** The ciphertext currently in git, which is what production is serving. */
function committedCiphertext() {
  try {
    return execFileSync('git', ['show', 'HEAD:p2p-audit.enc'], { cwd: root, encoding: 'utf8' });
  } catch {
    return null; // first run, or the file was removed
  }
}

function decrypt(b64) {
  const packed = Buffer.from(b64.trim(), 'base64');
  if (packed.subarray(0, VERSION.length).toString('utf8') !== VERSION) return null;
  const d = crypto.createDecipheriv(
    'aes-256-gcm',
    keyBuf,
    packed.subarray(VERSION.length, VERSION.length + 12),
  );
  d.setAAD(Buffer.from(VERSION, 'utf8'));
  d.setAuthTag(packed.subarray(VERSION.length + 12, VERSION.length + 28));
  return Buffer.concat([d.update(packed.subarray(VERSION.length + 28)), d.final()]).toString('utf8');
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  c.setAAD(Buffer.from(VERSION, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from(VERSION, 'utf8'), iv, c.getAuthTag(), ct]).toString('base64');
}

function report(changed) {
  console.log(`changed=${changed}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }
}

if (!fs.existsSync(INDEX)) {
  console.error('p2p-audit.json was not produced by the build.');
  process.exit(1);
}

const fresh = fs.readFileSync(INDEX, 'utf8');
const previous = committedCiphertext();

if (!previous) {
  console.log('no committed ciphertext, writing the first one');
  fs.writeFileSync(ENC, encrypt(fresh), 'utf8');
  report('true');
  process.exit(0);
}

let oldPlain;
try {
  oldPlain = decrypt(previous);
} catch {
  // A wrong key, or ciphertext from a rotated one. Treat as changed so a fresh
  // one is written rather than leaving the deployment serving nothing.
  console.log('existing ciphertext could not be decrypted with this key, rewriting');
  fs.writeFileSync(ENC, encrypt(fresh), 'utf8');
  report('true');
  process.exit(0);
}

if (oldPlain === fresh) {
  console.log('index is identical to what is deployed, nothing to commit');
  report('false');
  process.exit(0);
}

// Say what actually moved, so a commit message is not guesswork.
let detail = '';
try {
  const a = JSON.parse(oldPlain);
  const b = JSON.parse(fresh);
  const parts = [];
  const dt = b.trades.length - a.trades.length;
  const da = b.ads.length - a.ads.length;
  const dk = (b.kyc?.length ?? 0) - (a.kyc?.length ?? 0);
  if (dt) parts.push(`${dt > 0 ? '+' : ''}${dt} trades`);
  if (da) parts.push(`${da > 0 ? '+' : ''}${da} orders`);
  if (dk) parts.push(`${dk > 0 ? '+' : ''}${dk} KYC records`);
  const oldHead = a.blockRange?.head;
  const newHead = b.blockRange?.head;
  if (oldHead && newHead && newHead !== oldHead) {
    parts.push(`head ${oldHead.toLocaleString()} → ${newHead.toLocaleString()}`);
  }
  detail = parts.join(', ');
} catch {
  detail = 'index contents differ';
}

console.log(`index differs from the deployed copy: ${detail}`);
fs.writeFileSync(ENC, encrypt(fresh), 'utf8');
report('true');