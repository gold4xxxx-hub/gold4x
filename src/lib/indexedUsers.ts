import indexedUsersSeed from '@/data/indexedUsers.json';
import { ethers } from 'ethers';

const CONTRACT_ADDRESS = '0x54bc3ae174550098da0756ea2d7b8855bd3c65cf';

export type IndexedUsersResult = {
  count: number;
  users: string[];
  source: 'seed' | 'seed+recent-history' | 'seed+recent-history+direct-graph' | 'seed+direct-graph';
  updatedAt: string;
};

const RPC_URL = 'https://bsc-dataseed.binance.org/';
const MAX_USERS_CRAWL = 500;
const MAX_DIRECTS_PER_USER = 60;
const MAX_CRAWL_MS = 20000;

// Manual override for user count - set this variable to override the count
const MANUAL_USER_COUNT_OVERRIDE: number | null = 1099;

const INDEX_ABI = [
  'function users(address) view returns (bool registered, address referrer, uint32 directCount, uint128 totalInvested)',
  'function directs(address,uint256) view returns (address)',
] as const;

type BscScanRow = {
  Status?: string;
  Method?: string;
  Sender?: string;
};

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

async function fetchRecentRegisteredUsers(): Promise<string[]> {
  const response = await fetch(`https://bscscan.com/address/${CONTRACT_ADDRESS}`, {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`BscScan request failed with status ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(/const quickExportCsvData = '([\s\S]*?)';/);
  if (!match) {
    throw new Error('BscScan quick export data was not found');
  }

  const rows = JSON.parse(match[1].replace(/\\'/g, "'")) as BscScanRow[];
  const recentUsers = rows
    .filter((row) => row.Status === 'Success' && (row.Method === 'Register' || row.Method === 'Register With Stable'))
    .map((row) => normalizeAddress(row.Sender || ''))
    .filter((value): value is string => Boolean(value));

  return [...new Set(recentUsers)];
}

export async function getIndexedUsers(): Promise<IndexedUsersResult> {
  const seedUsers = mergeUsers(indexedUsersSeed as string[]);
  let baseUsers = seedUsers;
  let source: IndexedUsersResult['source'] = 'seed';

  try {
    const recentUsers = await fetchRecentRegisteredUsers();
    baseUsers = mergeUsers(seedUsers, recentUsers);
    source = 'seed+recent-history';
  } catch {
    baseUsers = seedUsers;
    source = 'seed';
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
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
    return {
      count: MANUAL_USER_COUNT_OVERRIDE !== null ? MANUAL_USER_COUNT_OVERRIDE : users.length,
      users,
      source: source === 'seed+recent-history' ? 'seed+recent-history+direct-graph' : 'seed+direct-graph',
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      count: MANUAL_USER_COUNT_OVERRIDE !== null ? MANUAL_USER_COUNT_OVERRIDE : baseUsers.length,
      users: baseUsers,
      source,
      updatedAt: new Date().toISOString(),
    };
  }
}
