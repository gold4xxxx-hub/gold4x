import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv } from 'node:crypto';

import {
  buildAuditMessage,
  isAllowedAuditSigner,
  newAuditNonce,
  verifyAuditSignature,
} from '@/lib/auditGate';

// Serves the generated audit index (p2p-audit.json) to the /audit page.
//
// Access is a wallet signature, not a password or a session cookie. The flow:
//
//   GET  /api/audit            -> a nonce, if the caller holds a key for an
//                                 allowlisted address. Harmless on its own.
//   POST /api/audit            -> { address, signature, nonce }. The server
//                                 verifies the signature recovers to that
//                                 address AND that the address is allowlisted.
//   GET  /api/audit?token=...  -> the index.
//
// A signature is checked rather than a shared secret because there is nothing
// to store, rotate or accidentally leak: the allowlist is an env var, and no
// key material ever touches this server or the repository.
//
// The index holds 391 people's PAN, bank account, IFSC, mobile, email and
// Aadhaar image CIDs, so it is never served without a verified signature.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER = process.env.AUDIT_SIGNERS ?? '';
const ENABLED = process.env.AUDIT_PAGE_ENABLED === '1';

const noStore = {
  'cache-control': 'no-store',
} as const;

/**
 * Tokens handed out after a successful verification, and the nonces issued to
 * be signed. Both expire, and both are dropped lazily on request.
 */
const issued = new Map<string, number>();
const pending = new Map<string, number>();

const TOKEN_TTL_MS = 30 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

/** Must match scripts/encryptAuditIndex.mjs. */
const VERSION = 'gold4x-audit-index:v1';

// Dropped on each request rather than on a timer: a serverless function has no
// reliable background work, and an unbounded map would grow without limit.
function sweep(now = Date.now()) {
  for (const [k, exp] of issued) if (exp <= now) issued.delete(k);
  for (const [k, exp] of pending) if (exp <= now) pending.delete(k);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read the audit index, from wherever this deployment keeps it.
 *
 * Local development uses the plaintext file, so `npm run dev` needs no setup.
 *
 * A deployed build has no plaintext file - it is gitignored on purpose. Instead
 * the repository carries p2p-audit.enc, AES-256-GCM ciphertext produced by
 * scripts/encryptAuditIndex.mjs, and the key arrives in the deployment's
 * environment. Clone the repository without the key and the file is noise.
 */
function readIndex(): { body: string; generatedAtMs: number } | null {
  const plain = path.join(process.cwd(), 'p2p-audit.json');
  try {
    return {
      generatedAtMs: fs.statSync(plain).mtimeMs,
      body: fs.readFileSync(plain, 'utf8'),
    };
  } catch {
    /* not present locally, or not present on a deployed build */
  }

  const enc = path.join(process.cwd(), 'p2p-audit.enc');
  const key = (process.env.AUDIT_INDEX_KEY ?? '').trim();
  if (!/^[0-9a-f]{64}$/i.test(key)) return null;

  try {
    const packed = Buffer.from(fs.readFileSync(enc, 'utf8').trim(), 'base64');
    // Layout: version || iv(12) || tag(16) || ciphertext
    const version = packed.subarray(0, VERSION.length).toString('utf8');
    if (version !== VERSION) return null;
    const iv = packed.subarray(VERSION.length, VERSION.length + 12);
    const tag = packed.subarray(VERSION.length + 12, VERSION.length + 28);
    const data = packed.subarray(VERSION.length + 28);

    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from(VERSION, 'utf8'));
    decipher.setAuthTag(tag);
    const body = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');

    return { generatedAtMs: fs.statSync(enc).mtimeMs, body };
  } catch {
    // A wrong key or a tampered file fails the authentication tag, which is
    // caught here and reported as "no index" rather than surfacing as a crash.
    return null;
  }
}

