'use client';

// Shared wagmi -> ethers signer bridge.
//
// Both the P2P desk and the KYC pages need an ethers.Signer, and both had the
// same hand-rolled derivation. Centralised here so the two paths cannot drift
// apart again — which is what caused the P2P page to miss SafePal connections
// in the first place.

import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useConnection, useConnectorClient } from 'wagmi';

/** Pull the raw EIP-1193 provider out of a viem client. */
function eip1193FromClient(client: unknown): { request: (...a: never[]) => unknown } | null {
  if (!client) return null;
  const c = client as {
    transport?: { request?: unknown };
    provider?: { request?: unknown };
  };
  const t = c.transport;
  if (t && typeof t.request === 'function') {
    return t as { request: (...a: never[]) => unknown };
  }
  const p = c.provider;
  if (p && typeof p.request === 'function') {
    return p as { request: (...a: never[]) => unknown };
  }
  return null;
}

export function useEthersSigner(): {
  address: string | null;
  isConnected: boolean;
  signer: ethers.Signer | null;
  chainId: number | null;
  loading: boolean;
} {
  const { address, isConnected } = useConnection();
  const { data: client } = useConnectorClient();

  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [loading, setLoading] = useState(false);

  const eip1193 = eip1193FromClient(client);

  useEffect(() => {
    if (!eip1193) return;
    let cancelled = false;
    // Loading flips asynchronously via the promise chain below, so the state
    // update does not land in the effect body itself.
    void new ethers.BrowserProvider(eip1193 as never)
      .getSigner()
      .then((s) => {
        if (!cancelled) {
          setSigner(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSigner(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eip1193]);

  const chainId = (client?.chain?.id as number | undefined) ?? null;

  return {
    address: address ?? null,
    isConnected,
    signer,
    chainId,
    loading,
  };
}
