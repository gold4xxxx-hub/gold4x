import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { kycDocumentMessage } from '@/lib/p2pStorageProtocol';
import {
  createPrivateFileUrl,
  getEscrowOwner,
  getKycDocument,
  hashBytes,
  P2PStorageError,
  storeKycDocument,
} from '@/lib/p2pStorageServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIGNATURE_AGE_SECONDS = 300;

type UploadFields = {
  wallet: string;
  side: 'front' | 'back';
  requestId: string;
  timestamp: number;
  payloadHash: string;
  signature: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readUpload(request: Request): Promise<{ file: File; fields: UploadFields }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new P2PStorageError('Invalid Aadhaar upload request.', 400);
  }
  const file = form.get('file');
  const side = String(form.get('side') ?? '');
  const fields: UploadFields = {
    wallet: String(form.get('wallet') ?? ''),
    side: side as UploadFields['side'],
    requestId: String(form.get('requestId') ?? ''),
    timestamp: Number(form.get('timestamp')),
    payloadHash: String(form.get('payloadHash') ?? ''),
    signature: String(form.get('signature') ?? ''),
  };
  if (!(file instanceof File)) throw new P2PStorageError('No Aadhaar image received.', 400);
  if (!/^0x[a-fA-F0-9]{40}$/.test(fields.wallet) || !['front', 'back'].includes(fields.side) ||
      !isUuid(fields.requestId) || !Number.isSafeInteger(fields.timestamp) ||
      !/^0x[a-fA-F0-9]{64}$/.test(fields.payloadHash) || !/^0x[a-fA-F0-9]{130}$/.test(fields.signature)) {
    throw new P2PStorageError('Invalid signed Aadhaar upload request.', 400);
  }
  return { file, fields };
}

function verifyFreshSignature(timestamp: number) {
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > MAX_SIGNATURE_AGE_SECONDS) {
    throw new P2PStorageError('Upload authorization expired. Please select the document again.', 401);
  }
}

async function uploadDocument(request: Request) {
  const { file, fields } = await readUpload(request);
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new P2PStorageError('Aadhaar image must be JPG, PNG or WEBP.', 415);
  }
  if (file.size < 1 || file.size > MAX_BYTES) {
    throw new P2PStorageError('Aadhaar image must be no larger than 5 MB.', 413);
  }
  verifyFreshSignature(fields.timestamp);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = hashBytes(bytes);
  if (digest.toLowerCase() !== fields.payloadHash.toLowerCase()) {
    throw new P2PStorageError('Aadhaar image changed after wallet signature. Please retry.', 400);
  }

  let wallet: string;
  try {
    wallet = ethers.getAddress(fields.wallet);
    const recovered = ethers.verifyMessage(kycDocumentMessage({
      wallet,
      action: 'kyc.upload',
      documentSide: fields.side,
      requestId: fields.requestId,
      timestamp: fields.timestamp,
      payloadHash: fields.payloadHash,
    }), fields.signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) throw new Error('Signer mismatch');
  } catch {
    throw new P2PStorageError('Wallet signature is invalid. Please retry the upload.', 401);
  }

  const result = await storeKycDocument({
    wallet,
    documentSide: fields.side,
    requestId: fields.requestId,
    contentType: file.type,
    bytes,
    sha256: digest,
  });
  return NextResponse.json({ ok: true, reference: result.reference });
}

async function readPrivateDocument(request: Request) {
  const body = await request.json() as {
    wallet?: string;
    reference?: string;
    requestId?: string;
    timestamp?: number;
    payloadHash?: string;
    signature?: string;
  };
  const reference = String(body.reference ?? '');
  const walletInput = String(body.wallet ?? '');
  const requestId = String(body.requestId ?? '');
  const timestamp = Number(body.timestamp);
  const payloadHash = String(body.payloadHash ?? '');
  const signature = String(body.signature ?? '');
  const match = reference.match(/^private-kyc:\/\/(0x[a-f0-9]{40})\/(front|back)\/([0-9a-f-]{36})$/i);
  if (!match || !/^0x[a-fA-F0-9]{40}$/.test(walletInput) || !isUuid(requestId) ||
      !Number.isSafeInteger(timestamp) || !/^0x[a-fA-F0-9]{64}$/.test(payloadHash) ||
      !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new P2PStorageError('Invalid private KYC document request.', 400);
  }
  const [, documentWallet, side, documentRequestId] = match;
  if (documentRequestId.toLowerCase() !== requestId.toLowerCase() ||
      hashBytes(new TextEncoder().encode(reference)).toLowerCase() !== payloadHash.toLowerCase()) {
    throw new P2PStorageError('Document authorization does not match this reference.', 400);
  }
  verifyFreshSignature(timestamp);

  let wallet: string;
  try {
    wallet = ethers.getAddress(walletInput);
    const recovered = ethers.verifyMessage(kycDocumentMessage({
      wallet,
      action: 'kyc.read',
      documentSide: side as UploadFields['side'],
      requestId,
      timestamp,
      payloadHash,
    }), signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) throw new Error('Signer mismatch');
  } catch {
    throw new P2PStorageError('Owner wallet signature is invalid.', 401);
  }

  if (wallet.toLowerCase() !== (await getEscrowOwner()).toLowerCase()) {
    throw new P2PStorageError('Only the escrow owner can view private Aadhaar documents.', 403);
  }
  const doc = await getKycDocument(reference);
  if (doc.wallet.toLowerCase() !== documentWallet.toLowerCase()) {
    throw new P2PStorageError('Document reference did not match its owner.', 403);
  }
  return NextResponse.json({ url: await createPrivateFileUrl(doc.object_path) });
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      return await readPrivateDocument(request);
    }
    return await uploadDocument(request);
  } catch (e) {
    if (e instanceof P2PStorageError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
