import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Public P2P image uploads are disabled. Use private trade attachments instead.' },
    { status: 410 },
  );
}