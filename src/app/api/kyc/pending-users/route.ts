import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  archiveRpcUrl,
  asBlockNumber,
  scanTopic,
  walletFromTopic,
  KYC_SUBMITTED_TOPIC,
  KYC_VERIFIED_TOPIC,
} from '@/lib/kycLogScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30_000;

type PendingUser = {
  wallet: string;
  submittedAtBlock: number;
};

let cache: { expiresAt: number; users: PendingUser[] } | null = null;
let pendingScan: Promise<PendingUser[]> | null = null;

async function scanPendingUsers(): Promise<PendingUser[]> {
  const url = archiveRpcUrl();
  if (!url) throw new Error('BSC_RPC_URL or ANKR_API_KEY is not configured.');

  const provider = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
  const latest = await provider.getBlockNumber();
  const submittedLogs = await scanTopic(provider, KYC_SUBMITTED_TOPIC, latest);
  const verifiedLogs = await scanTopic(provider, KYC_VERIFIED_TOPIC, latest);

  const submitted = new Map<string, number>();
  for (const log of submittedLogs) {
    const wallet = walletFromTopic(log.topics?.[1]);
    if (!wallet) continue;
    submitted.set(wallet, asBlockNumber(log.blockNumber));
  }

  // Logs are ascending, so the last event per wallet is its current status.
  const verified = new Map<string, boolean>();
  for (const log of verifiedLogs) {
    const wallet = walletFromTopic(log.topics?.[1]);
    if (!wallet || !log.data) continue;
    verified.set(wallet, BigInt(log.data) !== 0n);
  }

  return [...submitted.entries()]
    .filter(([wallet]) => verified.get(wallet) !== true)
    .map(([wallet, submittedAtBlock]) => ({ wallet, submittedAtBlock }))
    .sort((a, b) => b.submittedAtBlock - a.submittedAtBlock);
}

async function getPendingUsers(): Promise<PendingUser[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.users;
  if (pendingScan) return pendingScan;

  pendingScan = scanPendingUsers();
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
    const users = await getPendingUsers();
    return NextResponse.json(
      { users, updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load pending users.';
    const status = message.includes('not configured') ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
