'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { StatusRibbon } from '@/components/StatusRibbon';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/p2p', label: 'Market' },
  { href: '/kyc', label: 'KYC' },
];

// Local-only. The audit page exposes every trade party, chat message and
// payment screenshot, so the link is compiled out of production builds entirely
// rather than merely hidden. The route itself also refuses to serve unless
// AUDIT_PAGE_ENABLED=1.
const devNavItems =
  process.env.NODE_ENV === 'development' ? [{ href: '/audit', label: 'Audit' }] : [];

export function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="fx-topnav">
      <div className="fx-topnav__inner">
        <div className="fx-topnav__left">
          <Link className="fx-brand" href="/">
            JSAVIOR
          </Link>
          <div className="fx-navlinks">
            {[...navItems, ...devNavItems].map((item) => {
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
        </div>
      )}
    </nav>
  );
}
