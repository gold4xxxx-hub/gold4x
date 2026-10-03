// Client-safe IPFS helpers.
//
// Deliberately separate from src/lib/pinata.ts, which reads PINATA_JWT. That
// module is server-only, and importing it from a client component would pull
// the credential path into the browser bundle.

const GATEWAY = 'https://gateway.pinata.cloud/ipfs';

/**
 * Public gateway URL for a CID.
 *
 * Accepts a bare CID, an ipfs:// URI, or a full gateway URL, so a value pasted
 * from anywhere still renders.
 */
export function ipfsUrl(raw: string): string {
  let v = (raw || '').trim().replace(/^ipfs:\/\//i, '');
  // Already a full http(s) URL: leave it alone.
  if (/^https?:\/\//i.test(v)) return v;
  // Otherwise pull the trailing CID out of a path-style gateway URL.
  const m = v.match(
    /^(?:ipfs\/|ipns\/)?[^/]*\/?(?:ipfs\/)?(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/i,
  );
  if (m?.[1]) v = m[1];
  return `${GATEWAY}/${v}`;
}
