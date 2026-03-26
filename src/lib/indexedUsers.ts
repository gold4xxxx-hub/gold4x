import { ethers } from 'ethers';

const CONTRACT_ADDRESS = '0x54bc3ae174550098da0756ea2d7b8855bd3c65cf';
const ROOT_ADDRESS = '0xf9d3a64e5c40129e5e2cc0c6693d574961b7b0fd';

export type IndexedUsersResult = {
  count: number;
  users: string[];
  source: 'root-graph' | 'root-only';
  updatedAt: string;
};

const RPC_URL = 'https://bsc-dataseed.binance.org/';
const MAX_USERS_CRAWL = 5000;
const MAX_DIRECTS_PER_USER = 500;
const MAX_CRAWL_MS = 20000;

const INDEX_ABI = [
  'function users(address) view returns (bool registered, address referrer, uint32 directCount, uint128 totalInvested)',
  'function directs(address,uint256) view returns (address)',
] as const;

function normalizeAddress(value: string): string | null {
  const address = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : null;
}

export async function getIndexedUsers(): Promise<IndexedUsersResult> {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, INDEX_ABI, provider);

    const discovered = new Set<string>([ROOT_ADDRESS]);
    const queue = [ROOT_ADDRESS];
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
    return {
      count: users.length,
      users,
      source: 'root-graph',
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      count: 1,
      users: [ROOT_ADDRESS],
      source: 'root-only',
      updatedAt: new Date().toISOString(),
    };
  }
}

