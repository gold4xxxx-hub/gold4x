/**
 * One command for the whole manual refresh, from either machine.
 *
 * Builds the index from chain, then refreshes the ciphertext only if the data
 * actually differs. Used by hand when you have the laptop and want the phone to
 * see fresh data now rather than in six hours.
 *
 * Push afterwards with:
 *   git add p2p-audit.enc && git commit -m "..." && git push
 *
 * Safe to run while the scheduled workflow is also running. Both write to the
 * same path only on this machine, and the comparison is against committed HEAD,
 * so the worst case is a redundant commit that the other run would have made.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = process.cwd();

function run(label, args, env = {}) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
  const r = spawnSync('node', [path.join(root, 'scripts', args)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`\n${label} failed. Nothing has been changed on disk.`);
    process.exit(r.status ?? 1);
  }
  return r;
}

if (!fs.existsSync(path.join(root, 'p2p-audit.json'))) {
  console.log('No existing index, building from scratch.');
}

run('building the index from chain', 'buildAuditIndex.mjs');

// The comparison writes the new ciphertext only when the data differs, so a
// no-op run leaves the working tree clean and there is nothing to commit.
run('refreshing the ciphertext if the data changed', 'auditUpdateIfChanged.mjs');

console.log('\n── done ' + '─'.repeat(53));
const dirty = spawnSync('git', ['status', '--porcelain', 'p2p-audit.enc'], {
  cwd: root, encoding: 'utf8',
}).stdout.trim();

if (!dirty) {
  console.log('\nNo new trades, orders or KYC records since the last build.');
  console.log('Nothing to commit, and nothing for your phone to fetch.');
} else {
  console.log('\nThe index changed. To publish it to the phone:');
  console.log('');
  console.log('  git add p2p-audit.enc');
  console.log('  git commit -m "Refresh the audit index"');
  console.log('  git push');
  console.log('');
  console.log('Vercel deploys automatically, so the phone picks it up in about a minute.');
}
console.log('');