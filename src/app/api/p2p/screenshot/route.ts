import { NextResponse } from 'next/server';

// Accepts a trade screenshot, pins it to IPFS, and returns the CID.
//
// The contract stores screenshots as strings in shareScreenshot(tradeId, hash)
// and in markFiatPaid(tradeId, hash), so what goes on-chain is the CID and
// nothing else. The image stays off-chain.
//
// This is deliberately a separate route from /api/kyc/document rather than a
// shared one, so KYC documents and trade screenshots land in different Pinata
// groups. That keeps private identity documents from being browsable alongside
// public payment screenshots.
//
// The PINATA_JWT stays server-side; see src/lib/pinata.ts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { pinImage, readUpload, PinError } from '@/lib/pinata';

export async function POST(request: Request) {
  try {
    const file = await readUpload(request);
    const result = await pinImage(file, 'p2p-shot', 'gold4x-p2p-shots');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof PinError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
