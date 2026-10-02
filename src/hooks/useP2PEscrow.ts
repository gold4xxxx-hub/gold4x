'use client';

// Reads live P2PEscrow chain state and exposes the write calls the desk needs.
//
// Reads are plain view calls, no signature. Writes require a signer and
// throw until the caller passes one.

import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import {
  P2PESCROW_CONTRACT_ADDRESS,
  P2PESCROW_CONTRACT_ABI,
  USDT_CONTRACT_ADDRESS,
  JSAVIOR_CONTRACT_ADDRESS,
  JSAVIOR_CONTRACT_ABI,
} from '@/config/web3Config';
import {
  pairTypeFor,
  cryptoToWei,
  inrToPaise,
  FIXED_INR_PRICES,
  TradeStatus,
  type P2PToken,
} from '@/config/p2pEscrow';

// Minimal EIP-1193 surface. Typed narrowly so the write helpers stay readable
// without scattering `any` through their signatures.
type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const BSC_RPC = 'https://bsc-rpc.publicnode.com';
const CHAIN_ID = 56;

// How many ads/trades are fetched per poll. Older ids are reachable by page.
const PAGE_SIZE = 25;

export type AdRow = {
  id: number;
  creator: string;
  pairType: number;
  isSellOrder: boolean;
  originalCrypto: string;
  originalQuote: string;
  remainingCrypto: string;
  paymentWindow: number;
  active: boolean;
  /** AdClosed true when a trade consumed the last of the ad. */
  exhausted: boolean;
};

export type TradeRow = {
  id: number;
  adId: number;
  pairType: number;
  isFiat: boolean;
  seller: string;
  buyer: string;
  cryptoToken: string;
  cryptoAmount: string;
  quoteAmount: bigint;
  status: number;
};

/** Pull the most useful message out of an ethers/RPC error. */
function readableError(e: unknown): string | undefined {
  const err = e as {
    shortMessage?: string;
    reason?: string;
    message?: string;
  } | null;
  return err?.shortMessage || err?.reason || err?.message;
}

function readContract(signer?: ethers.Signer) {
  const provider = signer
    ? signer.provider
    : new ethers.JsonRpcProvider(BSC_RPC);
  return new ethers.Contract(
    P2PESCROW_CONTRACT_ADDRESS,
    P2PESCROW_CONTRACT_ABI,
    signer ?? provider,
  );
}

