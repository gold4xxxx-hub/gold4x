import { ethers } from 'ethers';

// Hardcoded to avoid importing client-side config into server API
const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY;
const CONTRACT_DEPLOY_BLOCK = 86656188; // Contract deploy block from BSCScan (Create: JSAVIOR tx)

export type IndexedUsersResult = {
  count: number;
  users: string[];
  source: 'contract' | 'bscscan';
  updatedAt: string;
};

const RPC_URLS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
];

// Manual override for user count - set this variable to override the count
const MANUAL_USER_COUNT_OVERRIDE: number | null = 1099;

function normalizeAddress(value: string): string | null {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : null;
}

// Try to get provider from multiple RPC URLs
async function getProvider(): Promise<ethers.JsonRpcProvider | null> {
  for (const url of RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
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

  // Topic0 for Register(address indexed user, address indexed referrer)
  // keccak256("Register(address,address)")
  const registerTopic = '0x82fc542738842a66fba84eb26c33e6a2a8bfc5a87d6e7a9f23d90baae6c4b74d';

  try {
    while (hasMore && totalPages < 20) { // Max 20 pages = 20,000 users
      const registerUrl = `https://api.bscscan.com/api?module=logs&action=getLogs&` +
        `fromBlock=${CONTRACT_DEPLOY_BLOCK}&` +
        `toBlock=latest&` +
        `address=${CONTRACT_ADDRESS}&` +
        `topic0=${registerTopic}&` +
        `page=${Math.floor(offset / pageSize) + 1}&` +
        `offset=${pageSize}&` +
        `apikey=${BSCSCAN_API_KEY}`;

      console.log(`[BSCScan] Fetching page ${totalPages + 1}...`);
      const response = await fetch(registerUrl);
      const data = await response.json();

      if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
        if (data.message?.includes('No records found') || data.result?.length === 0) {
          console.log('[BSCScan] No more records found');
          hasMore = false;
          break;
        }
        console.warn('[BSCScan] API error:', data.message);
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

// Fetch users directly from blockchain via RPC (fallback if BSCScan fails)
async function fetchUsersFromRPC(): Promise<string[]> {
  const provider = await getProvider();
  if (!provider) {
    console.error('[RPC] No available RPC provider');
    return [];
  }

  try {
    const INDEX_ABI = [
      'event Register(address indexed user, address indexed referrer)',
    ] as const;

    const contract = new ethers.Contract(CONTRACT_ADDRESS, INDEX_ABI, provider);
    const latestBlock = await provider.getBlockNumber();
    console.log(`[RPC] Querying from block ${CONTRACT_DEPLOY_BLOCK} to ${latestBlock}`);

    const allUsers = new Set<string>();
    const registerFilter = contract.filters.Register();
    const CHUNK_SIZE = 10000;

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
  console.log('[getIndexedUsers] Fetching user count...');

  // Try BSCScan API first
  const bscscanUsers = await fetchUsersFromBSCScan();

  if (bscscanUsers.length > 0) {
    console.log(`[getIndexedUsers] Successfully fetched ${bscscanUsers.length} users from BSCScan`);
    return {
      count: MANUAL_USER_COUNT_OVERRIDE !== null ? MANUAL_USER_COUNT_OVERRIDE : bscscanUsers.length,
      users: bscscanUsers,
      source: 'bscscan',
      updatedAt: new Date().toISOString(),
    };
  }

  // If BSCScan fails or returns 0, try RPC fallback
  console.log('[getIndexedUsers] BSCScan failed or returned 0, trying RPC fallback...');
  const rpcUsers = await fetchUsersFromRPC();

  if (rpcUsers.length > 0) {
    console.log(`[getIndexedUsers] Successfully fetched ${rpcUsers.length} users from RPC`);
    return {
      count: MANUAL_USER_COUNT_OVERRIDE !== null ? MANUAL_USER_COUNT_OVERRIDE : rpcUsers.length,
      users: rpcUsers,
      source: 'contract',
      updatedAt: new Date().toISOString(),
    };
  }

  // If both fail, return 0 or manual override
  console.log('[getIndexedUsers] Both BSCScan and RPC failed, returning 0');
  return {
    count: MANUAL_USER_COUNT_OVERRIDE !== null ? MANUAL_USER_COUNT_OVERRIDE : 0,
    users: [],
    source: 'contract',
    updatedAt: new Date().toISOString(),
  };
}
