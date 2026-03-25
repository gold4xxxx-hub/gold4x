import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc } from 'viem/chains';
import jsaviorAbi from './jsaviorAbi.json';

export const web3Config = getDefaultConfig({
  appName: 'JSAVIOR',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WALLETCONNECT_PROJECT_ID',
  chains: [bsc],
  ssr: true,
});

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

export const JSAVIOR_CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
export const JSAVIOR_CONTRACT_ABI = jsaviorAbi;

// Backward-compatible aliases used by existing components.
export const GOLD4X_CONTRACT_ADDRESS = '0x54bc3ae174550098da0756ea2d7b8855bd3c65cf';
export const GOLD4X_CONTRACT_ABI = JSAVIOR_CONTRACT_ABI;
export const USDT_CONTRACT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
export const USDT_CONTRACT_ABI = JSAVIOR_CONTRACT_ABI;

// Escrow is intentionally disabled until a valid contract address is provided.
export const JMFEscrow_CONTRACT_ADDRESS = '';
export const JMFEscrow_CONTRACT_ABI: any[] = [];

export const SAMPLE_CONTRACT_ABI = JSAVIOR_CONTRACT_ABI;