/** Live contract counters + chain config. Polls on an interval. */
export function useEscrowStats(pollMs = 15000) {
  const [stats, setStats] = useState({
    adCounter: 0,
    tradeCounter: 0,
    owner: '',
    minWindow: 0,
    maxWindow: 0,
    defaultWindow: 0,
    jsav: '',
    usdt: '',
    chainActive: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = readContract();
      const [
        adCounter,
        tradeCounter,
        owner,
        minWindow,
        maxWindow,
        defaultWindow,
        pair,
      ] = await Promise.all([
        c.adCounter(),
        c.tradeCounter(),
        c.owner(),
        c.minPaymentWindow(),
        c.maxPaymentWindow(),
        c.defaultPaymentWindow(),
        c.getPair(CHAIN_ID),
      ]);
      setStats({
        adCounter: Number(adCounter),
        tradeCounter: Number(tradeCounter),
        owner,
        minWindow: Number(minWindow),
        maxWindow: Number(maxWindow),
        defaultWindow: Number(defaultWindow),
        jsav: pair[0],
        usdt: pair[1],
        chainActive: pair[2],
      });
      setError(null);
    } catch (e) {
      setError(readableError(e) || 'Failed to read escrow contract');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { stats, loading, error, refresh: load };
}

/** KYC status for the connected wallet. */
export function useKycStatus(address: string | null) {
  const [status, setStatus] = useState<{
    loading: boolean;
    verified: boolean;
    submitted: boolean;
    updatedAt: number;
  }>({ loading: true, verified: false, submitted: false, updatedAt: 0 });

  const load = useCallback(async () => {
    if (!address) {
      setStatus({ loading: false, verified: false, submitted: false, updatedAt: 0 });
      return;
    }
    try {
      const c = readContract();
      const [verified, mine] = await Promise.all([
        c.isVerified(address),
        c.getMyKYC2(),
      ]);
      setStatus({
        loading: false,
        verified: Boolean(verified),
        submitted: Boolean(mine[4]),
        updatedAt: Number(mine[6]),
      });
    } catch {
      setStatus({ loading: false, verified: false, submitted: false, updatedAt: 0 });
    }
  }, [address]);

  useEffect(() => {
    // Deferred so the state update lands outside the effect body, avoiding a
    // cascading render on mount.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return { status, refresh: load };
}

export type KycDraft = {
  bankHolderName: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  aadharFrontHash: string;
  aadharBackHash: string;
  mobile: string;
  email: string;
  pan: string;
};

/**
 * The caller's stored KYC, so an update can be prefilled instead of making the
 * user retype all nine fields. Returns null when nothing is on file.
 */
export async function getStoredKyc(
  address: string,
): Promise<{ draft: KycDraft; verified: boolean; updatedAt: number } | null> {
  const c = readContract();
  // getMyKYC()/getMyKYC2() read msg.sender, so `from` is passed as a call
  // override. No signing and no private key is needed for a view call.
  const [a, b] = await Promise.all([
    c.getMyKYC({ from: address }),
    c.getMyKYC2({ from: address }),
  ]);
  if (!b[4]) return null;

  return {
    draft: {
      bankHolderName: a[0],
      bankAccountNumber: a[1],
      ifscCode: a[2],
      bankName: a[3],
      aadharFrontHash: a[4],
      aadharBackHash: b[0],
      mobile: b[1],
      email: b[2],
      pan: b[3],
    },
    verified: Boolean(b[5]),
    updatedAt: Number(b[6]),
  };
}

/** Fetch all active ads, newest first. */
export function useAds(adCounter: number, chainActive: boolean) {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!chainActive || adCounter === 0) {
      setAds([]);
      return;
    }
    setLoading(true);
    try {
      const c = readContract();

      // Only the newest PAGE_SIZE ids are fetched. Reading every id on a large
      // book means one RPC call per ad on every poll, which public nodes will
      // rate-limit.
      const first = Math.max(1, adCounter - PAGE_SIZE + 1);
      const ids = Array.from({ length: adCounter - first + 1 }, (_, i) => adCounter - i);

      // Batched so a large page does not fan out into concurrent requests.
      const rows: (AdRow | null)[] = [];
      for (const id of ids) {
        try {
          const a = await c.getAd(id);
          rows.push({
            id: id,
            creator: a[0],
            pairType: Number(a[1]),
            isSellOrder: Boolean(a[2]),
            originalCrypto: ethers.formatUnits(a[3], 18),
            originalQuote: a[4].toString(),
            remainingCrypto: ethers.formatUnits(a[5], 18),
            paymentWindow: Number(a[6]),
            active: Boolean(a[7]),
            // remainingCrypto reaching 0 deactivates the ad; distinguish that
            // from an explicit cancelAd.
            exhausted: Boolean(a[7]) === false && a[5] === 0n,
          } as AdRow);
        } catch {
          rows.push(null);
        }
      }

      // getAd() returns zero values for ids that were never created rather than
      // reverting, so ghost rows must be filtered out here.
      setAds(
        (rows.filter(Boolean) as AdRow[]).filter(
          (r) => r.creator !== '0x0000000000000000000000000000000000000000',
        ),
      );
    } catch {
      setAds([]);
    } finally {
      setLoading(false);
    }
  }, [adCounter, chainActive]);

  useEffect(() => {
    load();
  }, [load]);

  return { ads, loading, refresh: load, hasMore: adCounter > PAGE_SIZE };
}

/** Fetch recent trades, newest first. */
export function useTrades(tradeCounter: number, chainActive: boolean) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!chainActive || tradeCounter === 0) {
      setTrades([]);
      return;
    }
    setLoading(true);
    try {
      const c = readContract();
      const first = Math.max(1, tradeCounter - PAGE_SIZE + 1);
      const ids = Array.from({ length: tradeCounter - first + 1 }, (_, i) => tradeCounter - i);

      const rows: (TradeRow | null)[] = [];
      for (const id of ids) {
        try {
          const t = await c.getTrade(id);
          rows.push({
            id: id,
            adId: Number(t[0]),
            pairType: Number(t[1]),
            isFiat: Boolean(t[2]),
            seller: t[3],
            buyer: t[4],
            cryptoToken: t[5],
            cryptoAmount: ethers.formatUnits(t[6], 18),
            quoteAmount: t[7] as bigint,
            status: Number(t[8]),
          } as TradeRow);
        } catch {
          rows.push(null);
        }
      }

      // Same as ads: getTrade() yields zero values for unknown ids, and status 0
      // is TradeStatus.NONE, which no real trade can hold.
      setTrades(
        (rows.filter(Boolean) as TradeRow[]).filter(
          (r) => r.status !== TradeStatus.NONE,
        ),
      );
    } catch {
      setTrades([]);
    } finally {
      setLoading(false);
    }
  }, [tradeCounter, chainActive]);

  useEffect(() => {
    load();
  }, [load]);

  return { trades, loading, refresh: load, hasMore: tradeCounter > PAGE_SIZE };
}

/** Submit a KYC application, or update it if one already exists. */
export async function submitKyc(
  signer: ethers.Signer,
  data: {
    bankHolderName: string;
    bankAccountNumber: string;
    ifscCode: string;
    bankName: string;
    aadharFrontHash: string;
    aadharBackHash: string;
    mobile: string;
    email: string;
    pan: string;
  },
  alreadySubmitted: boolean,
) {
  const c = readContract(signer);
  const fn = alreadySubmitted ? 'updateKYC' : 'submitKYC';
  return (await c[fn](data)).wait();
}

