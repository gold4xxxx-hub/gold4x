import { ethers } from 'ethers';
import seedUsers from '@/data/indexedUsers.json';

// Hardcoded to avoid importing client-side config into server API
const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || 'HRP86PZW4JKHCAQIKAM576DS7ND97Z2JQ8';
const CONTRACT_DEPLOY_BLOCK = 86656188; // Contract deploy block from BSCScan (Create: JSAVIOR tx)
const BASE_USER_COUNT = parseInt(process.env.MANUAL_USER_COUNT || '817', 10);

export type IndexedUsersResult = {
  count: number;
  users: string[];
  source: 'seed' | 'seed+recent-history' | 'seed+recent-history+direct-graph' | 'seed+direct-graph';
  updatedAt: string;
};

function getBaseUserCount(): number {
  return Number.isFinite(BASE_USER_COUNT) && BASE_USER_COUNT > 0 ? BASE_USER_COUNT : 817;
}

// Multiple BSC RPC endpoints for redundancy
const RPC_URLS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
  'https://bsc.rpc.blxrbdn.com/',
];

const MAX_USERS_CRAWL = 2000;
const MAX_DIRECTS_PER_USER = 60;
const MAX_CRAWL_MS = 30000;
const CHUNK_SIZE = 5000; // Block range chunk size for event queries

const INDEX_ABI = [
  'function users(address) view returns (bool registered, address referrer, uint32 directCount, uint128 totalInvested)',
  'function directs(address,uint256) view returns (address)',
  'event Register(address indexed user, address indexed referrer)',
] as const;

function normalizeAddress(value: string): string | null {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : null;
}

function mergeUsers(...groups: string[][]): string[] {
  const unique = new Set<string>();
  for (const group of groups) {
    for (const entry of group) {
      const normalized = normalizeAddress(entry);
      if (normalized) unique.add(normalized);
    }
  }
  return [...unique].sort();
}

// Try to get provider from multiple RPC URLs
async function getProvider(): Promise<ethers.JsonRpcProvider | null> {
  for (const url of RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      // Test the provider
      await provider.getBlockNumber();
      return provider;
    } catch {
      continue;
    }
  }
  return null;
}

// Fetch users from BSCScan API with pagination (handles 1000+ results)
async function fetchUsersFromBSCScan(): Promise<string[]> {
  if (!BSCSCAN_API_KEY) {
    console.log('[BSCScan] No API key, skipping BSCScan fetch');
    return [];
  }

  const users = new Set<string>();
  const pageSize = 1000; // BSCScan max per page
  let offset = 0;
  let hasMore = true;
  let totalPages = 0;

  // Correct topic0 for Register(address indexed user, address indexed referrer)
  // keccak256("Register(address,address)")
  const registerTopic = '0x82fc542738842a66fba84eb26c33e6a2a8bfc5a87d6e7a9f23d90baae6c4b74d';

  try {
    while (hasMore && totalPages < 10) { // Max 10 pages = 10,000 users
      const registerUrl = `https://api.bscscan.com/api?module=logs&action=getLogs&` +
        `fromBlock=${CONTRACT_DEPLOY_BLOCK}&` +
        `toBlock=latest&` +
        `address=${CONTRACT_ADDRESS}&` +
        `topic0=${registerTopic}&` +
        `page=${Math.floor(offset / pageSize) + 1}&` +
        `offset=${pageSize}&` +
        `apikey=${BSCSCAN_API_KEY}`;

      console.log(`[BSCScan] Fetching page ${totalPages + 1}...`);
      console.log(`[BSCScan] URL: ${registerUrl.substring(0, 80)}...`);
      const response = await fetch(registerUrl);
      const data = await response.json();
      console.log(`[BSCScan] Response: status=${data.status}, message=${data.message}, result count=${data.result?.length || 0}`);

      if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
        if (data.message?.includes('No records found') || data.result?.length === 0) {
          console.log('[BSCScan] No more records found');
          hasMore = false;
          break;
        }
        console.warn('[BSCScan] API error:', data.message || 'Unknown error', 'Full response:', JSON.stringify(data).substring(0, 200));
        break;
      }

      for (const log of data.result) {
        // topic1 is the indexed user address (padded to 32 bytes)
        const userTopic = log.topics?.[1];
        if (userTopic) {
          // Remove padding: 0x000000000000000000000000 + 20 byte address
          const address = '0x' + userTopic.slice(26);
          const normalized = normalizeAddress(address);
          if (normalized) users.add(normalized);
        }
      }

      offset += data.result.length;
      totalPages++;

      // If we got less than pageSize results, we're done
      if (data.result.length < pageSize) {
        hasMore = false;
      }

      // Small delay to respect rate limits
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`[BSCScan] Found ${users.size} users from ${totalPages} pages of Register events`);
    return [...users];
  } catch (error) {
    console.error('[BSCScan] Failed to fetch:', error);
    return [];
  }
}

