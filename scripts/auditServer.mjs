#!/usr/bin/env node
/**
 * Local audit server for the P2P escrow.
 *
 * Serves the dashboard in audit/index.html and the generated index at
 * /api/audit. Plain node:http on purpose: this must run on the owner's machine
 * with no install step, no build, no bundler and no cloud dependency.
 *
 *   node scripts/buildAuditIndex.mjs     # refresh p2p-audit.json
 *   node scripts/auditServer.mjs          # browse it at http://localhost:3400
 *
 * Binds to 127.0.0.1 rather than 0.0.0.0. The index contains every trade party
 * address, every chat message and every bank reference on the chain, so it
 * should not be reachable from the network by accident.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'p2p-audit.json');
const PAGE = path.join(ROOT, 'audit', 'index.html');
const PORT = Number(process.env.AUDIT_PORT || 3400);
const HOST = '127.0.0.1';

if (!fs.existsSync(INDEX)) {
  console.error('p2p-audit.json not found. Run:  node scripts/buildAuditIndex.mjs');
  process.exit(1);
}
if (!fs.existsSync(PAGE)) {
  console.error('audit/index.html not found.');
  process.exit(1);
}

const send = (res, status, type, body) => {
  res.writeHead(status, {
    'content-type': type,
    // The page loads no third-party assets, so a strict policy costs nothing and
    // keeps chat messages and addresses from leaking to any external origin.
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; connect-src 'self'",
    'cache-control': 'no-store',
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/audit') {
    try {
      // Re-read on each request so a rebuild shows up without a restart.
      const body = fs.readFileSync(INDEX, 'utf8');
      const age = ((Date.now() - fs.statSync(INDEX).mtimeMs) / 1000).toFixed(0);
      res.setHeader('x-index-age-seconds', age);
      send(res, 200, 'application/json; charset=utf-8', body);
    } catch (e) {
      send(res, 500, 'application/json', JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (url === '/' || url === '/index.html') {
    send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE));
    return;
  }

  send(res, 404, 'text/plain', 'Not found');
});

server.listen(PORT, HOST, () => {
  const d = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  console.log(`P2P audit dashboard  ->  http://${HOST}:${PORT}`);
  console.log(`  index generated ${d.generatedAt}`);
  console.log(`  ${d.summary.trades} trades, ${d.summary.ads} orders`);
  console.log(`  bound to loopback only; press Ctrl+C to stop`);
});
