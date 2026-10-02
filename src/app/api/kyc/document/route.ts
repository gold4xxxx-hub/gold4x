import { NextResponse } from 'next/server';

// Accepts a KYC document image, pins it to IPFS via Pinata, and returns the
// CID. The contract's aadharFrontHash / aadharBackHash fields are strings, so
// what goes on-chain is the CID and nothing else — the image itself never
// touches the blockchain.
//
// The PINATA_JWT stays server-side. Putting it in the browser would let anyone
// read it and use your account, and would expose the private gateway.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Aadhaar images are a few hundred KB; cap well below the platform body limit.
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
]);

type PinataResponse = {
  IpfsHash?: string;
  PinSize?: number;
  Timestamp?: string;
};

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    return NextResponse.json(
      { error: 'Document upload is not configured. Set PINATA_JWT on the server.' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  }

  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: 'Only JPG, PNG, WEBP, HEIC or HEIF images are accepted.' },
      { status: 415 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'The selected file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image is too large. Maximum size is ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  // Rename before pinning so the public file name carries no personal detail
  // (Aadhaar numbers routinely appear in filenames like "aadhaar_1234.jpg").
  const safeName = `kyc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const outbound = new File([buffer], safeName, { type: file.type });

  const upstream = new FormData();
  upstream.append('file', outbound);
  upstream.append(
    'pinataMetadata',
    JSON.stringify({ name: safeName, group: 'gold4x-kyc' }),
  );

  let res: Response;
  try {
    res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the storage service. Please try again.' },
      { status: 502 },
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ?? '';
    } catch {
      detail = '';
    }
    // Never echo the upstream body verbatim; it can contain key hints.
    const hint =
      res.status === 401 || res.status === 403
        ? 'Storage credentials were rejected.'
        : detail
          ? 'The storage service rejected this file.'
          : 'Upload failed.';
    return NextResponse.json({ error: hint }, { status: 502 });
  }

  const data = (await res.json()) as PinataResponse;
  if (!data?.IpfsHash) {
    return NextResponse.json(
      { error: 'Upload finished but no file reference was returned.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    cid: data.IpfsHash,
    size: data.PinSize ?? buffer.length,
    name: safeName,
  });
}
