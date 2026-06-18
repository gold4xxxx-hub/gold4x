'use client';

import { ReactNode, useEffect } from 'react';
import { WagmiProvider, useAccount, useConnect } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { web3Config } from '@/config/web3Config';
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

function SafePalReconnect() {
  const { isConnecting, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      typeof (window as any).ethereum !== 'undefined' &&
      (window as any).ethereum &&
      !isConnected &&
      !isConnecting
    ) {
      try {
        const injected = connectors.find(
          (connector) => connector.id === 'injected'
        );

        if (injected) {
          connect({ connector: injected });
        }
      } catch (e) {
        console.warn('Auto-reconnect skipped:', e);
      }
    }
  }, [connect, connectors, isConnected, isConnecting]);

  return null;
}

export function Web3Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={web3Config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#C6A86B',
            accentColorForeground: '#1a1408',
            borderRadius: 'large',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          <SafePalReconnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}