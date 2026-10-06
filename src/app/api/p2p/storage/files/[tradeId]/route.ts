import { NextResponse } from 'next/server';
import {
  authorizeP2PStorageRequest,
  createPrivateFileUrl,
  hashBytes,
  listTradeFiles,
  P2PStorageError,
  uploadPrivateTradeFile,
  type P2PAuthFields,
} from '@/lib/p2pStorageServer';
import type { P2PStorageAction } from '@/lib/p2pStorageProtocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type FileListRequest = P2PAuthFields & { action: P2PStorageAction };

export async function POST(
  request: Request,
  context: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId: rawTradeId } = await context.params;
    const tradeId = Number(rawTradeId);
    const body = await request.json() as FileListRequest;
    if (body.action !== 'file.list') throw new P2PStorageError('Unknown file action.', 400);
    await authorizeP2PStorageRequest({ ...body, tradeId }, false);

    const files = await listTradeFiles(tradeId);
    const withUrls = await Promise.all(files.map(async (file) => ({
      id: file.id,
      uploadedBy: file.uploaded_by,
      contentType: file.content_type,
      sizeBytes: file.size_bytes,
      createdAt: file.created_at,
      url: await createPrivateFileUrl(file.object_path),
    })));
    return NextResponse.json({ files: withUrls });
  } catch (error) {
    if (error instanceof P2PStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not load trade files.' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId: rawTradeId } = await context.params;
    const tradeId = Number(rawTradeId);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new P2PStorageError('Choose a file to share.', 400);
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new P2PStorageError('Only JPG, PNG, WEBP and PDF files are accepted.', 415);
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new P2PStorageError('File must be smaller than 10 MB.', 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const actualHash = hashBytes(bytes);
    const auth: P2PAuthFields = {
      tradeId,
      wallet: String(form.get('wallet') ?? ''),
      action: 'file.upload',
      requestId: String(form.get('requestId') ?? ''),
      timestamp: Number(form.get('timestamp')),
      payloadHash: String(form.get('payloadHash') ?? ''),
      signature: String(form.get('signature') ?? ''),
    };
    if (actualHash.toLowerCase() !== auth.payloadHash.toLowerCase()) {
      throw new P2PStorageError('File changed after wallet signature. Please retry.', 400);
    }
    const wallet = await authorizeP2PStorageRequest(auth, true);
    const stored = await uploadPrivateTradeFile({
      tradeId,
      wallet,
      requestId: auth.requestId,
      contentType: file.type,
      bytes,
      sha256: actualHash,
    });
    return NextResponse.json({
      file: {
        id: stored.id,
        uploadedBy: stored.uploaded_by,
        contentType: stored.content_type,
        sizeBytes: stored.size_bytes,
        createdAt: stored.created_at,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof P2PStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not store the trade file.' }, { status: 500 });
  }
}