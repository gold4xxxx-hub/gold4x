import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  archiveRpcUrl,
  asBlockNumber,
  scanTopic,
  walletFromTopic,
  KYC_VERIFIED_TOPIC,
} from '@/lib/kycLogScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;

type ApprovedUser = {
  wallet: string;
  verifiedAtBlock: number;
};

let cache: { expiresAt: number; users: ApprovedUser[] } | null = null;
let pendingScan: Promise<ApprovedUser[]> | null = null;

async function scanApprovedUsers(): Promise<ApprovedUser[]> {
  const url = archiveRpcUrl();
  if (!url) throw new Error('BSC_RPC_URL or ANKR_API_KEY is not configured.');

  const provider = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
  const latest = await provider.getBlockNumber();
  const verifiedLogs = await scanTopic(provider, KYC_VERIFIED_TOPIC, latest);

  // Logs come back ascending, so the last event for a wallet is its current
  // status. A wallet that was verified and then unverified is not approved.
  const latestByWallet = new Map<string, { verified: boolean; block: number }>();
  for (const log of verifiedLogs) {
    const wallet = walletFromTopic(log.topics?.[1]);
    if (!wallet || !log.data) continue;
    latestByWallet.set(wallet.toLowerCase(), {
      verified: BigInt(log.data) !== 0n,
      block: asBlockNumber(log.blockNumber),
    });
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
