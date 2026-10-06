'use client';

// P2P trading desk. Reads live P2PEscrow state; all writes go through the
// verified ABI. Pairs supported: JSAV/INR and USDT/INR. G4X is not supported
// by the deployed contract.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { useConnection, useConnectorClient, useConnect, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import './p2p.css';
import {
  P2PESCROW_CONTRACT_ADDRESS,
  BSC_CONFIG,
  isP2pEscrowOwner,
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
  adminForceCompleteTrade,
  adminForceCancelTrade,
  cancelAd,
  cancelExpiredFiatTrade,
  sendMessage,
  shareScreenshot,
  getTradeBankDetails,
  getWalletVerification,
  getWalletContactDetails,
  type AdRow,
  type TradeRow,
} from '@/hooks/useP2PEscrow';
import {
  getTradeChat,
  getTradeEventState,
  getTradeScreenshots,
  type ChatEntry,
  type ScreenshotEntry,
} from '@/lib/p2pLogs';
import { ipfsUrl } from '@/lib/ipfs';

/** Seconds remaining until `deadline`, floored at 0. */
function secondsLeft(deadline: number, now: number): number {
  if (!deadline) return 0;
  return Math.max(0, deadline - now);
}

const NO_SCREENSHOT_PROVIDED = 'no-screenshot-provided';

// Client-side pre-check only. The upload route validates again and is the real
// authority; this just avoids a pointless round trip on an oversized file.
const MAX_SHOT_BYTES = 5 * 1024 * 1024;

function formatCountdown(deadline: number, now: number): string | null {
  if (!deadline) return null;
  const left = secondsLeft(deadline, now);
  if (left === 0) return 'window expired';
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Turn a contract revert into something a user can act on. */
function explainTradeError(err: {
  shortMessage?: string;
  reason?: string;
  message?: string;
}): string {
  const raw = err?.reason || err?.shortMessage || err?.message || 'unknown error';
  const quoted = raw.match(/reverted: "([^"]+)"/);
  const reason = quoted?.[1] || raw;

  const known: Record<string, string> = {
    'KYC not verified': 'Your KYC is not verified yet, so you cannot trade.',
    'Invalid amount':
      'That amount is not available. Check it is above zero and no more than the ad has left.',
    'Quote too small':
      'That amount is too small. The contract rounds to paise and the resulting value came out as zero, so use a larger amount.',
    'Ad not active': 'This ad is no longer available. It may have been filled or cancelled.',
    'Ad creator KYC missing':
      'The person who posted this ad is no longer verified, so the ad cannot be taken.',
    'Own ad': 'You cannot take your own ad.',
    'Not owner': 'Only the contract owner can do that.',
    'Not verified': 'Your KYC is not verified yet, so you cannot trade.',
    'Chain not configured': 'The contract is not enabled on this network.',
    'Reentrant': 'Something went wrong mid-transaction. Please try again.',
    'TransferFrom failed':
      'The token transfer was refused. Check you have approved the escrow contract and enough balance.',
    'Not KYC verified': 'Your KYC is not verified yet, so you cannot trade.',
  };

  if (known[reason]) return known[reason];

  if (/user rejected|denied/i.test(raw)) return 'You cancelled the transaction in your wallet.';
  if (/insufficient funds/i.test(raw))
    return 'Not enough BNB in this wallet to pay for the transaction.';
  if (/missing revert data|execution reverted/i.test(raw))
    return 'The contract rejected this without giving a reason. Check your KYC, network and balance.';

  return reason;
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

function sameWallet(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

const TOKENS: P2PToken[] = ['JSAV', 'USDT'];
type PairFilter = 'all' | P2PToken;
type SideFilter = 'all' | 'buy' | 'sell';
type WalletContact = { mobile: string; email: string } | null;

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
    busy: switching,
    isConnected,
    wrongChain: Boolean(wrongChain),
    ensureBsc,
  };
}

