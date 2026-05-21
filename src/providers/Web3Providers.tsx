'use client';

import { ReactNode, useEffect } from 'react';
import { WagmiProvider, useConnect } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { web3Config } from '@/config/web3Config';
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

function SafePalAutoReconnect() {
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const injectedConnector = connectors.find(
        (connector) => connector.id === 'injected'
      );

      if (injectedConnector) {
        connect({ connector: injectedConnector });
      }
    }
  }, [connect, connectors]);

  return null;
}

export function Web3Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={web3Config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#f5d66e',
            accentColorForeground: '#1a1408',
            borderRadius: 'large',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          <SafePalAutoReconnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}