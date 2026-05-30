'use client';

import { useAccount, useBalance, useChainId } from 'wagmi';

/**
 * Hook for accessing current wallet connection status and account info
 */
export const useWalletConnection = () => {
  const { address, isConnected, isConnecting } = useAccount();
  const { data: balanceData } = useBalance({
    address: address,
  });

  return {
    address,
    isConnected,
    isConnecting,
    balance: balanceData,
  };
};

/**
 * Hook for BSC network validation
 */
export const useBSCNetwork = () => {
  const chainId = useChainId();
  const isBSC = chainId === 56;

  return {
    isBSC,
    currentChainId: chainId,
  };
};

/**
 * Hook for wallet balance formatting
 */
export const useFormattedBalance = (balance?: number) => {
  if (!balance) return '0.00';

  if (balance >= 1000000) {
    return (balance / 1000000).toFixed(2) + 'M';
  } else if (balance >= 1000) {
    return (balance / 1000).toFixed(2) + 'K';
  }

  return balance.toFixed(2);
};
