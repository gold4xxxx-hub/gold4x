import { NextResponse } from 'next/server';
import { setKycStatus, toPublicKyc } from '@/lib/kycStore';

type StatusBody = {
  reference?: string;
  status?: 'pending' | 'approved' | 'rejected';
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ADMIN_CREDENTIAL = '0xf7252055eA263770817Dd73363A3259DEDAe9050';

function isAddressLike(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isAuthorized(request: Request): boolean {
  const url = new URL(request.url);
  const keyFromQuery = url.searchParams.get('key') || '';
  const keyFromHeader = request.headers.get('x-admin-key') || '';

  const configured = process.env.KYC_ADMIN_KEY?.trim();
  const expected = configured && configured.length > 0 ? configured : DEFAULT_ADMIN_CREDENTIAL;
  const supplied = (keyFromQuery || keyFromHeader).trim();

  if (!supplied) return false;
  if (isAddressLike(expected)) {
    return supplied.toLowerCase() === expected.toLowerCase();
  }
  return supplied === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as StatusBody;
  const reference = String(body.reference || '').trim();
  const status = body.status;

  if (!reference) {
    return NextResponse.json({ error: 'reference is required' }, { status: 400 });
  }

  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
  }

  const updated = setKycStatus(reference, status);
  if (!updated) {
    return NextResponse.json({ error: 'KYC reference not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    record: toPublicKyc(updated),
  });
}
