'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';

export function WalletConnect() {
  const { isConnected, address } = useWalletConnection();
  const { isBSC } = useBSCNetwork();

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
      <div className="gold-connect-wrapper rounded-md" style={{
        filter: 'drop-shadow(0 4px 12px rgba(245, 214, 110, 0.2))',
        transition: 'filter 0.2s ease'
      }}>
        <ConnectButton />
      </div>
      {isConnected && !isBSC && (
        <div className="fx-alert fx-alert--warn text-xs py-1.5 px-3 break-all whitespace-normal max-w-[200px] sm:max-w-none">
          ⚠️ Switch to BSC
        </div>
      )}
    </div>
  );
}