// Fetch users with chunked event querying to handle RPC limits
async function fetchRegisteredUsersFromBlockchain(): Promise<string[]> {
  // Try BSCScan API first (more reliable for large ranges)
  console.log(`[fetchRegisteredUsers] BSCSCAN_API_KEY present: ${BSCSCAN_API_KEY ? 'YES (length ' + BSCSCAN_API_KEY.length + ')' : 'NO'}`);
  if (BSCSCAN_API_KEY) {
    console.log('[fetchRegisteredUsers] Attempting BSCScan API...');
    const bscscanUsers = await fetchUsersFromBSCScan();
    console.log(`[fetchRegisteredUsers] BSCScan returned ${bscscanUsers.length} users`);
    if (bscscanUsers.length > 0) {
      return bscscanUsers;
    }
  } else {
    console.log('[fetchRegisteredUsers] No BSCScan API key, skipping...');
  }

  const provider = await getProvider();
  if (!provider) {
    console.error('[RPC] No available RPC provider');
    return [];
  }

  try {
    const contract = new ethers.Contract(CONTRACT_ADDRESS, INDEX_ABI, provider);

    // Get latest block
    const latestBlock = await provider.getBlockNumber();
    console.log(`[RPC] Querying from block ${CONTRACT_DEPLOY_BLOCK} to ${latestBlock}`);

    const allUsers = new Set<string>();
    const registerFilter = contract.filters.Register();

    // Query events in chunks to avoid RPC limits
    let chunksSucceeded = 0;
    let chunksFailed = 0;
    for (let fromBlock = CONTRACT_DEPLOY_BLOCK; fromBlock <= latestBlock; fromBlock += CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlock);

      try {
        const events = await contract.queryFilter(registerFilter, fromBlock, toBlock);
        chunksSucceeded++;

        for (const event of events) {
          const userAddress = (event as any).args?.[0] || (event as any).topics?.[1];
          if (userAddress) {
            const normalized = normalizeAddress(String(userAddress));
            if (normalized) allUsers.add(normalized);
          }
        }
      } catch (err) {
        chunksFailed++;
        console.error(`[RPC] Failed to query blocks ${fromBlock}-${toBlock}:`, (err as Error).message);
        // Continue to next chunk
      }
    }

    console.log(`[RPC] Chunks: ${chunksSucceeded} succeeded, ${chunksFailed} failed, ${allUsers.size} users found`);
    return [...allUsers];
  } catch (error) {
    console.error('[RPC] Failed to fetch users from blockchain:', error);
    return [];
  }
}

export async function getIndexedUsers(): Promise<IndexedUsersResult> {
  const baseCount = getBaseUserCount();

  // Start with seed data as the base
  let baseUsers: string[] = [...seedUsers];
  let source: IndexedUsersResult['source'] = 'seed';

  // Add timeout wrapper to prevent hanging (30s for BSCScan API)
  const fetchWithTimeout = async (): Promise<string[]> => {
    return Promise.race([
      fetchRegisteredUsersFromBlockchain(),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 30000) // 30 second timeout
      ),
    ]);
  };

  try {
    const registeredUsers = await fetchWithTimeout();
    if (registeredUsers.length > 0) {
      // Merge blockchain users with seed data to ensure we don't lose anyone
      baseUsers = mergeUsers(seedUsers, registeredUsers);
      source = 'seed+recent-history';
      console.log(`[getIndexedUsers] Fetched ${registeredUsers.length} users from blockchain, merged with ${seedUsers.length} seed users = ${baseUsers.length} total`);
    } else {
      // If blockchain returns empty, use seed data but log warning
      console.warn('[getIndexedUsers] Blockchain query returned 0 users, using seed data only');
      baseUsers = [...seedUsers];
      source = 'seed';
    }
  } catch (error) {
    console.error('[getIndexedUsers] Failed to fetch registered users from blockchain:', error);
    // Fall back to seed data on error
    baseUsers = [...seedUsers];
    source = 'seed';
  }

  try {
    const provider = await getProvider();
    if (!provider) {
      throw new Error('No available RPC provider');
    }
    const contract = new ethers.Contract(CONTRACT_ADDRESS, INDEX_ABI, provider);

    const discovered = new Set<string>(baseUsers);
    const queue = [...baseUsers];
    const startedAt = Date.now();

    while (queue.length > 0 && discovered.size < MAX_USERS_CRAWL) {
      if (Date.now() - startedAt > MAX_CRAWL_MS) break;

      const user = queue.shift();
      if (!user) break;

      let directCount = 0;
      try {
        const userInfo = await contract.users(user);
        directCount = Number(userInfo?.directCount ?? 0);
      } catch {
        directCount = 0;
      }

      if (directCount <= 0) continue;

      const maxIndex = Math.min(directCount, MAX_DIRECTS_PER_USER);

      for (let i = 0; i < maxIndex && discovered.size < MAX_USERS_CRAWL; i++) {
        try {
          const childRaw = await contract.directs(user, i);
          const child = normalizeAddress(String(childRaw));
          if (!child || discovered.has(child)) continue;

          const childInfo = await contract.users(child);
          if (!Boolean(childInfo?.registered)) continue;

          discovered.add(child);
          queue.push(child);
        } catch {
          continue;
        }
      }
    }

    const users = [...discovered].sort();
    // Use blockchain count as primary source, manual count only as absolute fallback
    // If we have blockchain data (source includes 'recent-history'), use it
    const blockchainCount = source.includes('recent-history') ? users.length : null;
    const finalCount = blockchainCount !== null ? blockchainCount : Math.max(baseCount, baseUsers.length);
    return {
      count: finalCount,
      users,
      source: source === 'seed+recent-history' ? 'seed+recent-history+direct-graph' : 'seed+direct-graph',
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      count: Math.max(baseCount, baseUsers.length),
      users: baseUsers,
      source,
      updatedAt: new Date().toISOString(),
    };
  }
}
