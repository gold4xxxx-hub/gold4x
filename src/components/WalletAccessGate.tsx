'use client';

import { ReactNode } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { isRestrictedWallet } from '@/lib/transactionRestrictions';

export function WalletAccessGate({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();

  if (!isRestrictedWallet(address)) return children;

  return (
    <div className="fx-shell">
      <main className="max-w-6xl mx-auto" style={{ paddingTop: '40px' }}>
        <section
          className="fx-card fx-card--gold p-6 sm:p-12 text-center"
          style={{ maxWidth: 520, margin: '60px auto' }}
          role="alert"
        >
          <h1 className="fx-section-title text-2xl mb-3">Access Restricted</h1>
          <p className="fx-lead text-sm mb-6">
            This wallet is not permitted to access the application.
          </p>
          <button
            className="fx-button--gold"
            onClick={() => disconnect()}
          >
            Disconnect Wallet
          </button>
        </section>
      </main>
    </div>
  );
}
