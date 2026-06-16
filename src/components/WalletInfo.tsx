'use client';

import { useState } from 'react';
import { useWalletConnection, useFormattedBalance } from '@/hooks/useWalletConnection';


export function WalletInfo() {
  const { address, isConnected, balance } = useWalletConnection();
  const [copied, setCopied] = useState(false);

  const balanceValue = balance?.value ? parseFloat((balance as any)?.formatted ?? '0') : 0;
  const formattedBalance = useFormattedBalance(balanceValue);

  if (!isConnected || !address) {
    return (
      <div className="wallet-card">
        <p className="text-sm" style={{ color: '#6b7280' }}>Connect wallet to view balance.</p>
      </div>
    );
  }

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  function truncateAddress(addr: string) {
    return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
  }

  return (
    <div className="wallet-card">
      <h3 className="wallet-title">Wallet Info</h3>

      <div className="space-y-4">
        <div>
          <span className="wallet-label">Address</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <p className="wallet-address-box">
              {truncateAddress(address)}
            </p>
            <button
              onClick={handleCopy}
              className="fx-copy-btn"
              title="Copy address"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div>
          <span className="wallet-label">Balance</span>
          <p className="wallet-balance">
            {formattedBalance} {balance?.symbol || 'BNB'}
          </p>
        </div>

        <div className="wallet-status">
          Wallet connected and ready.
        </div>
      </div>
    </div>
  );
}
