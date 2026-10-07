import { NextResponse } from 'next/server';

// Accepts a trade screenshot, pins it to IPFS via Pinata, and returns the CID.
//
// The contract stores screenshots as strings in shareScreenshot(tradeId, hash),
// so what goes on-chain is the CID and nothing else. The image stays off-chain.
//
// Shared with /api/kyc/document through src/lib/pinata.ts, so validation,
// renaming and the Pinata call have one implementation rather than two that can
// drift apart. The PINATA_JWT stays server-side; see that module.
//
// Every file is renamed before pinning. A payment screenshot is commonly named
// after the payer or their UPI id, and a pinned name is permanent and public.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { pinImage, readUpload, PinError } from '@/lib/pinata';

export async function POST(request: Request) {
  try {
    const file = await readUpload(request);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return NextResponse.json(
        { error: 'Only JPG, PNG, and WEBP screenshots are accepted.' },
        { status: 415 },
      );
    }
    const result = await pinImage(file, 'p2p-shot', 'gold4x-p2p-shots');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof PinError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: 'Upload failed. Please try again.' },
      { status: 500 },
    );
  }
}
