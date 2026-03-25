'use client';

import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';

const shortenAddress = (address?: string) => {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export function StatusRibbon() {
  const { address, isConnected, isConnecting } = useWalletConnection();
  const { isBSC, currentChainId } = useBSCNetwork();

  const statusLabel = isConnecting
    ? 'Connecting'
    : isConnected
      ? 'Connected'
      : 'Disconnected';

  const networkLabel = isBSC
    ? 'BSC Mainnet'
    : currentChainId
      ? `Chain ${currentChainId}`
      : 'No network';

  return (
    <div className="fx-ribbon">
      <div className="fx-ribbon__item">
        <span className={`fx-ribbon__dot ${isConnected ? 'fx-ribbon__dot--on' : 'fx-ribbon__dot--off'}`} />
        <span>{statusLabel}</span>
      </div>
      <div className="fx-ribbon__item">
        <span className="fx-ribbon__label">Network</span>
        <span>{networkLabel}</span>
      </div>
      <div className="fx-ribbon__item">
        <span className="fx-ribbon__label">Wallet</span>
        <span>{shortenAddress(address)}</span>
      </div>
    </div>
  );
}
