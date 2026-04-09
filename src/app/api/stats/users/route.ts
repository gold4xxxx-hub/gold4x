import { NextResponse } from 'next/server';
import { getIndexedUsers } from '@/lib/indexedUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  // Debug: Check environment variables
  console.log('[API /stats/users] BSCSCAN_API_KEY present:', !!process.env.BSCSCAN_API_KEY);
  console.log('[API /stats/users] BSCSCAN_API_KEY length:', process.env.BSCSCAN_API_KEY?.length);
  console.log('[API /stats/users] MANUAL_USER_COUNT:', process.env.MANUAL_USER_COUNT);
  
  try {
    const data = await Promise.race([
      getIndexedUsers(),
      new Promise<Awaited<ReturnType<typeof getIndexedUsers>>>((resolve) =>
        setTimeout(
          () =>
            resolve({
              count: parseInt(process.env.MANUAL_USER_COUNT || '817', 10) || 817,
              users: [],
              source: 'seed',
              updatedAt: new Date().toISOString(),
            }),
          10000
        )
      ),
    ]);
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
