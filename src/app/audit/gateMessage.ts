/**
 * The exact text a wallet is asked to sign.
 *
 * Kept in a client-safe module of its own, separate from src/lib/auditGate.ts,
 * because that file is server-only: it reads process.env.AUDIT_SIGNERS and
 * imports ethers verification helpers. Importing it into the browser would pull
 * the allowlist into the page bundle, where anyone could read it.
 *
 * The two strings here must match the constants in src/lib/auditGate.ts. If they
 * drift, signatures verify against a different string and every unlock fails
 * closed - which is safe, but confusing, so they are asserted in the gate tests.
 */

export const AUDIT_DOMAIN = 'gold4x.in';
export const AUDIT_PURPOSE = 'P2P escrow audit access';

export function buildAuditMessageLocal(domain: string, purpose: string, nonce: string): string {
  return `${domain} — ${purpose}\nnonce: ${nonce}\nThis grants read-only access to the escrow audit index. It cannot move funds.`;
}