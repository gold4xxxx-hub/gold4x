'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { StatusRibbon } from '@/components/StatusRibbon';
import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';

const shortenAddress = (address?: string) => {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/p2p', label: 'Market' },
  { href: '/kyc', label: 'KYC' },
];

export function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    <nav className="fx-topnav">
      <div className="fx-topnav__inner">
        <div className="fx-topnav__left">
          <Link className="fx-brand" href="/">
            JSAVIOR
          </Link>
          <div className="fx-navlinks">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`fx-navlink ${isActive ? 'fx-navlink--active' : ''}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="fx-topnav__actions">
          <div className="fx-topnav__actionbox">
            {mounted ? (
              <WalletConnect />
            ) : (
              <button className="fx-connect-btn" disabled>
                Connect Wallet
              </button>
            )}
            <StatusRibbon />
          </div>
          <button
            className="fx-hamburger"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <span style={{
              transform: menuOpen ? 'rotate(45deg) translate(2px, 3px)' : 'none',
              width: '100%',
            }} />
            <span style={{ opacity: menuOpen ? 0 : 1, width: '75%' }} />
            <span style={{
              transform: menuOpen ? 'rotate(-45deg) translate(2px, -3px)' : 'none',
              width: '88%',
            }} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="fx-mobile-nav">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`fx-navlink ${isActive ? 'fx-navlink--active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="fx-mobile-status">
            <div className="fx-mobile-status__item">
              <span className={`fx-mobile-status__dot ${isConnected ? 'on' : 'off'}`} />
              <span style={{
                fontWeight: 600,
                color: isConnecting
                  ? 'var(--fx-gold-strong)'
                  : isConnected
                    ? 'var(--fx-emerald)'
                    : 'rgba(240,80,80,0.85)'
              }}>
                {statusLabel}
              </span>
            </div>
            <div className="fx-mobile-status__item">
              <span className="fx-mobile-status__label">Network</span>
              <span style={{
                color: isBSC ? 'var(--fx-emerald)' : 'rgba(240,80,80,0.85)',
                fontWeight: 500
              }}>
                {networkLabel}
              </span>
            </div>
            <div className="fx-mobile-status__item">
              <span className="fx-mobile-status__label">Wallet</span>
              <span style={{
                color: isConnected ? 'var(--fx-ink)' : 'var(--fx-ink-subtle)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.02em'
              }}>
                {shortenAddress(address)}
              </span>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
