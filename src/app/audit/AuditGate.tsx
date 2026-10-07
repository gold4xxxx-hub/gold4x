'use client';

// Wallet-signature unlock for the audit page.
//
// The gate lives here rather than in the page because the page itself must be
// inert until the server has issued a token. Anything the page renders before
// that would be a page anyone can load.
//
// The signature is produced with personal_sign. That prompts the wallet, which
// shows the exact text being signed - so the user can read it and refuse if it
// is not ours. It is read-only and cannot move funds.

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

import { useEthersSigner } from '@/hooks/useEthersSigner';
import { buildAuditMessageLocal } from './gateMessage';

const DOMAIN = 'gold4x.in';
const PURPOSE = 'P2P escrow audit access';

type State = 'locked' | 'signing' | 'unlocked' | 'denied';

export function useAuditToken() {
  // Restored during the initial render rather than in an effect: reading
  // sessionStorage in an effect and then setting state caused a second render
  // pass and a visible flash of the locked screen for someone already signed in.
  // The server is still the authority - a stale token there gets a 401 and the
  // gate comes back. This only avoids the flicker.
  const [token, setToken] = useState<string | null>(() => {
    try {
      const saved = sessionStorage.getItem('gold4x.audit.token');
      const exp = Number(sessionStorage.getItem('gold4x.audit.exp') ?? '0');
      if (saved && Date.now() < exp) return saved;
      sessionStorage.removeItem('gold4x.audit.token');
      return null;
    } catch {
      /* storage can be unavailable in private mode; the gate still works */
      return null;
    }
  });

  const set = useCallback((t: string, ttl: number) => {
    setToken(t);
    try {
      sessionStorage.setItem('gold4x.audit.token', t);
      sessionStorage.setItem('gold4x.audit.exp', String(Date.now() + ttl));
    } catch {
      /* in-memory only for this tab if storage is blocked */
    }
  }, []);

  const clear = useCallback(() => {
    setToken(null);
    try {
      sessionStorage.removeItem('gold4x.audit.token');
      sessionStorage.removeItem('gold4x.audit.exp');
    } catch {
      /* nothing to clean up */
    }
  }, []);

  return { token, setToken: set, clearToken: clear };
}

/**
 * The panel shown until a verified signature exists.
 *
 * Everything is explicit about what is being asked for, because a signature
 * prompt with vague text is indistinguishable from a phishing attempt.
 */
export function AuditGate({
  onUnlocked,
  token,
  setToken,
}: {
  onUnlocked: (token: string) => void;
  token: string | null;
  setToken: (t: string, ttl: number) => void;
}) {
  const { address, isConnected } = useAccount();
  const { signer } = useEthersSigner();
  const [state, setState] = useState<State>('locked');
  const [error, setError] = useState<string | null>(null);
  // Issued by the server. Generating it here would let a captured signature be
  // replayed against the same nonce, so the server keeps track of which nonces
  // it handed out and refuses to accept one twice.
  const [nonce, setNonce] = useState<string | null>(null);

  useEffect(() => {
    if (token) return;
    let cancelled = false;
    fetch('/api/audit', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!cancelled && body?.needsSignature && body.nonce) setNonce(String(body.nonce));
      })
      .catch(() => {
        /* the unlock attempt will surface the real error */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const unlock = useCallback(async () => {
    if (!signer || !address) return;
    if (!nonce) {
      setError('Still preparing. Wait a second and try again.');
      return;
    }
    setState('signing');
    setError(null);
    try {
      // The wallet shows this exact text, so it must be the same string the
      // server reconstructs. Built here rather than imported from the server
      // module, which is not shipped to the browser.
      const message = buildAuditMessageLocal(DOMAIN, PURPOSE, nonce);
      const signature = await signer.signMessage(message);

      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, signature, nonce }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState('denied');
        setError(body?.error ?? `Refused (${res.status}).`);
        return;
      }
      setToken(String(body.token), Number(body.expiresInMs ?? 30 * 60 * 1000));
      setState('unlocked');
      setNonce(null);
      onUnlocked(String(body.token));
    } catch (e) {
      // A user declining the wallet prompt is normal, not an error to shout about.
      const msg = e instanceof Error ? e.message : String(e);
      if (/denied|reject|cancel/i.test(msg)) {
        setState('locked');
        setError('Signature declined, so nothing was opened.');
      } else {
        setState('denied');
        setError(msg.slice(0, 160));
      }
    }
  }, [signer, address, nonce, setToken, onUnlocked]);

  return (
    <div className="agate">
      <div className="agate__box">
        <h2>Audit access</h2>

        {!isConnected && (
          <>
            <p>
              This page lists every trade, order, chat message and KYC record the
              escrow has ever held. Connect the owner wallet to sign in.
            </p>
            <p className="agate__note">
              Reading only. A signature here cannot move funds, cancel a trade or
              change anything on-chain.
            </p>
          </>
        )}

        {isConnected && !address && <p>Waiting for the wallet…</p>}

        {isConnected && address && (
          <>
            <p>
              Connected as <code>{address}</code>.
            </p>
            <div className="agate__sig">
              <div className="agate__sigk">Your wallet will ask you to sign this</div>
              <pre>{buildAuditMessageLocal(DOMAIN, PURPOSE, nonce ?? '…')}</pre>
            </div>
            <button
              type="button"
              className="abtn abtn--gate"
              onClick={() => void unlock()}
              disabled={state === 'signing'}
            >
              {state === 'signing' ? 'Waiting for your wallet…' : 'Sign and open the audit page'}
            </button>
            <p className="agate__note">
              Read your wallet prompt before signing. It must say exactly what is
              shown above.
            </p>
          </>
        )}

        {error && <p className="agate__err">{error}</p>}
      </div>
    </div>
  );
}