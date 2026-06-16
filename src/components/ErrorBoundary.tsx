'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="fx-shell" style={{ padding: '2rem', textAlign: 'center' }}>
            <h2 style={{ color: '#fff', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem' }}>
              Try refreshing the page. If the problem persists, use a wallet-enabled browser.
            </p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
