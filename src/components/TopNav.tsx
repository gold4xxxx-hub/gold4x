'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { WalletConnect } from '@/components/WalletConnect';
import { StatusRibbon } from '@/components/StatusRibbon';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/p2p', label: 'Market' },
  { href: '/kyc', label: 'KYC' },
];

export function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isConnected } = useAccount();

  // The Audit link appears only once a wallet is connected.
  //
  // It used to be compiled out of production entirely, which was right when the
  // page was local-only. It is wrong now for two reasons. It made the page
  // undiscoverable for the one person meant to use it, and the mobile menu
  // rendered only `navItems`, so even in development the link never appeared on
  // a phone at all.
  //
  // Hiding it from signed-out visitors is presentation, not security: anyone can
  // still type /audit. The gate on /api/audit is what actually decides, and it
  // checks a wallet signature server side.
  const items = isConnected
    ? [...navItems, { href: '/audit', label: 'Audit' }]
    : navItems;

  const renderLink = (item: { href: string; label: string }) => {
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
  };

  return (
    <nav className="fx-topnav">
      <div className="fx-topnav__inner">
        <div className="fx-topnav__left">
          <Link className="fx-brand" href="/">
            JSAVIOR
          </Link>
          <div className="fx-navlinks">{items.map(renderLink)}</div>
        </div>
        <div className="fx-topnav__actions">
          <div className="fx-topnav__actionbox">
            <WalletConnect />
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
        <div className="fx-mobile-nav">{items.map(renderLink)}</div>
      )}
    </nav>
  );
}