const P2PPage: React.FC = () => {
  const {
    account,
    signer,
    wrongChain,
    ensureBsc,
  } = useSigner();
  const { connect: connectWallet } = useConnect();
  const { stats, loading: statsLoading, error: statsError, refresh } = useEscrowStats();
  const { status: kyc, refresh: refreshKyc } = useKycStatus(account);
  const {
    ads,
    loading: adsLoading,
    loadOlder: loadOlderAds,
    loadingOlder: loadingOlderAds,
    hasMore: moreAds,
    totalOnChain: totalAds,
    loadedFrom: adsFrom,
    loadedTo: adsTo,
  } = useAds(stats.adCounter, stats.chainActive);
  const {
    trades,
    loading: tradesLoading,
    refresh: refreshTrades,
    loadOlder: loadOlderTrades,
    loadingOlder: loadingOlderTrades,
    hasMore: moreTrades,
    totalOnChain: totalTrades,
    loadedFrom: tradesFrom,
    loadedTo: tradesTo,
  } = useTrades(stats.tradeCounter, stats.chainActive);

  const [form, setForm] = useState({ token: 'JSAV' as P2PToken, type: 'sell' as 'buy' | 'sell', amount: '' });
  const [pairFilter, setPairFilter] = useState<PairFilter>('all');
  const [sideFilter, setSideFilter] = useState<SideFilter>('all');
  const [activeAd, setActiveAd] = useState<AdRow | null>(null);
  const [activeTrade, setActiveTrade] = useState<TradeRow | null>(null);
  const [takeAmount, setTakeAmount] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  // Screenshots are their own event stream, so they are tracked separately and
  // interleaved into the transcript by block number.
  const [shots, setShots] = useState<ScreenshotEntry[]>([]);
  const [shotUploading, setShotUploading] = useState(false);
  const [shotOpen, setShotOpen] = useState<string | null>(null);
  const [profileVerification, setProfileVerification] = useState<Record<string, boolean | null>>({});
  const [profileContacts, setProfileContacts] = useState<Record<string, WalletContact>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
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

  // Hidden file input for the screenshot picker. Driven by a label styled as a
  // button so it lines up with Send, but still a real file input, which is what
  // makes mobile browsers surface the camera.
  const shotInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeTrade) {
      setProfileVerification({});
      setProfileContacts({});
      return;
    }

    let cancelled = false;
    const addresses = [...new Set([activeTrade.seller, activeTrade.buyer])];
    const canSeeContacts = activeTrade.isFiat &&
      (activeTrade.status === TradeStatus.OPEN || activeTrade.status === TradeStatus.PAID) &&
      (sameWallet(activeTrade.seller, account) || sameWallet(activeTrade.buyer, account));

    Promise.all(addresses.map(async (address) => {
      const [verification, contact] = await Promise.all([
        getWalletVerification(address).catch(() => null),
        canSeeContacts ? getWalletContactDetails(address).catch(() => null) : null,
      ]);
      return { address, verification, contact };
    })).then((profiles) => {
      if (cancelled) return;
      setProfileVerification(Object.fromEntries(
        profiles.map(({ address, verification }) => [address, verification]),
      ));
      setProfileContacts(Object.fromEntries(
        profiles.map(({ address, contact }) => [address, contact]),
      ));
    });

    return () => { cancelled = true; };
  }, [activeTrade, account]);
  const tradeOpen = activeTrade?.status === TradeStatus.OPEN || activeTrade?.status === TradeStatus.PAID;

  useEffect(() => {
    if (!tradeOpen) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [tradeOpen]);

  const reload = useCallback(async () => {
    await Promise.all([refresh(), refreshKyc(), refreshTrades()]);
  }, [refresh, refreshKyc, refreshTrades]);

  // Periodic resync so ads and trades appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [reload]);

  // Matches the main page's golden button. injected() constructs the connector
  // directly rather than searching the connectors array, which is empty until
  // EIP-6963 discovery finishes, and it works inside SafePal's in-app browser.
  // RainbowKit's ConnectButton would be wrong here: it opens a wallet-picker
  // modal, which is pointless for someone already inside a wallet browser.
  const handleConnect = () => {
    setStatus(null);
    connectWallet(
      { connector: injected() },
      {
        onSuccess: () => setConnecting(false),
        onError: (e: Error) => {
          setConnecting(false);
          setStatus(
            e?.message?.includes('not available') ||
              e?.message?.includes('No EIP-1193')
              ? 'No wallet detected. Open this page inside your SafePal app, or install a browser extension on desktop.'
              : e?.message || 'Could not connect the wallet.',
          );
        },
      },
    );
    setConnecting(true);
  };

  // Shared preamble for every write: require a connected wallet and a
  // verified KYC, then run and surface any revert. The signer is passed in
  // rather than captured so the guard owns the null check.
  //
  // Returns whether the write succeeded. Callers that own a modal must keep it
  // open on failure: this previously returned void, so the take-ad modal closed
  // even when the transaction reverted, and the error was rendered behind it.
  // That is what made a failed trade look like nothing happening.
  const guard = async (
    fn: (s: Signer) => Promise<unknown>,
    label: string,
    requireVerifiedKyc = true,
  ): Promise<boolean> => {
    if (!signer) {
      setStatus('Connect a wallet first.');
      return false;
    }
    // The contract is BSC-only, so a wrong-network signer reverts with a
    // confusing error. Catch it here with something actionable.
    if (!(await ensureBsc())) {
      setStatus('Please switch your wallet to Binance Smart Chain and try again.');
      return false;
    }
    if (requireVerifiedKyc && !kyc.verified) {
      setStatus('Your KYC must be verified before trading.');
      return false;
    }
    setActionBusy(true);
    setStatus(null);
    try {
      await fn(signer);
      setStatus(`${label} confirmed.`);
      await reload();
      return true;
    } catch (e) {
      const err = e as { shortMessage?: string; reason?: string; message?: string };
      setStatus(
        `${label} failed: ${explainTradeError(err)}`,
      );
      return false;
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
    const ok = await guard(
      (s) => startTrade(s, tokenForPairType(activeAd.pairType), activeAd, takeAmount),
      'Trade started',
    );
    // Only close on success. Closing on failure is what made a rejected trade
    // look like the button did nothing.
    if (ok) {
      setActiveAd(null);
      setTakeAmount('');
    }
  };

  const onMarkPaid = async () => {
    if (!activeTrade) return;
    const trade = activeTrade;
    const marked = await guard(
      (s) => markFiatPaid(s, trade.id, NO_SCREENSHOT_PROVIDED),
      'INR marked as paid',
      false,
    );
    if (!marked) return;

    const sellerNote = 'I have sent the INR. Please verify receipt and release the crypto.';
    setChatInput(sellerNote);
    void refreshTradeDetail(trade.id, trade);

    // Written on-chain via sendMessage, so the note is part of the trade record
    // and readable from the contract's own event log.
    if (!signer) return;
    try {
      await sendMessage(signer, trade.id, sellerNote);
      setChatInput('');
      setStatus('INR marked as paid. The seller has been notified in the trade chat.');
    } catch {
      setStatus('INR marked as paid. The seller note is ready in chat; send it when your wallet allows.');
    }
  };

  const onConfirmReceived = async () => {
    if (!activeTrade) return;
    const tradeId = activeTrade.id;
    const released = await guard(
      (s) => confirmFiatReceived(s, tradeId),
      'Crypto released to buyer',
      false,
    );
    if (released) {
      setActiveTrade((current) =>
        current?.id === tradeId
          ? { ...current, status: TradeStatus.COMPLETED }
          : current,
      );
      void refreshTradeDetail(tradeId, activeTrade);
    }
  };

  const onAdminForceRelease = async () => {
    if (!activeTrade || !signer) {
      setStatus('Connect the contract owner wallet to force-release escrow.');
      return;
    }
    if (!isP2pEscrowOwner(account)) {
      setStatus('Only the escrow contract owner can force-release a trade.');
      return;
    }
    if (!activeTrade.isFiat || activeTrade.status !== TradeStatus.PAID) {
      setStatus('Admin release is available only after the buyer marks an INR trade paid.');
      return;
    }
    const trade = activeTrade;
    const confirmed = window.confirm(
      `Admin override for trade #${trade.id}: release ${trade.cryptoAmount} ${tokenForPairType(trade.pairType)} to the buyer? Only proceed after independently verifying INR receipt. This action cannot be undone.`,
    );
    if (!confirmed) return;
    if (!(await ensureBsc())) {
      setStatus('Switch to Binance Smart Chain before releasing escrow.');
      return;
    }

    setActionBusy(true);
    setStatus(null);
    try {
      await adminForceCompleteTrade(signer, trade.id);
      setActiveTrade((current) =>
        current?.id === trade.id
          ? { ...current, status: TradeStatus.COMPLETED }
          : current,
      );
      setStatus('Admin force-release confirmed. Crypto was released to the buyer.');
      await reload();
      void refreshTradeDetail(trade.id, { ...trade, status: TradeStatus.COMPLETED });
    } catch (e) {
      const err = e as { shortMessage?: string; reason?: string; message?: string };
      setStatus(`Admin force-release failed: ${explainTradeError(err)}`);
    } finally {
      setActionBusy(false);
    }
  };

  /**
   * Owner override that cancels the trade and returns the escrowed crypto.
   *
   * The counterpart to the release above. An OPEN trade otherwise has no exit
   * for the owner: the buyer can only cancel once the payment window lapses, so
   * an abandoned OPEN trade would sit in escrow indefinitely.
   */
  const onAdminForceCancel = async () => {
    if (!activeTrade || !signer) {
      setStatus('Connect the contract owner wallet to force-cancel a trade.');
      return;
    }
    if (!isP2pEscrowOwner(account)) {
      setStatus('Only the escrow contract owner can force-cancel a trade.');
      return;
    }
    if (activeTrade.status !== TradeStatus.OPEN && activeTrade.status !== TradeStatus.PAID) {
      setStatus('This trade is already closed, so there is nothing to cancel.');
      return;
    }
    const trade = activeTrade;
    const confirmed = window.confirm(
      `Admin override for trade #${trade.id}: cancel and return ${trade.cryptoAmount} ${tokenForPairType(trade.pairType)} to the SELLER?\n\nOnly choose this if the INR was NOT received, or the buyer abandoned the trade. If the buyer already paid, use "Release to buyer" instead. This cannot be undone.`,
    );
    if (!confirmed) return;
    if (!(await ensureBsc())) {
      setStatus('Switch to Binance Smart Chain before cancelling.');
      return;
    }

    setActionBusy(true);
    setStatus(null);
    try {
      await adminForceCancelTrade(signer, trade.id);
      setActiveTrade((current) =>
        current?.id === trade.id
          ? { ...current, status: TradeStatus.CANCELLED }
          : current,
      );
      setStatus('Admin force-cancel confirmed. Escrowed crypto was returned to the seller.');
      await reload();
      void refreshTradeDetail(trade.id, { ...trade, status: TradeStatus.CANCELLED });
    } catch (e) {
      const err = e as { shortMessage?: string; reason?: string; message?: string };
      setStatus(`Admin force-cancel failed: ${explainTradeError(err)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const onSend = async () => {
    if (!activeTrade || !chatInput.trim()) return;
    const text = chatInput.trim();
    if (!signer) {
      setStatus('Connect the buyer or seller wallet to send a message.');
      return;
    }
    setActionBusy(true);
    try {
      await sendMessage(signer, activeTrade.id, text);
      setChatInput('');
      setStatus('Message sent on-chain.');
    } catch (e) {
      const err = e as { shortMessage?: string; reason?: string; message?: string };
      setStatus(`Message failed: ${explainTradeError(err)}`);
    } finally {
      setActionBusy(false);
    }
  };

  /**
   * Upload a screenshot and record its CID on the trade.
   *
   * The image goes to IPFS via Pinata; only the CID is written on-chain, which
   * is what `shareScreenshot` expects. Both parties can do this at any point in
   * a trade, independent of the payment state.
   */
  const onShareShot = async (file: File) => {
    if (!activeTrade) return;

    if (!file.type.startsWith('image/')) {
      setStatus('That file is not an image.');
      return;
    }
    if (file.size > MAX_SHOT_BYTES) {
      setStatus('Image is too large. Maximum size is 5 MB.');
      return;
    }

    setShotUploading(true);
    setStatus(null);
    let cid: string;
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/p2p/screenshot', { method: 'POST', body });
      const json = (await res.json()) as { cid?: string; error?: string };
      if (!res.ok || !json.cid) {
        setStatus(json.error || 'Upload failed. Please try again.');
        return;
      }
      cid = json.cid;
    } catch {
      setStatus('Could not reach the upload service. Check your connection.');
      return;
    } finally {
      setShotUploading(false);
    }

    const ok = await guard(
      (s) => shareScreenshot(s, activeTrade.id, cid),
      'Screenshot shared',
    );
    if (ok) {
      setShotOpen(cid);
      void refreshTradeDetail(activeTrade.id, activeTrade);
    }
  };

  /** Pull chat, deadline, confirmations and bank details for one trade. */
  const refreshTradeDetail = useCallback(async (tradeId: number, tradeContext: TradeRow) => {
    setChatLoading(true);
    let chainMessages: ChatEntry[] = [];
    try {
      const [{ messages }, events, { screenshots }] = await Promise.all([
        getTradeChat(tradeId),
        getTradeEventState(tradeId),
        getTradeScreenshots(tradeId),
      ]);
      chainMessages = messages;
      setShots(screenshots);
      setDeadline(events.deadline);
      setFiatPaid(events.fiatPaid);
      setConfirmedBy(events.confirmedBy);
      setStoredScreenshot(events.screenshotHash);
      if (events.truncated && messages.length === 0 && events.deadline === 0) {
        setStatus(
          'Trade history could not be fully read. The public RPC may have limited older events; refresh the trade and try again.',
        );
      }
    } catch {
      setShots([]);
    }

    const isParticipant =
      tradeContext.id === tradeId &&
      (sameWallet(tradeContext.buyer, account) || sameWallet(tradeContext.seller, account));

    setChat(chainMessages);
    setChatLoading(false);

    if (signer) {
      const details = await getTradeBankDetails(signer, tradeId);
      setBank(details);
    }
  }, [signer, account]);

  useEffect(() => {
    if (!activeTrade) return;
    const latest = trades.find((trade) => trade.id === activeTrade.id);
    if (!latest || latest.status === activeTrade.status) return;
    setActiveTrade((current) =>
      current?.id === latest.id && current.status !== latest.status
        ? { ...current, status: latest.status }
        : current,
    );
    void refreshTradeDetail(latest.id, latest);
  }, [activeTrade, trades, refreshTradeDetail]);

  const openTrade = async (t: TradeRow) => {
    setActiveTrade(t);
    setBank(null);
    setDeadline(0);
    setFiatPaid(false);
    setConfirmedBy([]);
    setStoredScreenshot('');
    setChat([]);
    setShots([]);
    setShotOpen(null);
    setNow(Math.floor(Date.now() / 1000));
    await refreshTradeDetail(t.id, t);
  };

  const closeTrade = () => {
    setActiveTrade(null);
    setChat([]);
    setShots([]);
    setShotOpen(null);
    setBank(null);
  };

  /**
   * Chat and screenshots are separate event streams. Interleaving them by block
   * number gives one honest transcript, so a screenshot sits in the order it was
   * actually shared rather than in a separate panel.
   *
   * A shared block number falls back to the log index, then to the stream order,
   * so entries never jump around between refreshes.
   */
  const transcript = useMemo(() => {
    type Row =
      | { kind: 'text'; sender: string; text: string; at: number }
      | { kind: 'shot'; sender: string; cid: string; at: number };

    const rows: Row[] = [
      ...chat.map((m, i) => ({
        kind: 'text' as const,
        sender: m.sender,
        text: m.text,
        at: m.blockNumber * 1000 + i,
      })),
      ...shots.map((s) => ({
        kind: 'shot' as const,
        sender: s.sender,
        cid: s.cid,
        at: s.blockNumber * 1000 + s.index,
      })),
    ];
    return rows.sort((a, b) => a.at - b.at);
  }, [chat, shots]);

  const marketAds = useMemo(
    () => ads.filter((ad) =>
      (pairFilter === 'all' || tokenForPairType(ad.pairType) === pairFilter) &&
      (sideFilter === 'all' || (ad.isSellOrder ? 'sell' : 'buy') === sideFilter),
    ),
    [ads, pairFilter, sideFilter],
  );
  const activeTrades = useMemo(
    () => trades.filter(
      (trade) => trade.status === TradeStatus.OPEN || trade.status === TradeStatus.PAID,
    ),
    [trades],
  );
  const openTrades = activeTrades.length;
  const canSeeTradeContacts = Boolean(
    activeTrade?.isFiat &&
    (activeTrade.status === TradeStatus.OPEN || activeTrade.status === TradeStatus.PAID) &&
    (sameWallet(activeTrade.seller, account) || sameWallet(activeTrade.buyer, account)),
  );
  // Chat and screenshots are written on-chain, so a wallet signature is needed
  // and only a trade party may write.
  const canWriteToTrade = Boolean(
    activeTrade &&
    (activeTrade.status === TradeStatus.OPEN || activeTrade.status === TradeStatus.PAID) &&
    (sameWallet(activeTrade.seller, account) || sameWallet(activeTrade.buyer, account)),
  );

  return (
    <div className="fx-shell p2p-root">
      <div className="p2p-ambient" aria-hidden="true">
        <div className="p2p-ambient__grid" />
      </div>

      <div className="p2p-market-shell relative">
        <header className="p2p-hero p2p-hero--market p-5 sm:p-6 fx-reveal">
          <div className="p2p-hero__inner flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="p2p-chip p2p-chip--open">
                  <span className="p2p-dot" />
                  Live on BSC
                </span>
                <span className="p2p-chip p2p-chip--muted">JSAV &amp; USDT / INR</span>
              </div>
              <h1 className="p2p-hero__title text-2xl sm:text-3xl">P2P Market</h1>
              <p className="text-sm text-[#b9b0a3] max-w-2xl mt-3">
                Buy and sell JSAV or USDT against INR at fixed rates. Crypto
                stays in escrow until the buyer marks INR paid and the seller
                confirms receipt.
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
                <span className="p2p-account-note">Connect a wallet to trade</span>
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

        <section className="p2p-market-stats fx-reveal fx-reveal--delay-1" aria-label="Market summary">
          <div className="p2p-market-stat">
            <div className="p2p-stat__label">Open offers</div>
            <div className="p2p-stat__value">{adsLoading ? '—' : ads.length}</div>
            <div className="p2p-stat__sub">available now</div>
          </div>
          <div className="p2p-market-stat">
            <div className="p2p-stat__label">Open trades</div>
            <div className="p2p-stat__value">{tradesLoading ? '—' : openTrades}</div>
            <div className="p2p-stat__sub">awaiting completion</div>
          </div>
          <div className="p2p-market-stat">
            <div className="p2p-stat__label">JSAV / INR</div>
            <div className="p2p-stat__value">₹{FIXED_INR_PRICES.JSAV}</div>
            <div className="p2p-stat__sub">fixed rate</div>
          </div>
          <div className="p2p-market-stat">
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

        <section className="p2p-panel p2p-market-panel p-5 sm:p-6 fx-reveal fx-reveal--delay-3">
          <div className="p2p-panel__head">
            <h2 className="p2p-panel__title">Order Book</h2>
            <div className="p2p-market-tools">
              <div className="p2p-segment" role="group" aria-label="Filter offers by token">
                {(['all', ...TOKENS] as PairFilter[]).map((pair) => (
                  <button
                    key={pair}
                    type="button"
                    className={pairFilter === pair ? 'is-active' : ''}
                    aria-pressed={pairFilter === pair}
                    onClick={() => setPairFilter(pair)}
                  >
                    {pair === 'all' ? 'All pairs' : pair}
                  </button>
                ))}
              </div>
              <div className="p2p-segment" role="group" aria-label="Filter offers by side">
                {(['all', 'buy', 'sell'] as SideFilter[]).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={sideFilter === side ? 'is-active' : ''}
                    aria-pressed={sideFilter === side}
                    onClick={() => setSideFilter(side)}
                  >
                    {side === 'all' ? 'All sides' : side === 'buy' ? 'Buy' : 'Sell'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p2p-market-count">{marketAds.length} active offers</div>
          <p className="p2p-table-hint">Scroll horizontally to view all offer details.</p>

          {adsLoading && <div className="p2p-bar my-4" />}

          {marketAds.length === 0 ? (
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
                  : ads.length > 0
                    ? 'No active offers match these filters.'
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
                  {marketAds.map((ad) => {
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
                              onClick={() => guard((s) => cancelAd(s, ad.id), 'Ad cancelled', false)}
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

          {moreAds && (
            <div className="p2p-pager">
              <p className="p2p-pager__note">
                Showing orders #{adsFrom}–#{adsTo} of {totalAds} created. Older orders are
                not loaded yet.
              </p>
              <button
                type="button"
                className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                disabled={loadingOlderAds}
                onClick={() => void loadOlderAds()}
              >
                <span>
                  {loadingOlderAds
                    ? 'Loading…'
                    : `Load ${Math.min(25, Math.max(0, adsFrom - 1))} older orders`}
                </span>
              </button>
            </div>
          )}
        </section>

        <section className="p2p-panel p-6 fx-reveal fx-reveal--delay-3">
          <div className="p2p-panel__head">
            <h2 className="p2p-panel__title">Trades</h2>
            <span className="p2p-panel__count">
              {activeTrades.length} active
            </span>
          </div>

          {tradesLoading && <div className="p2p-bar my-4" />}
          <p className="p2p-table-hint">Scroll horizontally to view all trade details.</p>

          {activeTrades.length === 0 ? (
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
                    : 'No active trades right now. Completed and cancelled trades are hidden.'}
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
                  {activeTrades.map((t) => {
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

          {moreTrades && (
            <div className="p2p-pager">
              <p className="p2p-pager__note">
                Showing trades #{tradesFrom}–#{tradesTo} of {totalTrades} on-chain. Older
                trades are not loaded yet.
              </p>
              <button
                type="button"
                className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                disabled={loadingOlderTrades}
                onClick={() => void loadOlderTrades()}
              >
                <span>
                  {loadingOlderTrades
                    ? 'Loading…'
                    : `Load ${Math.min(25, Math.max(0, tradesFrom - 1))} older trades`}
                </span>
              </button>
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

            {/* Errors are repeated here, not only in the page behind the
                modal, so a rejected trade cannot look like nothing happened. */}
            {status && <div className="p2p-alert p2p-alert--error mb-3">{status}</div>}

            {!kyc.verified && account && (
              <div className="p2p-alert p2p-alert--warn mb-3">
                <span className="p2p-dot" style={{ marginTop: 6 }} />
                This wallet is not KYC-verified, so the transaction will be
                rejected by the contract. Get approved first.
              </div>
            )}

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
              <div className="p2p-profile-list mb-4" aria-label="Trade participant profiles">
                {([
                  ['Seller', activeTrade.seller],
                  ['Buyer', activeTrade.buyer],
                ] as const).map(([role, address]) => {
                  const verified = profileVerification[address];
                  const contact = profileContacts[address];
                  return (
                    <div className="p2p-profile" key={role}>
                      <div className="p2p-tile__label">{role}{address === account ? ' · You' : ' · Counterparty'}</div>
                      <a
                        className="p2p-profile__address"
                        href={`https://bscscan.com/address/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {address}
                      </a>
                      <span className={verified ? 'p2p-profile__status p2p-profile__status--verified' : 'p2p-profile__status'}>
                        {verified === undefined
                          ? 'Checking verification…'
                          : verified === null
                            ? 'Verification unavailable'
                          : verified ? 'KYC verified on-chain' : 'Not KYC verified'}
                      </span>
                      {canSeeTradeContacts && (
                        <dl className="p2p-profile__contacts">
                          <div>
                            <dt>Mobile</dt>
                            <dd>
                              {contact === undefined
                                ? 'Loading…'
                                : contact?.mobile
                                  ? <a href={`tel:${encodeURIComponent(contact.mobile)}`}>{contact.mobile}</a>
                                  : 'Not provided'}
                            </dd>
                          </div>
                          <div>
                            <dt>Email</dt>
                            <dd>
                              {contact === undefined
                                ? 'Loading…'
                                : contact?.email
                                  ? <a href={`mailto:${encodeURIComponent(contact.email)}`}>{contact.email}</a>
                                  : 'Not provided'}
                            </dd>
                          </div>
                        </dl>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canSeeTradeContacts && (
              <p className="p2p-contact-disclosure mb-4">
                Contact details come from KYC data stored on BSC. This view is limited to trade parties, but the underlying contract data is public.
              </p>
            )}

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
                <div className="p2p-tile__label">
                  {storedScreenshot === NO_SCREENSHOT_PROVIDED
                    ? 'Payment marked without screenshot'
                    : 'Payment screenshot on record'}
                </div>
                <div className="p2p-tile__value p2p-tile__value--mono break-all">
                  {storedScreenshot === NO_SCREENSHOT_PROVIDED ? 'No screenshot provided' : storedScreenshot}
                </div>
              </div>
            )}

            {/* Full-size view of a shared screenshot. */}
            {shotOpen && (
              <div
                className="p2p-lightbox"
                role="dialog"
                aria-modal="true"
                aria-label="Shared payment image"
                onClick={() => setShotOpen(null)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ipfsUrl(shotOpen)}
                  alt="Shared payment image, enlarged"
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="p2p-lightbox__close"
                  aria-label="Close"
                  onClick={() => setShotOpen(null)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )}

            <div className="p2p-tile__label mb-1">Trade chat</div>
            <p className="p2p-storage-note">
              Messages are written on-chain and are permanently public. Never include a
              phone number, OTP or password here.
            </p>
            <div className="p2p-chat mb-3">
              {chatLoading && <span className="p2p-chat__empty">Loading history…</span>}
              {!chatLoading && transcript.length === 0 && (
                <span className="p2p-chat__empty">
                  No messages or screenshots yet.
                </span>
              )}
              {transcript.map((row, i) =>
                row.kind === 'text' ? (
                  <div key={`t-${row.at}-${i}`} className="p2p-chat__msg">
                    <span className="p2p-chat__who">{shortAddress(row.sender)}</span>
                    <span>{row.text}</span>
                  </div>
                ) : (
                  <div key={`s-${row.at}-${i}`} className="p2p-chat__msg p2p-chat__msg--shot">
                    <span className="p2p-chat__who">{shortAddress(row.sender)}</span>
                    <button
                      type="button"
                      className="p2p-shot"
                      onClick={() => setShotOpen(row.cid)}
                      aria-label="Open shared payment image"
                    >
                      {/* Remote IPFS image, so next/image optimisation does not
                          apply and a plain img is the correct choice. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ipfsUrl(row.cid)}
                        alt={`Payment image shared by ${shortAddress(row.sender)}`}
                        loading="lazy"
                      />
                      <span className="p2p-shot__zoom">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <circle cx="11" cy="11" r="7" />
                          <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
                        </svg>
                      </span>
                    </button>
                  </div>
                ),
              )}
            </div>

            <div className="flex gap-2 mb-4">
              <input
                ref={shotInputRef}
                type="file"
                accept="image/*"
                className="p2p-shot-input"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void onShareShot(file);
                }}
              />
              <input
                className="p2p-input flex-1"
                placeholder="Message the counterparty…"
                aria-label="Chat message"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
              />
              <label
                className="p2p-btn p2p-btn--icon"
                title="Share a screenshot"
                tabIndex={0}
                role="button"
                aria-label="Share a screenshot"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    shotInputRef.current?.click();
                  }
                }}
              >
                {shotUploading ? (
                  <span className="p2p-btn__spin" aria-hidden="true" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M3 17l5-5 4 4 8-8" />
                    <path d="M14 8h6v6" />
                  </svg>
                )}
              </label>
              <button className="p2p-btn" onClick={onSend} disabled={actionBusy}>
                <span>Send</span>
              </button>
            </div>

            {sameWallet(activeTrade.buyer, account) && activeTrade.status === TradeStatus.OPEN && !fiatPaid && (
              <div className="mb-4">
                <p className="p2p-storage-note mb-2">
                  Attach a payment image privately above if useful. A screenshot is not required to mark INR paid.
                </p>
                <button className="p2p-btn p2p-btn--block" disabled={actionBusy} onClick={onMarkPaid}>
                  <span>Mark INR paid &amp; notify seller</span>
                </button>
              </div>
            )}

            {sameWallet(activeTrade.seller, account) && activeTrade.status === TradeStatus.PAID && (
              <button
                className="p2p-btn p2p-btn--block mb-4"
                disabled={actionBusy}
                onClick={onConfirmReceived}
              >
                <span>I received INR — release crypto to buyer</span>
              </button>
            )}

            {isP2pEscrowOwner(account) &&
              activeTrade.isFiat &&
              !sameWallet(activeTrade.seller, account) &&
              (activeTrade.status === TradeStatus.OPEN ||
                activeTrade.status === TradeStatus.PAID) && (
                <section className="p2p-admin" aria-label="Escrow admin controls">
                  <header className="p2p-admin__head">
                    <span className="p2p-admin__badge">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
                      </svg>
                      Escrow admin
                    </span>
                    <span className="p2p-admin__title">
                      Trade #{activeTrade.id} · {activeTrade.cryptoAmount}{' '}
                      {tokenForPairType(activeTrade.pairType)}
                    </span>
                  </header>

                  <p className="p2p-admin__note">
                    {activeTrade.status === TradeStatus.PAID
                      ? 'The buyer marked this INR trade as paid. Release only after you have independently verified the money arrived.'
                      : 'This trade is still open and holding escrow. Cancel to return the crypto to the seller, or wait for the buyer to mark payment.'}
                  </p>

                  <div className="p2p-admin__actions">
                    <button
                      type="button"
                      className="p2p-admin__btn p2p-admin__btn--release"
                      disabled={actionBusy || activeTrade.status !== TradeStatus.PAID}
                      onClick={() => void onAdminForceRelease()}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M4 21h16" />
                      </svg>
                      Release to buyer
                    </button>

                    <button
                      type="button"
                      className="p2p-admin__btn p2p-admin__btn--cancel"
                      disabled={actionBusy}
                      onClick={() => void onAdminForceCancel()}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M3 12a9 9 0 1 0 3-6.7" />
                        <path d="M3 4v5h5" />
                      </svg>
                      Cancel &amp; refund seller
                    </button>
                  </div>

                  <p className="p2p-admin__warn">
                    Owner override. These bypass the counterparty and cannot be undone.
                  </p>
                </section>
              )}

            {activeTrade.status === TradeStatus.OPEN && deadline > 0 &&
              secondsLeft(deadline, now) === 0 && (
                <button
                  className="p2p-btn p2p-btn--ghost p2p-btn--block"
                  disabled={actionBusy}
                  onClick={() => guard((s) => cancelExpiredFiatTrade(s, activeTrade.id), 'Trade cancelled', false)}
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
