'use client';

import { useWalletConnection, useFormattedBalance } from '@/hooks/useWalletConnection';
import { formatEther } from 'ethers';

export function WalletInfo() {
  const { address, isConnected, balance } = useWalletConnection();

  if (!isConnected || !address) {
    return (
      <div className="gold-panel p-5">
        <p className="text-sm" style={{ color: 'var(--fx-ink-muted)' }}>Connect wallet to view balance.</p>
      </div>
    );
  }

  const balanceValue = balance?.value ? parseFloat(formatEther(balance.value)) : 0;
  const formattedBalance = useFormattedBalance(balanceValue);

  return (
    <div className="gold-panel p-5">
      <h3 className="fx-section-title text-base mb-4" style={{ color: 'var(--fx-ink)' }}>Wallet</h3>

      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--fx-ink-subtle)' }}>Address</label>
          <p className="font-mono text-sm" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)', padding: '0.5rem', borderRadius: '6px', color: 'var(--fx-ink-muted)', wordBreak: 'break-all' }}>
            {address}
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--fx-ink-subtle)' }}>Balance</label>
          <p className="text-xl" style={{ color: 'var(--fx-ink)' }}>
            {formattedBalance} {balance?.symbol || 'BNB'}
          </p>
        </div>

        <div className="fx-alert fx-alert--success text-sm">
          <p>Wallet connected and ready.</p>
        </div>
      </div>
    </div>
  );
}
