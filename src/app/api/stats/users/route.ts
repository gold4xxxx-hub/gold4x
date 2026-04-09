import { NextResponse } from 'next/server';
import { getIndexedUsers } from '@/lib/indexedUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Simple in-memory cache to reduce BSCScan API calls
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedData: Awaited<ReturnType<typeof getIndexedUsers>> | null = null;
let cacheTimestamp = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === 'true';
  const now = Date.now();
  
  // Debug: Check environment variables
  console.log('[API /stats/users] BSCSCAN_API_KEY present:', !!process.env.BSCSCAN_API_KEY);
  console.log('[API /stats/users] BSCSCAN_API_KEY length:', process.env.BSCSCAN_API_KEY?.length);
  console.log('[API /stats/users] MANUAL_USER_COUNT:', process.env.MANUAL_USER_COUNT);
  console.log('[API /stats/users] Force refresh:', forceRefresh);
  
  try {
    // Check cache first (unless force refresh is requested)
    if (!forceRefresh && cachedData && (now - cacheTimestamp) < CACHE_TTL) {
      console.log('[API /stats/users] Using cached data (age:', (now - cacheTimestamp) / 1000, 'seconds)');
      return NextResponse.json(cachedData, {
        headers: {
          'Cache-Control': 'public, max-age=300', // 5 minutes
        },
      });
    }
    
    console.log('[API /stats/users] Fetching fresh data from blockchain');
    const data = await Promise.race([
      getIndexedUsers(),
      new Promise<Awaited<ReturnType<typeof getIndexedUsers>>>((resolve) =>
        setTimeout(
          () =>
            resolve({
              count: parseInt(process.env.MANUAL_USER_COUNT || '821', 10) || 821,
              users: [],
              source: 'seed',
              updatedAt: new Date().toISOString(),
            }),
          10000
        )
      ),
    ]);
    
    // Update cache
    cachedData = data;
    cacheTimestamp = now;
    console.log('[API /stats/users] Cache updated');
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=300', // 5 minutes
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
