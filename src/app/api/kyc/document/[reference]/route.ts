import { NextResponse } from 'next/server';
import { getKycDocumentByReference, KycDocumentKind } from '@/lib/kycStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_KINDS: KycDocumentKind[] = ['idFront', 'idBack', 'pan', 'bankStatement'];

export async function GET(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
  const { reference } = await context.params;
  const ref = decodeURIComponent(reference || '').trim();
  if (!ref) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const kind = String(searchParams.get('kind') || '').trim() as KycDocumentKind;
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: 'Invalid document kind' }, { status: 400 });
  }

  const document = getKycDocumentByReference(ref, kind);
  if (!document || !document.base64) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const bytes = Buffer.from(document.base64, 'base64');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${document.name || `${kind}.bin`}"`,
      'Cache-Control': 'no-store',
    },
  });
}
