'use client';

import { Component, ErrorInfo, ReactNode, useState, lazy, Suspense } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

const DashboardShell = lazy(() => import('./DashboardShell'));

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    console.error('DashboardErrorBoundary caught:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fx-shell">
          <main className="max-w-6xl mx-auto" style={{ paddingTop: '40px' }}>
            <div className="fx-card p-6 sm:p-12 text-center" style={{ maxWidth: 520, margin: '60px auto' }}>
              <h2 className="fx-section-title text-xl mb-3" style={{ color: '#ff7777' }}>Could not load dashboard</h2>
              <p className="fx-lead text-sm mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
                The dashboard modules failed to initialize on this device. Try using a different browser or app.
              </p>
              <button
                onClick={() => this.setState({ error: null })}
                style={{
                  background: 'linear-gradient(180deg, #E0B84F 0%, #B8902A 100%)',
                  color: '#1a1408',
                  border: 'none',
                  borderRadius: '100px',
                  padding: '12px 28px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Home() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const [connecting, setConnecting] = useState(false);

  // Connected — load the full dashboard
  if (isConnected) {
    return (
      <DashboardErrorBoundary>
        <Suspense fallback={
          <div className="fx-shell" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>Loading dashboard…</div>
          </div>
        }>
          <DashboardShell />
        </Suspense>
      </DashboardErrorBoundary>
    );
  }

  const handleConnect = () => {
    setConnecting(true);
    connect({ connector: injected() }, {
      onSuccess: () => setConnecting(false),
      onError: () => setConnecting(false),
    });
  };

  // Not connected — static Connect Wallet card (NO heavy imports)
  return (
    <div className="fx-shell">
      <main className="max-w-6xl mx-auto" style={{ paddingTop: '40px' }}>
        <div className="fx-card p-6 sm:p-12 text-center" style={{ maxWidth: 520, margin: '60px auto' }}>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6" style={{ background: 'rgba(245,214,110,0.1)', border: '1px solid rgba(245,214,110,0.22)' }}>
            <svg width="28" height="28" fill="none" stroke="#C6A86B" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          </div>
          <h2 className="fx-section-title text-2xl mb-3">Connect Your Wallet</h2>
          <p className="fx-lead text-sm mb-6" style={{ maxWidth: 320, margin: '0 auto 1.5rem' }}>
            Connect to BSC to unlock the JSAVIOR command console.
          </p>
          <div className="flex justify-center">
            <button
              onClick={handleConnect}
              disabled={connecting}
              style={{
                background: 'linear-gradient(180deg, #E0B84F 0%, #B8902A 100%)',
                color: '#1a1408',
                border: 'none',
                borderRadius: '100px',
                padding: '12px 28px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: connecting ? 'not-allowed' : 'pointer',
                opacity: connecting ? 0.6 : 1,
              }}
            >
              {connecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          </div>
          <p className="text-center text-xs mt-5" style={{ color: 'rgba(255,255,255,0.4)' }}>Binance Smart Chain · Mainnet</p>
        </div>
      </main>
    </div>
  );
}
