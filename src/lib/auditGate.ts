/**
 * Signature gate for the audit page.
 *
 * A wallet signature is used rather than a password or API key because there is
 * nothing to store, rotate or leak: the server asks the holder of
 * AUDIT_SIGNERS to sign a nonce, and checks the signature recovers to that
 * address. No session, no cookie, no secret in git.
 *
 * This module runs on the server only. The allowlist comes from an environment
 * variable so it can be changed without a deploy, and never from the repository.
 *
 * The signature is checked against a domain-scoped message. Without that, a
 * signature collected here could be replayed against another site that happens
 * to ask the user to sign an arbitrary string - a "sign in to X" phishing flow.
 */

import { verifyMessage, isAddress } from 'ethers';

const DOMAIN = 'gold4x.in';
const PURPOSE = 'P2P escrow audit access';

/**
 * Signers permitted to read the audit index.
 *
 * Read from the environment rather than hardcoded: the address is a deployment
 * decision, and changing it should not require touching committed code.
 */
function allowedSigners(): string[] {
  const raw = process.env.AUDIT_SIGNERS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    // Lowercased before validating, not after. isAddress() rejects a
    // mixed-case address whose EIP-55 checksum does not hold, and addresses get
    // pasted with arbitrary casing from block explorers, chat and QR codes.
    // Requiring a valid checksum here would lock out the owner over capital
    // letters. The comparison below is against a lowercased list, so casing
    // cannot be used to slip past the check.
    .filter((s) => isAddress(s));
}

/**
 * Whether an address may attempt to unlock the audit page.
 *
 * Case-insensitive, because a checksummed address and its lowercase form are the
 * same account and rejecting one would lock the owner out of their own tool.
 */
export function isAllowedAuditSigner(address?: string | null): boolean {
  if (!address || !isAddress(address.toLowerCase())) return false;
  return allowedSigners().includes(address.toLowerCase());
}

/**
 * The exact text the wallet must sign.
 *
 * Include a nonce so a signature captured once cannot be replayed forever, and
 * the domain and purpose so a signature given here is worthless elsewhere.
 */
export function buildAuditMessage(nonce: string): string {
  return `${DOMAIN} — ${PURPOSE}\nnonce: ${nonce}\nThis grants read-only access to the escrow audit index. It cannot move funds.`;
}

/**
 * Verify that `signature` over `message` was produced by `claimedAddress`.
 *
 * Returns false rather than throwing on any malformed input. A gate that throws
 * on a bad signature is a gate that leaks which part was wrong.
 */
export function verifyAuditSignature(
  claimedAddress: string,
  message: string,
  signature?: string | null,
): boolean {
  if (!claimedAddress || !message || !signature) return false;
  if (!isAddress(claimedAddress.toLowerCase())) return false;

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    // Malformed hex, wrong length, or a signature in the wrong format.
    return false;
  }

  if (recovered.toLowerCase() !== claimedAddress.toLowerCase()) return false;
  return isAllowedAuditSigner(recovered);
}

/**
 * A cryptographically random nonce for one unlock attempt.
 */
export function newAuditNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}