/** Post an ad. For a sell order the crypto is escrowed immediately. */
export async function createAd(
  signer: ethers.Signer,
  token: P2PToken,
  isSellOrder: boolean,
  amount: string,
  paymentWindowSeconds: number,
) {
  const c = readContract(signer);
  const pairType = pairTypeFor(token);
  const cryptoAmount = cryptoToWei(amount);
  const quoteAmount = inrToPaise(Number(amount) * FIXED_INR_PRICES[token]);

  // Sell order on an INR pair: the contract pulls the crypto up front.
  if (isSellOrder) {
    await approveToken(signer, token, P2PESCROW_CONTRACT_ADDRESS, cryptoAmount);
  }

  return (
    await c.createAd(pairType, isSellOrder, cryptoAmount, quoteAmount, paymentWindowSeconds)
  ).wait();
}

/** Take an ad, creating a trade and locking the payer's side. */
export async function startTrade(
  signer: ethers.Signer,
  token: P2PToken,
  ad: AdRow,
  cryptoAmount: string,
) {
  const c = readContract(signer);
  const amount = cryptoToWei(cryptoAmount);

  // On an INR pair the crypto side is always escrowed by whichever party
  // provides crypto: the ad creator if it is a buy ad, the taker if sell.
  if (!ad.isSellOrder) {
    await approveToken(signer, token, P2PESCROW_CONTRACT_ADDRESS, amount);
  }

  return (await c.startTrade(ad.id, amount)).wait();
}

/**
 * Ensure the escrow contract may pull `amount`, approving only the shortfall.
 * Skips the transaction entirely when the existing allowance covers it, which
 * avoids paying gas twice on every partial fill of the same ad.
 */
async function approveToken(
  signer: ethers.Signer,
  token: P2PToken,
  spender: string,
  amount: bigint,
) {
  const address = token === 'JSAV' ? JSAVIOR_CONTRACT_ADDRESS : USDT_CONTRACT_ADDRESS;
  // JSAVIOR_ABI covers approve/allowance; USDT on BSC is a standard ERC20.
  const abi =
    token === 'JSAV'
      ? JSAVIOR_CONTRACT_ABI
      : [
          'function approve(address,uint256) returns (bool)',
          'function allowance(address,address) view returns (uint256)',
        ];
  const t = new ethers.Contract(address, abi, signer);
  const owner = await signer.getAddress();
  const current = (await t.allowance(owner, spender)) as bigint;

  if (current >= amount) return null;

  // Some tokens require resetting a non-zero allowance to change it.
  if (current > 0n && current !== ethers.MaxUint256) {
    await (await t.approve(spender, 0)).wait();
  }
  return (await t.approve(spender, amount)).wait();
}

/**
 * Seller's bank details for an active INR trade. Party-gated on-chain: the
 * contract reverts unless the caller is the seller or the buyer.
 */
export async function getTradeBankDetails(
  signer: ethers.Signer,
  tradeId: number,
): Promise<{
  bankHolderName: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
} | null> {
  const c = readContract(signer);
  try {
    const d = await c.getTradeBankDetails(tradeId);
    return {
      bankHolderName: d[0],
      bankAccountNumber: d[1],
      ifscCode: d[2],
      bankName: d[3],
    };
  } catch {
    // Not an INR trade, or the caller is not a party.
    return null;
  }
}

/** Buyer marks INR sent, attaching an IPFS screenshot hash. */
export async function markFiatPaid(
  signer: ethers.Signer,
  tradeId: number,
  screenshotHash: string,
) {
  const c = readContract(signer);
  return (await c.markFiatPaid(tradeId, screenshotHash)).wait();
}

/** Seller confirms INR received; contract releases crypto to the buyer. */
export async function confirmFiatReceived(signer: ethers.Signer, tradeId: number) {
  const c = readContract(signer);
  return (await c.confirmFiatReceived(tradeId)).wait();
}

/** Crypto-to-crypto mutual confirmation. Not used by the INR desk. */
export async function confirmTrade(signer: ethers.Signer, tradeId: number) {
  const c = readContract(signer);
  return (await c.confirmTrade(tradeId)).wait();
}

export async function cancelAd(signer: ethers.Signer, adId: number) {
  const c = readContract(signer);
  return (await c.cancelAd(adId)).wait();
}

/** Refund after the INR window lapses. Any trade party may call. */
export async function cancelExpiredFiatTrade(signer: ethers.Signer, tradeId: number) {
  const c = readContract(signer);
  return (await c.cancelExpiredFiatTrade(tradeId)).wait();
}

/** Trade-party chat, stored on-chain as events. */
export async function sendMessage(signer: ethers.Signer, tradeId: number, message: string) {
  const c = readContract(signer);
  return (await c.sendMessage(tradeId, message)).wait();
}
