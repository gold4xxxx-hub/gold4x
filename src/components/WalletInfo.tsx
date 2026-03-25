'use client';

import { useWalletConnection, useFormattedBalance } from '@/hooks/useWalletConnection';
import { formatEther } from 'ethers';

export function WalletInfo() {
  const { address, isConnected, balance } = useWalletConnection();

  if (!isConnected || !address) {
    return (
      <div className="fx-card p-6">
        <p className="text-sm text-[#b9b0a3]">Connect wallet to view balance.</p>
      </div>
    );
  }

  const balanceValue = balance ? parseFloat(formatEther(balance.value)) : 0;
  const formattedBalance = useFormattedBalance(balanceValue);

  return (
    <div className="fx-card p-6">
      <h3 className="fx-section-title text-lg mb-4">Wallet Info</h3>

      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Address</label>
          <p className="font-mono text-sm bg-[rgba(15,20,34,0.9)] border border-[rgba(255,255,255,0.06)] p-2 rounded break-all">
            {address}
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Balance</label>
          <p className="text-2xl font-bold text-[#f3d68a]">
            {formattedBalance} {balance?.symbol || 'BNB'}
          </p>
        </div>

        <div className="fx-alert fx-alert--success text-sm">
          <p>Your wallet is connected and ready to interact with smart contracts.</p>
        </div>
      </div>
    </div>
  );
}
