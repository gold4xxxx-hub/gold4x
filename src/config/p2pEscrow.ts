// P2P escrow domain types, fixed rates, and amount conversion helpers.
//
// Contract: P2PEscrow (verified) 0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0 on BSC.
// Only JSAV and USDT are tradable against INR. G4X is intentionally not supported:
// the deployed contract's chainPairs has no G4X entry, so it cannot be escrowed.

import { ethers } from 'ethers';

// Fixed INR rates, in whole rupees. INR is the only quote asset on the desk.
export const FIXED_INR_PRICES = {
  JSAV: 100,
  USDT: 100,
} as const;

export type P2PToken = keyof typeof FIXED_INR_PRICES;

// Contract enum PairType { JSAV_USDT, JSAV_INR, USDT_INR }
// We only use the two INR pairs. JSAV_USDT is crypto-crypto and out of scope
// for this desk.
export const PairType = {
  JSAV_USDT: 0,
  JSAV_INR: 1,
  USDT_INR: 2,
} as const;

// Contract enum TradeStatus { NONE, OPEN, PAID, COMPLETED, CANCELLED }
export const TradeStatus = {
  NONE: 0,
  OPEN: 1,
  PAID: 2,
  COMPLETED: 3,
  CANCELLED: 4,
} as const;

export const TRADE_STATUS_LABEL: Record<number, string> = {
  0: 'none',
  1: 'open',
  2: 'payment sent',
  3: 'completed',
  4: 'cancelled',
};

export function pairTypeFor(token: P2PToken): number {
  return token === 'JSAV' ? PairType.JSAV_INR : PairType.USDT_INR;
}

export function tokenForPairType(pairType: number): P2PToken {
  return pairType === PairType.JSAV_INR ? 'JSAV' : 'USDT';
}

// ---------------------------------------------------------------------------
// Amount conversion
//
// Two separate unit systems, straight from the contract:
//   crypto  -> token native decimals (JSAV 18, USDT on BSC 18)
//   quote   -> paise, i.e. 2 decimals (10000 = 100.00 INR)
//
// Mixing these up is the most likely source of a 100x bug, so every conversion
// goes through these helpers.
// ---------------------------------------------------------------------------

export function cryptoToWei(amount: number | string): bigint {
  return ethers.parseUnits(String(amount), 18);
}

export function inrToPaise(amountInr: number | string): bigint {
  return ethers.parseUnits(String(amountInr), 2);
}

export function weiToCrypto(wei: bigint | string): string {
  return ethers.formatUnits(BigInt(wei), 18);
}

export function paiseToInr(paise: bigint | string): string {
  return ethers.formatUnits(BigInt(paise), 2);
}

/** Total INR value of `cryptoAmount` of `token` at the fixed rate. */
export function inrValueOf(token: P2PToken, cryptoAmount: number | string): string {
  return (Number(cryptoAmount) * FIXED_INR_PRICES[token]).toFixed(2);
}

/** Contract derives quote proportionally: quote = (crypto * originalQuote) / originalCrypto */
export function quoteForPartial(
  cryptoAmount: bigint,
  originalQuote: bigint,
  originalCrypto: bigint,
): bigint {
  if (originalCrypto === 0n) return 0n;
  return (cryptoAmount * originalQuote) / originalCrypto;
}

/** Human-readable INR amount for a trade, pair-aware. */
export function formatQuote(pairType: number, quoteAmount: bigint): string {
  if (pairType === PairType.JSAV_USDT) return `${ethers.formatUnits(quoteAmount, 18)} USDT`;
  return `₹${paiseToInr(quoteAmount)}`;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address || '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
