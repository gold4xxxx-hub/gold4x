/**
 * Builds a single self-contained HTML file for use on a phone.
 *
 * Why a file rather than a server: iOS cannot run one. There is no Termux
 * equivalent, and Shortcuts cannot keep a Node process alive. So a localhost
 * URL is impossible on half the devices this needs to work on. A single HTML
 * file opened from the Files app works on both iOS and Android with no
 * install, no repo and no network.
 *
 * The data is inlined into a <script type="application/json"> block and parsed
 * at runtime. That block is the only place the PII lives, which keeps the rest
 * of the file inert and makes it obvious what would leak if the file were sent
 * anywhere.
 *
 * The output is deliberately NOT committed: it holds 391 people's PAN, bank
 * account, IFSC, mobile, email and Aadhaar CIDs. It is gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const INDEX = path.join(root, 'p2p-audit.json');
const TEMPLATE = path.join(root, 'audit', 'offline.template.html');
const OUT = path.join(root, 'audit', 'gold4x-audit-offline.html');

if (!fs.existsSync(INDEX)) {
  console.error('p2p-audit.json not found. Run: npm run audit:build');
  process.exit(1);
}
if (!fs.existsSync(TEMPLATE)) {
  console.error('audit/offline.template.html not found.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const template = fs.readFileSync(TEMPLATE, 'utf8');

// A literal "</script>" inside the JSON would close the block early and turn the
// rest of the index into markup that the browser parses and executes. Escape the
// two characters that can do it. "</" cannot occur in base64 CIDs or addresses,
// but chat text is user-supplied and this is not worth trusting.
const safe = JSON.stringify(data).replace(/</g, '\\u003c');

if (!template.includes('__AUDIT_DATA__')) {
  console.error('Template is missing the __AUDIT_DATA__ placeholder.');
  process.exit(1);
}

const html = template.replace('__AUDIT_DATA__', safe);

if (html.includes('__AUDIT_DATA__')) {
  console.error('Placeholder was not replaced.');
  process.exit(1);
}

// Refuse to emit a file whose data block would not round-trip. A truncated or
// mangled index is worse than a build failure: it would silently show less.
let parsed;
try {
  parsed = JSON.parse(html.split('<script id="audit-data" type="application/json">')[1].split('</script>')[0]);
} catch (e) {
  console.error('Emitted file would not parse: ' + e.message);
  process.exit(1);
}

const before = {
  trades: data.trades.length,
  ads: data.ads.length,
  kyc: (data.kyc || []).length,
  chat: data.summary.chatMessages,
  shots: data.summary.realScreenshots,
};
const after = {
  trades: parsed.trades.length,
  ads: parsed.ads.length,
  kyc: (parsed.kyc || []).length,
  chat: parsed.summary.chatMessages,
  shots: parsed.summary.realScreenshots,
};
for (const k of Object.keys(before)) {
  if (before[k] !== after[k]) {
    console.error(`Round-trip lost data: ${k} ${before[k]} -> ${after[k]}`);
    process.exit(1);
  }
}

fs.writeFileSync(OUT, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('wrote ' + path.relative(root, OUT));
console.log('  size      ' + kb(html.length));
console.log('  trades    ' + after.trades);
console.log('  orders    ' + after.ads);
console.log('  people    ' + after.kyc);
console.log('  chat      ' + after.chat + ' messages');
console.log('  shots     ' + after.shots + ' payment screenshots');
console.log('');
console.log('  Round-trip verified: every count matches the source index.');
console.log('');
console.log('  This file holds PANs, bank accounts, IFSCs and Aadhaar CIDs for');
console.log('  ' + after.kyc + ' people. It is gitignored. Do not upload it anywhere.');