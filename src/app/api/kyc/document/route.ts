import { NextResponse } from 'next/server';

// Accepts a KYC document image, pins it to IPFS via Pinata, and returns the
// CID. The contract's aadharFrontHash / aadharBackHash fields are strings, so
// what goes on-chain is the CID and nothing else — the image itself never
// touches the blockchain.
//
// The actual pinning, validation and renaming live in src/lib/pinata.ts, which
// is shared with the P2P trade screenshot upload. There is one hardened
// implementation rather than two that can drift apart.
//
// The PINATA_JWT stays server-side. Putting it in the browser would let anyone
// read it and use your account, and would expose the private gateway.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { pinImage, readUpload, PinError } from '@/lib/pinata';

export async function POST(request: Request) {
  try {
    const file = await readUpload(request);
    // Renamed before pinning so the public file name carries no personal
    // detail — Aadhaar numbers routinely appear in names like
    // "aadhaar_1234.jpg", and a pinned name is permanent.
    const result = await pinImage(file, 'kyc', 'gold4x-kyc');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof PinError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
