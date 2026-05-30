import { NextResponse } from 'next/server';
import { getIndexedUsers } from '@/lib/indexedUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Simple in-memory cache to reduce BSCScan API calls
const CACHE_TTL = 1 * 60 * 1000; // 1 minute - faster updates
let cachedData: Awaited<ReturnType<typeof getIndexedUsers>> | null = null;
let cacheTimestamp = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.has('t');
  const now = Date.now();
  
  // Debug: Check environment variables
  console.log('[API /stats/users] BSCSCAN_API_KEY present:', !!process.env.BSCSCAN_API_KEY);
  console.log('[API /stats/users] BSCSCAN_API_KEY length:', process.env.BSCSCAN_API_KEY?.length);
  console.log('[API /stats/users] Force refresh:', forceRefresh);
  
  try {
    // Check cache first (unless force refresh is requested)
    if (!forceRefresh && cachedData && (now - cacheTimestamp) < CACHE_TTL) {
      console.log('[API /stats/users] Using cached data (age:', (now - cacheTimestamp) / 1000, 'seconds)');
      return NextResponse.json(cachedData, {
        headers: {
          'Cache-Control': 'public, max-age=60', // 1 minute
        },
      });
    }

    console.log('[API /stats/users] Fetching fresh data from blockchain');
    const data = await getIndexedUsers();

    // Update cache
    cachedData = data;
    cacheTimestamp = now;
    console.log('[API /stats/users] Cache updated, count:', data.count, 'source:', data.source);

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60', // 1 minute
      },
    });
  } catch (error) {
    console.error('[API /stats/users] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to load indexed users',
      },
      { status: 500 },
    );
  }
}
