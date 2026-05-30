import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getKyc, toPublicKyc } from '@/lib/kycStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ wallet: string }> },
) {
  const { wallet } = await context.params;
  const value = decodeURIComponent(wallet || '').trim();

  if (!ethers.isAddress(value)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const record = getKyc(value);
  return NextResponse.json({
    ok: true,
    found: Boolean(record),
    record: record ? toPublicKyc(record) : null,
  });
}
