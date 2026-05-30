'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';

export function WalletConnect() {
  const { isConnected, address } = useWalletConnection();
  const { isBSC } = useBSCNetwork();

  return (
    <div className="flex items-center gap-4">
      <div className="gold-connect-wrapper rounded-md" style={{
        filter: 'drop-shadow(0 4px 12px rgba(245, 214, 110, 0.2))',
        transition: 'filter 0.2s ease'
      }}>
        <ConnectButton />
      </div>
      {isConnected && !isBSC && (
        <div className="fx-alert fx-alert--warn text-sm">
          ⚠️ Please switch to BSC network
        </div>
      )}
    </div>
  );
}
