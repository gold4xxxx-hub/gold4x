import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTRACT_ADDRESS = '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
const DEPLOY_BLOCK = 116_000_000;
const WINDOW = 50_000;
const CACHE_TTL_MS = 30 * 1000;
const KYC_SUBMITTED_TOPIC = ethers.id('KYCSubmitted(address)');
const KYC_VERIFIED_TOPIC = ethers.id('KYCVerified(address,bool)');

type ScanLog = {
  topics?: string[];
  data?: string;
  blockNumber?: string;
};

type PendingUser = {
  wallet: string;
  submittedAtBlock: number;
};

let cache: { expiresAt: number; users: PendingUser[] } | null = null;
let pendingScan: Promise<PendingUser[]> | null = null;

function asBlockNumber(value: string | undefined): number {
  if (!value) return 0;
  return Number.parseInt(value, value.startsWith('0x') ? 16 : 10) || 0;
}

function walletFromTopic(topic: string | undefined): string | null {
  if (!topic) return null;
  try {
    return ethers.getAddress(`0x${topic.slice(-40)}`);
  } catch {
    return null;
  }
}

function archiveRpcUrl(): string | null {
  const explicit = process.env.BSC_RPC_URL?.trim();
  if (explicit) return explicit;
  const ankr = process.env.ANKR_API_KEY?.trim();
  return ankr ? `https://rpc.ankr.com/bsc/${ankr}` : null;
}

async function scanTopic(
  provider: ethers.JsonRpcProvider,
  topic0: string,
  latest: number,
): Promise<ScanLog[]> {
  const logs: ScanLog[] = [];
  for (let from = DEPLOY_BLOCK; from <= latest; from += WINDOW) {
    const to = Math.min(from + WINDOW - 1, latest);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const chunk = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          topics: [topic0],
          fromBlock: from,
          toBlock: to,
        });
        for (const log of chunk) {
          logs.push({ topics: [...log.topics], data: log.data, blockNumber: String(log.blockNumber) });
        }
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  return logs;
}

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
