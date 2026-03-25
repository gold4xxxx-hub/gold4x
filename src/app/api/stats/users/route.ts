import { NextResponse } from 'next/server';
import { getIndexedUsers } from '@/lib/indexedUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getIndexedUsers();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to load indexed users',
      },
      { status: 500 },
    );
  }
}
