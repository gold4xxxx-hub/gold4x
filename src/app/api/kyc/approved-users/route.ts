import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTRACT_ADDRESS = '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
const DEPLOY_BLOCK = 116_000_000;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 1_000;
const CACHE_TTL_MS = 60 * 1000;
const KYC_VERIFIED_TOPIC = ethers.id('KYCVerified(address,bool)');

type ScanLog = {
  topics?: string[];
  data?: string;
  blockNumber?: string;
  logIndex?: string;
};

type ApprovedUser = {
  wallet: string;
  verifiedAtBlock: number;
};

let cache: { expiresAt: number; users: ApprovedUser[] } | null = null;
let pendingScan: Promise<ApprovedUser[]> | null = null;

function asBlockNumber(value: string | undefined): number {
  if (!value) return 0;
  return Number.parseInt(value, value.startsWith('0x') ? 16 : 10) || 0;
}

async function scanApprovedUsers(): Promise<ApprovedUser[]> {
  const apiKey = process.env.BSCSCAN_API_KEY?.trim();
  if (!apiKey) throw new Error('BSCSCAN_API_KEY is not configured.');

  const latestByWallet = new Map<string, { verified: boolean; block: number }>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      module: 'logs',
      action: 'getLogs',
      fromBlock: String(DEPLOY_BLOCK),
      toBlock: 'latest',
      address: CONTRACT_ADDRESS,
      topic0: KYC_VERIFIED_TOPIC,
      page: String(page),
      offset: String(PAGE_SIZE),
      sort: 'asc',
      apikey: apiKey,
    });
    const response = await fetch(`https://api.bscscan.com/api?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('The BscScan logs service is unavailable.');

    const payload = await response.json() as {
      status?: string;
      message?: string;
      result?: ScanLog[] | string;
    };
    if (!Array.isArray(payload.result)) {
      const noRecords = /no records found/i.test(
        `${payload.message ?? ''} ${String(payload.result ?? '')}`,
      );
      if (noRecords) break;
      throw new Error('Could not read historical KYC verification events.');
    }
    if (payload.status !== '1' && payload.result.length > 0) {
      throw new Error('Could not read historical KYC verification events.');
    }
    if (payload.result.length === 0) break;

    for (const log of payload.result) {
      const walletTopic = log.topics?.[1];
      if (!walletTopic || !log.data) continue;
      let wallet: string;
      try {
        wallet = ethers.getAddress(`0x${walletTopic.slice(-40)}`);
      } catch {
        continue;
      }
      latestByWallet.set(wallet.toLowerCase(), {
        verified: BigInt(log.data) !== 0n,
        block: asBlockNumber(log.blockNumber),
      });
    }

    if (payload.result.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) {
      throw new Error('The historical KYC event list exceeds the supported scan size.');
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return [...latestByWallet.entries()]
    .filter(([, event]) => event.verified)
    .map(([wallet, event]) => ({ wallet: ethers.getAddress(wallet), verifiedAtBlock: event.block }))
    .sort((a, b) => b.verifiedAtBlock - a.verifiedAtBlock);
}

async function getApprovedUsers(): Promise<ApprovedUser[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.users;
  if (pendingScan) return pendingScan;

  pendingScan = scanApprovedUsers();
  try {
    const users = await pendingScan;
    cache = { users, expiresAt: Date.now() + CACHE_TTL_MS };
    return users;
  } finally {
    pendingScan = null;
  }
}

export async function GET() {
  try {
    const users = await getApprovedUsers();
    return NextResponse.json(
      { users, updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load approved users.';
    const status = message.includes('not configured') ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}