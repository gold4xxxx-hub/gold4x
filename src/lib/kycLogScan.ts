import { ethers } from 'ethers';

/**
 * Reading the KYC contract's event history.
 *
 * Both KYC routes used to ask BscScan for the logs. That endpoint has been
 * retired - api.bscscan.com now answers with a redirect to a documentation
 * page, and the replacement Etherscan V2 endpoint does not cover BSC on the
 * free plan. The events are read over the archive RPC instead, the same way
 * the rest of the chain data in this project is read.
 */

export const KYC_CONTRACT_ADDRESS = '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
export const KYC_DEPLOY_BLOCK = 116_000_000;
export const KYC_SUBMITTED_TOPIC = ethers.id('KYCSubmitted(address)');
export const KYC_VERIFIED_TOPIC = ethers.id('KYCVerified(address,bool)');

/** Blocks per eth_getLogs call. */
const WINDOW = 50_000;
/**
 * How many windows are fetched at the same time. The history is thirteen
 * million blocks, which is two hundred and sixty windows, and doing them one
 * after the other takes minutes.
 */
const CONCURRENCY = 8;

export type ScanLog = {
  topics?: readonly string[];
  data?: string;
  blockNumber?: string;
};

/**
 * The archive RPC to read the history with: an explicit URL if one is
 * configured, otherwise the Ankr key.
 */
export function archiveRpcUrl(): string | null {
  const explicit = process.env.BSC_RPC_URL?.trim();
  if (explicit) return explicit;
  const ankr = process.env.ANKR_API_KEY?.trim();
  return ankr ? `https://rpc.ankr.com/bsc/${ankr}` : null;
}

export function asBlockNumber(value: string | undefined): number {
  if (!value) return 0;
  return Number.parseInt(value, value.startsWith('0x') ? 16 : 10) || 0;
}

export function walletFromTopic(topic: string | undefined): string | null {
  if (!topic) return null;
  try {
    return ethers.getAddress(`0x${topic.slice(-40)}`);
  } catch {
    return null;
  }
}

/**
 * Every log for one topic between the deploy block and `latest`, in ascending
 * block order. The windows are fetched a few at a time rather than one after
 * the other, and the result is sorted because a later window can come back
 * before an earlier one.
 */
export async function scanTopic(
  provider: ethers.JsonRpcProvider,
  topic0: string,
  latest: number,
): Promise<ScanLog[]> {
  const windows: { from: number; to: number }[] = [];
  for (let from = KYC_DEPLOY_BLOCK; from <= latest; from += WINDOW) {
    windows.push({ from, to: Math.min(from + WINDOW - 1, latest) });
  }

  const logs: ScanLog[] = [];
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= windows.length) return;
      const { from, to } = windows[index];
      for (let attempt = 0; ; attempt += 1) {
        try {
          const chunk = await provider.getLogs({
            address: KYC_CONTRACT_ADDRESS,
            topics: [topic0],
            fromBlock: from,
            toBlock: to,
          });
          for (const log of chunk) {
            logs.push({ topics: log.topics, data: log.data, blockNumber: String(log.blockNumber) });
          }
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return logs.sort(
    (a, b) => asBlockNumber(a.blockNumber) - asBlockNumber(b.blockNumber),
  );
}
