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
        <span style={{
          fontSize: '0.72rem',
          fontWeight: 400,
          color: isConnecting 
            ? 'var(--fx-ink-muted)' 
            : isConnected 
              ? 'var(--fx-emerald)' 
              : 'rgba(240,80,80,0.85)'
        }}>
          {statusLabel}
        </span>
      </div>
      <div className="fx-ribbon__item">
        <span className="fx-ribbon__label">Network</span>
        <span style={{ 
          color: isBSC ? 'var(--fx-emerald)' : 'rgba(240,80,80,0.85)',
          fontSize: '0.72rem',
          fontWeight: 400
        }}>
          {networkLabel}
        </span>
      </div>
      <div className="fx-ribbon__item">
        <span className="fx-ribbon__label">Wallet</span>
        <span style={{ 
          color: isConnected ? 'var(--fx-ink-muted)' : 'var(--fx-ink-subtle)',
          fontSize: '0.72rem',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.02em'
        }}>
          {shortenAddress(address)}
        </span>
      </div>
    </div>
  );
}
