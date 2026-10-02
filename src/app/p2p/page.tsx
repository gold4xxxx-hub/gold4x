'use client';

// P2P trading desk. Reads live P2PEscrow state; all writes go through the
// verified ABI. Pairs supported: JSAV/INR and USDT/INR. G4X is not supported
// by the deployed contract.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { useConnection, useConnectorClient, useConnect, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import './p2p.css';
import {
  P2PESCROW_CONTRACT_ADDRESS,
  BSC_CONFIG,
} from '@/config/web3Config';
import {
  FIXED_INR_PRICES,
  tokenForPairType,
  TRADE_STATUS_LABEL,
  shortAddress,
  paiseToInr,
  inrValueOf,
  TradeStatus,
  type P2PToken,
} from '@/config/p2pEscrow';
import {
  useEscrowStats,
  useKycStatus,
  useAds,
  useTrades,
  createAd,
  startTrade,
  markFiatPaid,
  confirmFiatReceived,
  cancelAd,
  cancelExpiredFiatTrade,
  sendMessage,
  getTradeBankDetails,
  type AdRow,
  type TradeRow,
} from '@/hooks/useP2PEscrow';
import { getTradeChat, getTradeEventState, type ChatEntry } from '@/lib/p2pLogs';

/** Seconds remaining until `deadline`, floored at 0. */
function secondsLeft(deadline: number, now: number): number {
  if (!deadline) return 0;
  return Math.max(0, deadline - now);
}

