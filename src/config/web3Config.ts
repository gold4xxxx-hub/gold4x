// Contract constants - safe for server and client
import jsaviorAbi from './jsaviorAbi.json';
import p2pEscrowAbi from './p2pEscrowAbi.json';

export const JSAVIOR_CONTRACT_ADDRESS =
  '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
export const JSAVIOR_CONTRACT_ABI = jsaviorAbi;

if (!/^0x[a-fA-F0-9]{40}$/.test(JSAVIOR_CONTRACT_ADDRESS)) {
  throw new Error(`Invalid contract address: ${JSAVIOR_CONTRACT_ADDRESS}`);
}

export const GOLD4X_CONTRACT_ADDRESS =
  '0x54bc3ae174550098da0756ea2d7b8855bd3c65cf';
export const GOLD4X_CONTRACT_ABI = JSAVIOR_CONTRACT_ABI;

export const USDT_CONTRACT_ADDRESS =
  '0x55d398326f99059ff775485246999027b3197955';
export const USDT_CONTRACT_ABI = JSAVIOR_CONTRACT_ABI;

// Contract owner of P2PEscrow. Controls KYC approval (verifyKYC), the
// payment windows, chain enable/disable, and can drain the escrow via
// rescueToken. Used to gate owner-only UI affordances; the contract remains
// the authority, so hiding a button is presentation only.
export const P2PESCROW_OWNER_ADDRESS =
  '0xb32fccf4723fc19b8a097006f59437c15e88bbce';

/** True when `address` is the P2PEscrow owner. */
export function isP2pEscrowOwner(address?: string | null): boolean {
  if (!address) return false;
  return address.toLowerCase() === P2PESCROW_OWNER_ADDRESS.toLowerCase();
}

// P2P escrow - verified on BSC (P2PEscrow, solidity 0.8.34)
export const P2PESCROW_CONTRACT_ADDRESS =
  '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
export const P2PESCROW_CONTRACT_ABI = p2pEscrowAbi;

if (!/^0x[a-fA-F0-9]{40}$/.test(P2PESCROW_CONTRACT_ADDRESS)) {
  throw new Error(
    `Invalid contract address: ${P2PESCROW_CONTRACT_ADDRESS}`
  );
}

// @deprecated Kept for older imports. The deployed contract exposes
// createAd/startTrade/confirmTrade, NOT createEscrow/fundEscrow/release/refund.
export const JMFEscrow_CONTRACT_ADDRESS = P2PESCROW_CONTRACT_ADDRESS;
export const JMFEscrow_CONTRACT_ABI = p2pEscrowAbi;

export const SAMPLE_CONTRACT_ABI = JSAVIOR_CONTRACT_ABI;

// RainbowKit config
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc } from 'viem/chains';
import { cookieStorage, createStorage } from 'wagmi';

// WalletConnect Cloud project id. Mobile wallets (SafePal on Android, for
// example) reach the dApp through the WalletConnect relay, and that relay is
// keyed off this id. Without a real one the placeholder below is rejected by
// the network, so only browser extensions can connect — which is why the
// desktop worked and phones did not.
//
// Get a free id at cloud.walletconnect.com and set
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env.local (and in Vercel under
// Settings > Environment Variables, for every environment).
const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || '';

export const web3Config = getDefaultConfig({
  appName: 'JSAVIOR',
  projectId: WALLETCONNECT_PROJECT_ID || 'placeholder-project-id-not-configured',
  chains: [bsc],
  ssr: true,
  multiInjectedProviderDiscovery: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

// Surfaced so the UI can explain a mobile connection failure instead of the
// button silently doing nothing. Checked by the connect panels.
export const isWalletConnectConfigured = WALLETCONNECT_PROJECT_ID.length > 0;

export const BSC_CONFIG = {
  chainId: 56,
  chainName: 'Binance Smart Chain',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  rpcUrls: {
    public: 'https://bsc-dataseed.binance.org/',
    default: 'https://bsc-dataseed.binance.org/',
  },
  blockExplorers: {
    default: {
      name: 'BscScan',
      url: 'https://bscscan.com',
    },
  },
};