export async function GET(request: Request) {
  if (!ENABLED) {
    return NextResponse.json(
      { error: 'The audit page is not enabled on this deployment.' },
      { status: 403, headers: noStore },
    );
  }

  if (!OWNER.trim()) {
    return NextResponse.json(
      {
        error:
          'No AUDIT_SIGNERS is configured, so no one can be let in. That is deliberate: fail closed.',
      },
      { status: 503, headers: noStore },
    );
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  // Step 1: hand out a nonce. This tells an allowed visitor their wallet is
  // recognised before they are asked to sign anything, so a stranger is not
  // prompted for a signature they have no reason to give.
  if (!token) {
    sweep();
    // The nonce is issued by the server, not chosen by the browser. A client
    // that picked its own nonce could reuse one it had already signed, and the
    // signature would verify forever. Issuing it here makes it single-use.
    const nonce = newAuditNonce();
    pending.set(nonce, Date.now() + NONCE_TTL_MS);
    return NextResponse.json(
      {
        needsSignature: true,
        nonce,
        expiresInMs: NONCE_TTL_MS,
        domain: 'gold4x.in',
        purpose: 'P2P escrow audit access',
        hint: 'Sign the message from /audit with an allowlisted wallet, then POST it here.',
      },
      { status: 401, headers: noStore },
    );
  }

  sweep();

  const expires = issued.get(token);
  if (!expires || expires <= Date.now()) {
    issued.delete(token);
    return NextResponse.json(
      { error: 'That access token has expired. Sign again to continue.' },
      { status: 401, headers: noStore },
    );
  }

  const idx = readIndex();
  if (!idx) {
    return NextResponse.json(
      {
        error:
          'No audit index on this deployment. It reads p2p-audit.json locally, or p2p-audit.enc when AUDIT_INDEX_KEY is set.',
        missing: true,
      },
      { status: 404, headers: noStore },
    );
  }

  return new NextResponse(idx.body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Age lets the page show how stale the data is, which matters when the
      // chain is moving faster than the index is rebuilt.
      'x-index-generated-ms': String(idx.generatedAtMs),
      ...noStore,
    },
  });
}

export async function POST(request: Request) {
  if (!ENABLED) {
    return NextResponse.json(
      { error: 'The audit page is not enabled on this deployment.' },
      { status: 403, headers: noStore },
    );
  }

  if (!OWNER.trim()) {
    return NextResponse.json(
      { error: 'No AUDIT_SIGNERS is configured, so no one can be let in.' },
      { status: 503, headers: noStore },
    );
  }

  let body: { address?: string; signature?: string; nonce?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400, headers: noStore });
  }

  const { address, signature, nonce } = body;

  if (!address || !signature || !nonce) {
    return NextResponse.json(
      { error: 'address, signature and nonce are all required.' },
      { status: 400, headers: noStore },
    );
  }

  // An unknown address is refused before any signature work, so a stranger
  // cannot use this endpoint to have messages checked for them.
  if (!isAllowedAuditSigner(address)) {
    return NextResponse.json(
      { error: 'That address is not authorised for the audit index.' },
      { status: 403, headers: noStore },
    );
  }

  // A nonce is only accepted if this server issued it and it has not been used.
  // Without the second check, one captured signature could be replayed for the
  // nonce's whole lifetime, which is why they are deleted below.
  const issuedTo = pending.get(nonce);
  if (!issuedTo || issuedTo <= Date.now()) {
    pending.delete(nonce);
    return NextResponse.json(
      { error: 'That sign-in request has expired. Start again from the audit page.' },
      { status: 403, headers: noStore },
    );
  }

  const expected = buildAuditMessage(nonce);
  if (!verifyAuditSignature(address, expected, signature)) {
    // A failed signature does not burn the nonce, so a mistyped address in the
    // wallet does not force a full page reload.
    return NextResponse.json(
      { error: 'Signature verification failed.' },
      { status: 403, headers: noStore },
    );
  }

  pending.delete(nonce);
  sweep();
  const token = randomToken();
  issued.set(token, Date.now() + TOKEN_TTL_MS);

  return NextResponse.json(
    { token, expiresInMs: TOKEN_TTL_MS, message: expected },
    { status: 200, headers: noStore },
  );
}