function formatCountdown(deadline: number, now: number): string | null {
  if (!deadline) return null;
  const left = secondsLeft(deadline, now);
  if (left === 0) return 'window expired';
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Chip class for a trade status, so the list reads at a glance. */
function tradeChipClass(status: number): string {
  switch (status) {
    case TradeStatus.OPEN:
      return 'p2p-chip p2p-chip--open';
    case TradeStatus.PAID:
      return 'p2p-chip p2p-chip--paid';
    case TradeStatus.COMPLETED:
      return 'p2p-chip p2p-chip--done';
    case TradeStatus.CANCELLED:
      return 'p2p-chip p2p-chip--dead';
    default:
      return 'p2p-chip p2p-chip--muted';
  }
}

const TOKENS: P2PToken[] = ['JSAV', 'USDT'];

/**
 * Minimal async-resource hook: runs `fn`, tracks loading and error, discards
 * results from superseded runs. Kept local rather than pulling in a data
 * library for one call site.
 */
function useResource<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: Error | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: Error | null }>({
    data: null,
    error: null,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn().then(
      (value) => {
        if (cancelled) return;
        setState({ data: value, error: null });
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setState({ data: null, error: e instanceof Error ? e : new Error(String(e)) });
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, loading };
}

/**
 * Wallet state sourced from wagmi, not from a hand-rolled window.ethereum
 * probe. The rest of the app connects through the RainbowKit/wagmi provider
 * (including the SafePal auto-reconnect in Web3Providers), so a local probe
 * misses connections made that way and the page wrongly reports "not
 * connected" even though the wallet is.
 *
 * The signer is derived from the same connector client wagmi already tracks,
 * so a connection made anywhere in the app is visible here.
 */
function useSigner() {
  const { address, isConnected, connector } = useConnection();
  const { data: client } = useConnectorClient({ connector });
  const { switchChain, isPending: switching } = useSwitchChain();
  const { isPending: connecting } = useConnect();

  // Derive the EIP-1193 provider from the connector client. viem clients expose
  // it as `transport`, which is the actual request-capable object for an
  // injected wallet; some builds expose it as `provider` instead.
  const eip1193 = useMemo(() => {
    if (!client) return null;
    const c = client as unknown as { transport?: unknown; provider?: unknown };
    const t = c.transport as { request?: unknown } | undefined;
    if (t && typeof t.request === 'function') return t;
    const pv = c.provider as { request?: unknown } | undefined;
    if (pv && typeof pv.request === 'function') return pv;
    return null;
  }, [client]);

  // The ethers signer is built asynchronously because getSigner() is async.
  // Derived via a resource-like pattern so no setState happens synchronously
  // inside the effect body.
  const signerResource = useResource<ethers.Signer | null>(
    async () => {
      if (!eip1193) return null;
      return new ethers.BrowserProvider(eip1193 as never).getSigner();
    },
    [eip1193],
  );

  const ethersSigner = signerResource.data ?? null;

  const account = address ?? null;

  // BSC only. If the wallet is on another chain, switching needs a user
  // gesture, so it is triggered from the button rather than on mount.
  const wrongChain = isConnected && client && client.chain?.id !== BSC_CONFIG.chainId;

  // The page renders RainbowKit's ConnectButton rather than calling wagmi's
  // connect() with a hand-picked connector, which silently did nothing when no
  // injected connector was present.
  const ensureBsc = async () => {
    if (!wrongChain) return true;
    try {
      await switchChain({ chainId: BSC_CONFIG.chainId });
      return true;
    } catch {
      return false;
    }
  };

  return {
    account,
    signer: ethersSigner,
    busy: connecting || switching,
    isConnected,
    wrongChain: Boolean(wrongChain),
    ensureBsc,
  };
}

const P2PPage: React.FC = () => {
  const {
    account,
    signer,
    busy: connecting,
    wrongChain,
    ensureBsc,
  } = useSigner();
  const { stats, loading: statsLoading, error: statsError, refresh } = useEscrowStats();
  const { status: kyc, refresh: refreshKyc } = useKycStatus(account);
  const { ads, loading: adsLoading } = useAds(stats.adCounter, stats.chainActive);
  const { trades, loading: tradesLoading } = useTrades(stats.tradeCounter, stats.chainActive);

  const [form, setForm] = useState({ token: 'JSAV' as P2PToken, type: 'sell' as 'buy' | 'sell', amount: '' });
  const [activeAd, setActiveAd] = useState<AdRow | null>(null);
  const [activeTrade, setActiveTrade] = useState<TradeRow | null>(null);
  const [takeAmount, setTakeAmount] = useState('');
  const [screenshot, setScreenshot] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Per-trade detail the view getters do not expose. Loaded on open.
  const [deadline, setDeadline] = useState(0);
  const [fiatPaid, setFiatPaid] = useState(false);
  const [confirmedBy, setConfirmedBy] = useState<string[]>([]);
  const [storedScreenshot, setStoredScreenshot] = useState('');
  const [bank, setBank] = useState<{
    bankHolderName: string;
    bankAccountNumber: string;
    ifscCode: string;
    bankName: string;
  } | null>(null);
  // Drives the countdown. Only ticking while a trade is open keeps this cheap.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Pointer position for the stat-card sheen, written as CSS vars rather than
  // re-rendering on every move.
  const statRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const onStatMove = (key: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    const el = statRefs.current[key];
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--p2p-mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--p2p-my', `${e.clientY - r.top}px`);
  };

  // Replay the count-up pop whenever the value actually changes.
  const [popKey, setPopKey] = useState('');
  const lastAds = useRef(stats.adCounter);
  const lastTrades = useRef(stats.tradeCounter);
  useEffect(() => {
    if (stats.adCounter !== lastAds.current) {
      lastAds.current = stats.adCounter;
      setPopKey(`ads-${stats.adCounter}`);
    }
    if (stats.tradeCounter !== lastTrades.current) {
      lastTrades.current = stats.tradeCounter;
      setPopKey(`trades-${stats.tradeCounter}`);
    }
  }, [stats.adCounter, stats.tradeCounter]);

  const tradeOpen = activeTrade?.status === TradeStatus.OPEN || activeTrade?.status === TradeStatus.PAID;

  useEffect(() => {
    if (!tradeOpen) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [tradeOpen]);

  const reload = useCallback(async () => {
    await Promise.all([refresh(), refreshKyc()]);
  }, [refresh, refreshKyc]);

  // Periodic resync so ads and trades appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [reload]);

  // Shared preamble for every write: require a connected wallet and a
  // verified KYC, then run and surface any revert. The signer is passed in
  // rather than captured so the guard owns the null check.
  const guard = async (fn: (s: Signer) => Promise<unknown>, label: string) => {
    if (!signer) {
      setStatus('Connect a wallet first.');
      return;
    }
    // The contract is BSC-only, so a wrong-network signer reverts with a
    // confusing error. Catch it here with something actionable.
    if (!(await ensureBsc())) {
      setStatus('Please switch your wallet to Binance Smart Chain and try again.');
      return;
    }
    if (!kyc.verified) {
      setStatus('Your KYC must be verified before trading.');
      return;
    }
    setActionBusy(true);
    setStatus(null);
    try {
      await fn(signer);
      setStatus(`${label} confirmed.`);
      await reload();
    } catch (e) {
      const err = e as { shortMessage?: string; reason?: string; message?: string };
      setStatus(`${label} failed: ${err?.shortMessage || err?.reason || err?.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const onCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount) return;
    await guard(
      (s) =>
        createAd(
          s,
          form.token,
          form.type === 'sell',
          form.amount,
          stats.defaultWindow || 1800,
        ),
      'Ad created',
    );
    setForm((f) => ({ ...f, amount: '' }));
  };

  const onTakeAd = async () => {
    if (!activeAd || !takeAmount) return;
    await guard(
      (s) => startTrade(s, tokenForPairType(activeAd.pairType), activeAd, takeAmount),
      'Trade started',
    );
    setActiveAd(null);
    setTakeAmount('');
  };

  const onMarkPaid = async () => {
    if (!activeTrade) return;
    if (!screenshot.trim()) {
      setStatus('An IPFS screenshot hash is required to mark INR as paid.');
      return;
    }
    await guard(
      (s) => markFiatPaid(s, activeTrade.id, screenshot.trim()),
      'Marked as paid',
    );
  };

  const onConfirmReceived = async () => {
    if (!activeTrade) return;
    await guard((s) => confirmFiatReceived(s, activeTrade.id), 'Crypto released to buyer');
  };

  const onSend = async () => {
    if (!activeTrade || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    // Optimistic append; the confirmed entry arrives from the log refresh.
    setChat((c) => [
      ...c,
      { sender: account ?? '', text, blockNumber: now },
    ]);
    await guard((s) => sendMessage(s, activeTrade.id, text), 'Message sent');
    if (signer) void refreshTradeDetail(activeTrade.id);
  };

  /** Pull chat, deadline, confirmations and bank details for one trade. */
  const refreshTradeDetail = async (tradeId: number) => {
    setChatLoading(true);
    try {
      const [{ messages }, events] = await Promise.all([
        getTradeChat(tradeId),
        getTradeEventState(tradeId),
      ]);
      setChat(messages);
      setDeadline(events.deadline);
      setFiatPaid(events.fiatPaid);
      setConfirmedBy(events.confirmedBy);
      setStoredScreenshot(events.screenshotHash);
      if (events.truncated && messages.length === 0 && events.deadline === 0) {
        setStatus(
          'On-chain history for this trade is older than the log window this public RPC can serve. Chat and confirmations will stay blank.',
        );
      }
    } catch {
      setChat([]);
    } finally {
      setChatLoading(false);
    }

    if (signer) {
      const details = await getTradeBankDetails(signer, tradeId);
      setBank(details);
    }
  };

  const openTrade = async (t: TradeRow) => {
    setActiveTrade(t);
    setScreenshot('');
    setBank(null);
    setDeadline(0);
    setFiatPaid(false);
    setConfirmedBy([]);
    setStoredScreenshot('');
    setChat([]);
    setNow(Math.floor(Date.now() / 1000));
    await refreshTradeDetail(t.id);
  };

  const closeTrade = () => {
    setActiveTrade(null);
    setChat([]);
    setBank(null);
  };

  return (
    <div className="fx-shell p2p-root">
      <div className="p2p-ambient" aria-hidden="true">
        <div className="p2p-ambient__orb p2p-ambient__orb--gold" />
        <div className="p2p-ambient__orb p2p-ambient__orb--emerald" />
        <div className="p2p-ambient__grid" />
      </div>

      <div className="max-w-6xl mx-auto space-y-6 relative">
        <header className="p2p-hero p-6 sm:p-8 fx-reveal">
          <div className="p2p-hero__inner flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="p2p-chip p2p-chip--open">
                  <span className="p2p-dot" />
                  Live on BSC
                </span>
                <span className="p2p-chip p2p-chip--muted">JSAV &amp; USDT / INR</span>
              </div>
              <h1 className="p2p-hero__title text-4xl sm:text-5xl">P2P Trading</h1>
              <p className="text-sm text-[#b9b0a3] max-w-2xl mt-3">
                Buy and sell JSAV or USDT against INR at fixed rates. Crypto is
                held in the on-chain escrow for the duration of each trade and
                released only when both sides confirm.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2.5">
              {account ? (
                <>
                  <span className="p2p-chip p2p-chip--done">
                    <span className="p2p-dot" />
                    {shortAddress(account)}
                  </span>
                  <span
                    className={
                      kyc.verified ? 'p2p-chip p2p-chip--open' : 'p2p-chip p2p-chip--muted'
                    }
                  >
                    {kyc.verified
                      ? 'KYC verified'
                      : kyc.submitted
                        ? 'KYC pending review'
                        : 'KYC not submitted'}
                  </span>
                </>
              ) : (
                <div className="gold-connect-wrapper rounded-md">
                  <ConnectButton />
                </div>
              )}
              {account && wrongChain && (
                <button
                  className="p2p-btn p2p-btn--ghost"
                  onClick={() => void ensureBsc()}
                  disabled={connecting}
                >
                  Switch to BSC
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 fx-reveal fx-reveal--delay-1">
          <div
            ref={(el) => { statRefs.current.ads = el; }}
            onMouseMove={onStatMove('ads')}
            className="p2p-stat p-5"
          >
            <div className="p2p-stat__label">On-chain ads</div>
            <div
              className={
                'p2p-stat__value' +
                (popKey === `ads-${stats.adCounter}` ? ' p2p-stat__value--pop' : '')
              }
            >
              {statsLoading ? '…' : stats.adCounter}
            </div>
            <div className="p2p-stat__sub">ever created</div>
          </div>

          <div
            ref={(el) => { statRefs.current.trades = el; }}
            onMouseMove={onStatMove('trades')}
            className="p2p-stat p-5"
          >
            <div className="p2p-stat__label">Trades started</div>
            <div
              className={
                'p2p-stat__value' +
                (popKey === `trades-${stats.tradeCounter}` ? ' p2p-stat__value--pop' : '')
              }
            >
              {statsLoading ? '…' : stats.tradeCounter}
            </div>
            <div className="p2p-stat__sub">escrow opened</div>
          </div>

          <div
            ref={(el) => { statRefs.current.jsav = el; }}
            onMouseMove={onStatMove('jsav')}
            className="p2p-stat p-5"
          >
            <div className="p2p-stat__label">JSAV / INR</div>
            <div className="p2p-stat__value">₹{FIXED_INR_PRICES.JSAV}</div>
            <div className="p2p-stat__sub">fixed rate</div>
          </div>

          <div
            ref={(el) => { statRefs.current.usdt = el; }}
            onMouseMove={onStatMove('usdt')}
            className="p2p-stat p-5"
          >
            <div className="p2p-stat__label">USDT / INR</div>
            <div className="p2p-stat__value">₹{FIXED_INR_PRICES.USDT}</div>
            <div className="p2p-stat__sub">fixed rate</div>
          </div>
        </section>

        {statsError && (
          <div className="p2p-alert p2p-alert--error">
            <span className="p2p-dot" style={{ marginTop: 6 }} />
            {statsError}
          </div>
        )}

        {!stats.chainActive && !statsLoading && (
          <div className="p2p-alert p2p-alert--warn">
            <span className="p2p-dot" style={{ marginTop: 6 }} />
            The contract reports chain 56 as not configured. Trading calls will
            revert until the owner enables it.
          </div>
        )}

        {/* KYC submission lives on /kyc now, so there is one place to submit
            and one source of truth. The desk still gates on kyc.verified,
            because only the contract can unlock trading. */}
        {account && !kyc.verified && (
          <div className="p2p-alert p2p-alert--warn">
            <span className="p2p-dot" style={{ marginTop: 6 }} />
            <div className="flex-1">
              <p className="mb-2">
                {kyc.submitted
                  ? 'Your KYC is submitted and waiting for owner review. You can post ads and take trades once it is approved.'
                  : 'You need a verified KYC before you can post ads or take trades.'}
              </p>
              <a
                className="p2p-btn p2p-btn--sm"
                href="/kyc/"
                style={{ textDecoration: 'none' }}
              >
                <span>{kyc.submitted ? 'View KYC status' : 'Complete KYC'}</span>
              </a>
            </div>
          </div>
        )}

        <form
          onSubmit={onCreateAd}
          className="p2p-panel p-6 grid gap-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto] items-end fx-reveal fx-reveal--delay-2"
        >
          <div className="p2p-field">
            <label className="p2p-label" htmlFor="p2p-token">Token</label>
            <select
              id="p2p-token"
              className="p2p-select"
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value as P2PToken }))}
            >
              {TOKENS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="p2p-field">
            <label className="p2p-label" htmlFor="p2p-type">Type</label>
            <select
              id="p2p-type"
              className="p2p-select"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'buy' | 'sell' }))}
            >
              <option value="sell">Sell {form.token} for INR</option>
              <option value="buy">Buy {form.token} with INR</option>
            </select>
          </div>
          <div className="p2p-field">
            <label className="p2p-label" htmlFor="p2p-amount">Amount ({form.token})</label>
            <input
              id="p2p-amount"
              type="number" min="0" step="any" required
              className="p2p-input"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className="p2p-field">
            <span className="p2p-label">Value (INR)</span>
            <div className="p2p-readout">
              {form.amount ? `₹${inrValueOf(form.token, form.amount)}` : '—'}
            </div>
          </div>
          <button type="submit" className="p2p-btn" disabled={actionBusy}>
            <span>{actionBusy ? 'Working…' : 'Post Ad'}</span>
          </button>
        </form>

        {status && <div className="p2p-alert p2p-alert--info">{status}</div>}

        <section className="p2p-panel p-6 fx-reveal fx-reveal--delay-3">
          <div className="p2p-panel__head">
            <h2 className="p2p-panel__title">Order Book</h2>
            <span className="p2p-panel__count">
              {ads.length} live{ads.length < stats.adCounter && ` · ${stats.adCounter} total`}
            </span>
          </div>

          {adsLoading && <div className="p2p-bar my-4" />}

          {ads.length === 0 ? (
            <div className="p2p-empty">
              <div className="p2p-empty__ring">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 17l5-5 4 4 8-8" />
                  <path d="M14 8h6v6" />
                </svg>
              </div>
              <p className="p2p-empty__text">
                {adsLoading
                  ? 'Reading the order book from chain…'
                  : stats.adCounter === 0
                    ? 'No ads on-chain yet. Post the first JSAV or USDT order to open the book.'
                    : 'No active ads. Every order so far has been filled or cancelled.'}
              </p>
            </div>
          ) : (
            <div className="p2p-table-wrap">
              <table className="p2p-table">
                <thead>
                  <tr>
                    <th>Ad</th>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Remaining</th>
                    <th>Value (INR)</th>
                    <th>State</th>
                    <th>Window</th>
                    <th>Maker</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ads.map((ad) => {
                    const token = tokenForPairType(ad.pairType);
                    return (
                      <tr key={ad.id} className={ad.isSellOrder ? 'p2p-row--sell' : 'p2p-row--buy'}>
                        <td className="p2p-num text-center">#{ad.id}</td>
                        <td className="text-center">{token}/INR</td>
                        <td className="text-center">
                          <span className={ad.isSellOrder ? 'p2p-side p2p-side--sell' : 'p2p-side p2p-side--buy'}>
                            {ad.isSellOrder ? 'SELL' : 'BUY'} {token}
                          </span>
                        </td>
                        <td className="p2p-num text-center">{ad.remainingCrypto} {token}</td>
                        <td className="p2p-num text-center">₹{inrValueOf(token, ad.remainingCrypto)}</td>
                        <td className="text-center">
                          {ad.active ? (
                            <span className="p2p-chip p2p-chip--open">
                              <span className="p2p-dot" />
                              {ad.isSellOrder ? 'locked' : 'open'}
                            </span>
                          ) : ad.exhausted ? (
                            <span className="p2p-chip p2p-chip--done">filled</span>
                          ) : (
                            <span className="p2p-chip p2p-chip--muted">cancelled</span>
                          )}
                        </td>
                        <td className="text-center p2p-num">
                          {ad.paymentWindow > 0 ? `${Math.round(ad.paymentWindow / 60)}m` : '—'}
                        </td>
                        <td className={ad.creator === account ? 'p2p-addr p2p-addr--me' : 'p2p-addr'}>
                          {shortAddress(ad.creator)}
                        </td>
                        <td className="text-center">
                          {ad.active && ad.creator !== account && (
                            <button
                              className="p2p-btn p2p-btn--sm"
                              disabled={actionBusy}
                              onClick={() => { setActiveAd(ad); setTakeAmount(''); }}
                            >
                              <span>{ad.isSellOrder ? 'Buy' : 'Sell'}</span>
                            </button>
                          )}
                          {ad.active && ad.creator === account && (
                            <button
                              className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                              disabled={actionBusy}
                              onClick={() => guard((s) => cancelAd(s, ad.id), 'Ad cancelled')}
                            >
                              <span>Cancel</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="p2p-panel p-6 fx-reveal fx-reveal--delay-3">
          <div className="p2p-panel__head">
            <h2 className="p2p-panel__title">Trades</h2>
            <span className="p2p-panel__count">
              {trades.length} shown{trades.length < stats.tradeCounter && ` · ${stats.tradeCounter} total`}
            </span>
          </div>

          {tradesLoading && <div className="p2p-bar my-4" />}

          {trades.length === 0 ? (
            <div className="p2p-empty">
              <div className="p2p-empty__ring">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <p className="p2p-empty__text">
                {tradesLoading
                  ? 'Reading trades from chain…'
                  : stats.tradeCounter === 0
                    ? 'No trades started yet. Taking an ad from the order book opens the first one.'
                    : 'Nothing in the recent window. Older trades are beyond the current page.'}
              </p>
            </div>
          ) : (
            <div className="p2p-table-wrap">
              <table className="p2p-table">
                <thead>
                  <tr>
                    <th>Trade</th>
                    <th>Pair</th>
                    <th>Amount</th>
                    <th>Value</th>
                    <th>Seller</th>
                    <th>Buyer</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const token = tokenForPairType(t.pairType);
                    const mine = t.seller === account || t.buyer === account;
                    return (
                      <tr key={t.id}>
                        <td className="p2p-num text-center">#{t.id}</td>
                        <td className="text-center">{token}/INR</td>
                        <td className="p2p-num text-center">{t.cryptoAmount} {token}</td>
                        <td className="p2p-num text-center">₹{paiseToInr(t.quoteAmount)}</td>
                        <td className={t.seller === account ? 'p2p-addr p2p-addr--me' : 'p2p-addr'}>
                          {shortAddress(t.seller)}
                        </td>
                        <td className={t.buyer === account ? 'p2p-addr p2p-addr--me' : 'p2p-addr'}>
                          {shortAddress(t.buyer)}
                        </td>
                        <td className="text-center">
                          <span className={tradeChipClass(t.status)}>
                            {t.status === TradeStatus.OPEN && <span className="p2p-dot" />}
                            {TRADE_STATUS_LABEL[t.status] ?? t.status}
                          </span>
                        </td>
                        <td className="text-center">
                          <button className="p2p-btn p2p-btn--sm p2p-btn--ghost" onClick={() => void openTrade(t)}>
                            <span>{mine ? 'Open' : 'View'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="p2p-foot py-4">
          <span>Escrow</span>
          <a
            href={`https://bscscan.com/address/${P2PESCROW_CONTRACT_ADDRESS}#code`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortAddress(P2PESCROW_CONTRACT_ADDRESS)}
          </a>
          <span>· verified P2PEscrow · owner {shortAddress(stats.owner)}</span>
        </footer>
      </div>

      {activeAd && (
        <div className="p2p-backdrop" onClick={() => setActiveAd(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Take ad ${activeAd.id}`}
            className="p2p-modal max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="p2p-modal__close"
              onClick={() => setActiveAd(null)}
              aria-label="Close"
            >
              &times;
            </button>
            <p className="p2p-kicker mb-2">Ad #{activeAd.id}</p>
            <h3 className="p2p-panel__title text-lg mb-3">
              {activeAd.isSellOrder ? 'Buy' : 'Sell'} {activeAd.remainingCrypto}{' '}
              {tokenForPairType(activeAd.pairType)}
            </h3>

            <div className="p2p-tiles">
              <div className="p2p-tile">
                <div className="p2p-tile__label">Rate</div>
                <div className="p2p-tile__value">₹{FIXED_INR_PRICES[tokenForPairType(activeAd.pairType)]} / unit</div>
              </div>
              <div className="p2p-tile">
                <div className="p2p-tile__label">Payment window</div>
                <div className="p2p-tile__value">
                  {activeAd.paymentWindow > 0 ? `${Math.round(activeAd.paymentWindow / 60)} min` : '—'}
                </div>
              </div>
            </div>

            <p className="text-xs text-[#b9b0a3] mb-4">
              {activeAd.isSellOrder
                ? 'You will send INR to the seller, who releases the crypto after confirming receipt.'
                : 'You will send crypto into escrow now, and receive INR from the seller.'}
            </p>

            <div className="mb-3">
              <label className="p2p-label" htmlFor="p2p-take-amount">Amount</label>
              <input
                id="p2p-take-amount"
                type="number" min="0" step="any"
                className="p2p-input"
                value={takeAmount}
                onChange={(e) => setTakeAmount(e.target.value)}
              />
              <div className="p2p-readout mt-2">
                ₹{takeAmount ? inrValueOf(tokenForPairType(activeAd.pairType), takeAmount) : '0.00'}
              </div>
            </div>

            <button
              className="p2p-btn p2p-btn--block"
              disabled={actionBusy || !takeAmount}
              onClick={onTakeAd}
            >
              <span>{actionBusy ? 'Working…' : 'Confirm Trade'}</span>
            </button>
          </div>
        </div>
      )}

      {activeTrade && (
        <div className="p2p-backdrop" onClick={closeTrade}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Trade ${activeTrade.id}`}
            className="p2p-modal max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="p2p-modal__close"
              onClick={closeTrade}
              aria-label="Close trade"
            >
              &times;
            </button>

            <p className="p2p-kicker mb-2">Trade #{activeTrade.id}</p>
            <h3 className="p2p-panel__title text-lg mb-1">
              {activeTrade.cryptoAmount} {tokenForPairType(activeTrade.pairType)} for ₹
              {paiseToInr(activeTrade.quoteAmount)}
            </h3>
            <div className="mb-4">
              <span className={tradeChipClass(activeTrade.status)}>
                {activeTrade.status === TradeStatus.OPEN && <span className="p2p-dot" />}
                {TRADE_STATUS_LABEL[activeTrade.status] ?? activeTrade.status}
              </span>
            </div>

            {/* Countdown and confirmations come from event logs, since
                getTrade() does not expose deadline or the confirm flags. */}
            {activeTrade.isFiat && (
              <div className="p2p-tiles">
                <div
                  className={
                    deadline > 0 && secondsLeft(deadline, now) === 0
                      ? 'p2p-tile p2p-tile--urgent'
                      : 'p2p-tile'
                  }
                >
                  <div className="p2p-tile__label">Payment window</div>
                  <div className="p2p-tile__value">
                    {deadline === 0
                      ? chatLoading
                        ? 'loading…'
                        : 'not on record'
                      : formatCountdown(deadline, now)}
                  </div>
                </div>
                <div className="p2p-tile">
                  <div className="p2p-tile__label">Confirmations</div>
                  <div className="p2p-tile__value p2p-tile__value--mono">
                    {chatLoading
                      ? 'loading…'
                      : confirmedBy.length
                        ? confirmedBy.map(shortAddress).join(', ')
                        : 'none on record'}
                  </div>
                  {fiatPaid && <div className="p2p-stat__sub">INR marked as sent</div>}
                </div>
              </div>
            )}

            {/* Seller's receiving details. Only a trade party can read these,
                and the contract returns them for active INR trades only. */}
            {activeTrade.isFiat && (
              <div className="p2p-bank">
                <div className="p2p-tile__label mb-2">Seller bank details — INR receiver</div>
                {bank ? (
                  <dl className="p2p-bank__grid">
                    <dt>Name</dt>
                    <dd>{bank.bankHolderName}</dd>
                    <dt>Bank</dt>
                    <dd>{bank.bankName}</dd>
                    <dt>Account</dt>
                    <dd>{bank.bankAccountNumber}</dd>
                    <dt>IFSC</dt>
                    <dd>{bank.ifscCode}</dd>
                  </dl>
                ) : (
                  <p className="text-sm text-[#b9b0a3]">
                    {activeTrade.status === TradeStatus.OPEN ||
                    activeTrade.status === TradeStatus.PAID
                      ? 'Connect a wallet and be a party to this trade to view.'
                      : 'Unavailable once the trade is closed.'}
                  </p>
                )}
              </div>
            )}

            {storedScreenshot && (
              <div className="p2p-tile mb-4">
                <div className="p2p-tile__label">Payment screenshot on record</div>
                <div className="p2p-tile__value p2p-tile__value--mono break-all">
                  {storedScreenshot}
                </div>
              </div>
            )}

            <div className="p2p-tile__label mb-1">On-chain chat</div>
            <div className="p2p-chat mb-3">
              {chatLoading && <span className="p2p-chat__empty">Loading history…</span>}
              {!chatLoading && chat.length === 0 && (
                <span className="p2p-chat__empty">No messages yet.</span>
              )}
              {chat.map((m, i) => (
                <div key={`${m.blockNumber}-${i}`} className="p2p-chat__msg">
                  <span className="p2p-chat__who">{shortAddress(m.sender)}</span>
                  <span>{m.text}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <input
                className="p2p-input flex-1"
                placeholder="Message the counterparty…"
                aria-label="Chat message"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
              />
              <button className="p2p-btn" onClick={onSend} disabled={actionBusy}>
                <span>Send</span>
              </button>
            </div>

            {activeTrade.buyer === account && activeTrade.status === TradeStatus.OPEN && !fiatPaid && (
              <div className="mb-4">
                <label className="p2p-label" htmlFor="p2p-shot">
                  Payment screenshot — IPFS hash
                </label>
                <input
                  id="p2p-shot"
                  className="p2p-input mb-2"
                  placeholder="Qm… or ipfs://…"
                  value={screenshot}
                  onChange={(e) => setScreenshot(e.target.value)}
                />
                <button className="p2p-btn p2p-btn--block" disabled={actionBusy} onClick={onMarkPaid}>
                  <span>I have sent the INR</span>
                </button>
              </div>
            )}

            {activeTrade.seller === account && activeTrade.status === TradeStatus.PAID && (
              <button
                className="p2p-btn p2p-btn--block mb-4"
                disabled={actionBusy}
                onClick={onConfirmReceived}
              >
                <span>INR received — release crypto</span>
              </button>
            )}

            {activeTrade.status === TradeStatus.OPEN && deadline > 0 &&
              secondsLeft(deadline, now) === 0 && (
                <button
                  className="p2p-btn p2p-btn--ghost p2p-btn--block"
                  disabled={actionBusy}
                  onClick={() => guard((s) => cancelExpiredFiatTrade(s, activeTrade.id), 'Trade cancelled')}
                >
                  <span>Window expired — cancel and refund seller</span>
                </button>
              )}

            {status && <div className="p2p-alert p2p-alert--info mt-4">{status}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default P2PPage;
