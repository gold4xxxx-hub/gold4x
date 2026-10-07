'use client';

// Local audit view over the generated p2p-audit.json.
//
// Shows every ad and trade the escrow contract has ever seen, with the full
// on-chain chat, every payment screenshot, and who released or refunded each
// trade. The desk UI cannot answer those questions because it only shows what
// is currently open.
//
// Data comes from /api/audit, which refuses to serve in production unless
// AUDIT_PAGE_ENABLED=1. This file is a viewer only; it never touches a
// contract, so there is nothing here to sign and no wallet is required.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import './audit.css';
import { KycPanel } from './KycPanel';

/** Clickable wallet. Opens the KYC record for that address. */
function Addr({ a }: { a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="alink alink--addr"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="View KYC record"
      >
        {short(a)}
      </button>
      {open && <KycPanel address={a} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Gateways tried in order, with how many times each is retried.
 *
 * Measured on 2026-10-07: of 31 screenshot CIDs, 30 served fine from Pinata and
 * one took 7.4s for a 76 KB JPEG. The public alternates answered 429 for that
 * same CID. So the primary gateway is retried several times before falling
 * through - switching gateways on the first error made things worse, because the
 * alternates are the ones that are rate limited.
 */
const GATEWAYS: { url: (cid: string) => string; retries: number }[] = [
  { url: (cid) => `https://gateway.pinata.cloud/ipfs/${cid}`, retries: 3 },
  { url: (cid) => `https://dweb.link/ipfs/${cid}`, retries: 1 },
  { url: (cid) => `https://ipfs.io/ipfs/${cid}`, retries: 1 },
];

const gatewayUrl = (cid: string) => GATEWAYS[0].url(cid);

/**
 * An IPFS image that degrades instead of showing a broken-image icon.
 *
 * Retries with backoff, shows an explicit loading frame while it waits, and
 * finally renders a panel carrying the CID and a direct link. A slow gateway and
 * a genuinely missing file look identical otherwise, and only one of those is a
 * data problem worth flagging.
 */
function GatewayImage({ cid, alt }: { cid: string; alt: string }) {
  const [stage, setStage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  // A different CID restarts the cascade from the primary gateway.
  useEffect(() => {
    setStage(0);
    setAttempt(0);
    setLoaded(false);
    setExhausted(false);
  }, [cid]);

  // Backoff between retries, so a throttled gateway is not hammered.
  useEffect(() => {
    if (loaded || exhausted || attempt === 0) return;
    const delay = 700 * 2 ** (attempt - 1);
    const t = setTimeout(() => {
      const max = GATEWAYS[stage].retries;
      if (attempt < max) setAttempt((a) => a + 1);
      else if (stage + 1 < GATEWAYS.length) {
        setStage((s) => s + 1);
        setAttempt(1);
      } else setExhausted(true);
    }, delay);
    return () => clearTimeout(t);
  }, [attempt, stage, loaded, exhausted]);

  if (exhausted) {
    return (
      <div className="ashot-missing">
        <span className="ashot-missing__t">Image unavailable</span>
        <span className="ashot-missing__d">
          Every gateway failed. The file may be unpinned, or all of them are rate
          limiting right now. The CID is recorded on-chain regardless.
        </span>
        <code className="ashot-missing__cid">{cid}</code>
        <a href={gatewayUrl(cid)} target="_blank" rel="noopener noreferrer">
          Open in gateway
        </a>
      </div>
    );
  }

  return (
    <div className={`ashot-frame ${loaded ? 'is-loaded' : ''}`}>
      {!loaded && (
        <div className="ashot-loading" role="status">
          <span className="ashot-loading__spin" aria-hidden="true" />
          <span>
            Loading{attempt > 1 ? ` · retry ${attempt}` : ''}
          </span>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`${stage}-${attempt}`}
        src={GATEWAYS[stage].url(cid)}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (loaded) return;
          setLoaded(false);
          const max = GATEWAYS[stage].retries;
          if (attempt < max) setAttempt((a) => a + 1);
          else if (stage + 1 < GATEWAYS.length) {
            setStage((s) => s + 1);
            setAttempt(1);
          } else setExhausted(true);
        }}
      />
    </div>
  );
}

type ChatMessage = { sender: string; text: string; time: string | null; block: number; tx: string };
type Shot = {
  sender: string;
  cid: string;
  hasProof: boolean;
  gatewayUrl: string | null;
  time: string | null;
  block: number;
  tx: string;
  /** Whether the file was actually retrievable when the index was built. */
  reachableAtBuild?: boolean;
  fetchMs?: number | null;
  fetchBytes?: number | null;
};
type Confirmation = { wallet: string; time: string | null; block: number; tx: string };

type Trade = {
  id: number;
  adId: number;
  pair: string;
  token: string;
  isFiat: boolean;
  seller: string;
  buyer: string;
  cryptoAmount: string;
  quoteAmountInr: string;
  status: string;
  startedAt: string | null;
  markedPaidAt: string | null;
  markedPaidBy: string | null;
  paymentProofReference: string | null;
  screenshots: Shot[];
  realScreenshotCount: number;
  chat: ChatMessage[];
  confirmations: Confirmation[];
  closedAt: string | null;
  releasedBy: string | null;
  releaseFunction: string | null;
  releasedByOwner: boolean;
  releaseSentTo: string | null;
  releaseWasIndirect: boolean;
  releaseTx: string | null;
  outcome: string;
  /** JSAV that actually left escrow in the closing transaction. */
  payoutSent?: number | null;
  /** True when the closing receipt shows the crypto reached the right party. */
  payoutVerified?: boolean | null;
  payoutAnomaly?: string;
  /** INR payment window from TradeStarted. Absent for crypto-to-crypto. */
  deadline?: string | null;
  /** Why this trade is holding escrow, and who can move it. */
  escrowState?: 'AWAITING_BUYER' | 'AWAITING_SELLER' | 'EXPIRED_UNCLAIMED' | 'AWAITING_CONFIRMATION' | 'RELEASED';
  stuck?: boolean;
  reason?: string;
  exitPath?: string;
};

type Ad = {
  id: number;
  creator: string;
  pair: string;
  side: string;
  originalCrypto: string;
  originalQuoteInr: string;
  remainingCrypto: string;
  active: boolean;
  createdAt: string | null;
  cancelledAt: string | null;
  outcome: string;
  tradesTaken: number[];
};

type Index = {
  generatedAt: string;
  contract: string;
  escrowOwner: string;
  blockRange: { deployBlock: number; head: number };
  summary: {
    ads: number;
    adsActive: number;
    trades: number;
    tradesByStatus: Record<string, number>;
    ownerOverrides: number;
    escrowBalanceJSAV: string;
    escrowedInOpenTrades: string;
    escrowUnattributed: string;
    escrowUnattributedReason: string;
    stuck: { trades: number; valueJSAV: string; ids: number[]; reason: string };
    awaitingBuyer: { trades: number; valueJSAV: string; reason: string };
    awaitingSeller: { trades: number; valueJSAV: string; reason: string };
    chatMessages: number;
    realScreenshots: number;
    kyc: { submitted: number; updated: number; verified: number };
  };
  trades: Trade[];
  ads: Ad[];
};

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const when = (iso?: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 19)} UTC` : '—');
const bscTx = (h?: string | null) => (h ? `https://bscscan.com/tx/${h}` : null);
const bscAddr = (a?: string | null) => (a ? `https://bscscan.com/address/${a}` : null);

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'OPEN' || status === 'ACTIVE'
      ? 'is-open'
      : status === 'PAID'
        ? 'is-paid'
        : status === 'COMPLETED'
          ? 'is-done'
          : status === 'FILLED'
            ? 'is-paid'
            : 'is-closed';
  return <span className={`achip achip--${cls}`}>{status}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'alert' | 'good' }) {
  return (
    <div className={`astat ${tone ? `astat--${tone}` : ''}`}>
      <div className="astat__k">{label}</div>
      <div className="astat__v">{value}</div>
      {sub && <div className="astat__d">{sub}</div>}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const [open, setOpen] = useState(false);
  const real = trade.screenshots.filter((s) => s.hasProof);

  return (
    <div className={`arow ${open ? 'is-open' : ''}`}>
      <button type="button" className="arow__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="arow__id">#{trade.id}</span>
        <span className="arow__pair">
          {trade.pair} · {trade.isFiat ? 'INR' : 'CRYPTO'}
        </span>
        <span className="arow__amt">
          {trade.cryptoAmount} {trade.token}
        </span>
        <span className="arow__badges">
          <StatusChip status={trade.status} />
          {trade.stuck && <span className="achip achip--stuck">STUCK</span>}
          {trade.payoutAnomaly && <span className="achip achip--override">PAYOUT UNCONFIRMED</span>}
          {trade.releasedByOwner && <span className="achip achip--override">OWNER OVERRIDE</span>}
          {real.length > 0 && <span className="achip achip--done">{real.length} shot</span>}
        </span>
        <span className="arow__caret">▶</span>
      </button>

      {open && (
        <div className="arow__body">
          <div className="agrid">
            <section className="ablock">
              <h3>Escrow</h3>
              {trade.escrowState && trade.escrowState !== 'RELEASED' && (
                <div className={`areason ${trade.stuck ? 'is-stuck' : ''}`}>
                  <div className="areason__t">
                    {trade.stuck ? 'Stuck in escrow' : 'Holding escrow'}
                  </div>
                  <p>{trade.reason}</p>
                  {trade.exitPath && (
                    <p className="areason__x">
                      <b>How it clears:</b> {trade.exitPath}
                    </p>
                  )}
                  {trade.deadline && (
                    <p className="areason__d">Payment window closed {when(trade.deadline)}</p>
                  )}
                </div>
              )}
              <dl>
                <div><dt>Status</dt><dd><StatusChip status={trade.status} /></dd></div>
                <div><dt>Opened</dt><dd>{when(trade.startedAt)}</dd></div>
                <div>
                  <dt>Seller</dt>
                  <dd><Addr a={trade.seller} /></dd>
                </div>
                <div>
                  <dt>Buyer</dt>
                  <dd><Addr a={trade.buyer} /></dd>
                </div>
                <div><dt>Crypto</dt><dd>{trade.cryptoAmount} {trade.token}</dd></div>
                <div><dt>INR value</dt><dd>₹{trade.quoteAmountInr}</dd></div>
                {trade.markedPaidAt && (
                  <div>
                    <dt>INR marked paid</dt>
                    <dd>{when(trade.markedPaidAt)}<br />by {short(trade.markedPaidBy)}</dd>
                  </div>
                )}
                <div>
                  <dt>
                    {trade.status === 'COMPLETED'
                      ? 'Released to buyer'
                      : trade.status === 'CANCELLED'
                        ? 'Refunded to seller'
                        : 'Held in escrow'}
                  </dt>
                  <dd>
                    {trade.closedAt ? (
                      <>
                        {when(trade.closedAt)}<br />
                        by <Addr a={trade.releasedBy!} /><br />
                        <span className="amono">{trade.releaseFunction}</span>
                        {trade.releaseWasIndirect && (
                          <>
                            <br />
                            <span className="anote">via router {short(trade.releaseSentTo)}</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="amono amono--dim">still in escrow</span>
                    )}
                  </dd>
                </div>
                {trade.payoutVerified !== null && trade.payoutVerified !== undefined && (
                  <div>
                    <dt>Token movement</dt>
                    <dd>
                      {trade.payoutVerified ? (
                        <span className="averified">
                          verified in receipt · {trade.payoutSent} {trade.token} sent
                        </span>
                      ) : (
                        <span className="aunverified">
                          {trade.payoutAnomaly
                            ? `NOT CONFIRMED — ${trade.payoutAnomaly}`
                            : `expected ${trade.cryptoAmount}, receipt shows ${trade.payoutSent ?? 0}`}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {trade.releaseTx && (
                  <div>
                    <dt>Tx</dt>
                    <dd><a href={bscTx(trade.releaseTx)!} target="_blank" rel="noopener noreferrer">{trade.releaseTx.slice(0, 12)}…</a></dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="ablock">
              <h3>Chat ({trade.chat.length})</h3>
              {trade.chat.length === 0 ? (
                <p className="aempty">No messages.</p>
              ) : (
                <div className="achat">
                  {trade.chat.map((m, i) => (
                    <div key={`${m.block}-${i}`} className="amsg">
                      <div className="amsg__h">
                        <span>{short(m.sender)}</span>
                        <span>{when(m.time)}</span>
                      </div>
                      <div className="amsg__x">{m.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="ablock">
              <h3>Payment proof ({real.length}/{trade.screenshots.length} real)</h3>
              {trade.screenshots.length === 0 ? (
                <p className="aempty">None shared.</p>
              ) : (
                <div className="ashots">
                  {trade.screenshots.map((s, i) =>
                    s.hasProof ? (
                      <figure key={`${s.block}-${i}`} className="ashot">
                        <GatewayImage cid={s.cid} alt="payment screenshot" />
                        <figcaption>
                          <a href={s.gatewayUrl!} target="_blank" rel="noopener noreferrer">{s.cid}</a>
                          <span>
                            {when(s.time)} · {short(s.sender)}
                            {s.reachableAtBuild === false && (
                              <em className="awarn"> · not reachable when indexed</em>
                            )}
                            {s.reachableAtBuild === true && typeof s.fetchMs === 'number' && s.fetchMs > 6000 && (
                              <em className="aslow"> · slow gateway {(s.fetchMs / 1000).toFixed(1)}s</em>
                            )}
                          </span>
                        </figcaption>
                      </figure>
                    ) : (
                      <p key={`${s.block}-${i}`} className="aempty">
                        No proof provided. The contract requires a non-empty string, so{' '}
                        <code>{s.cid}</code> was written in place of an image.
                      </p>
                    ),
                  )}
                </div>
              )}
            </section>

            <section className="ablock">
              <h3>Timeline</h3>
              <div className="atl">
                {trade.startedAt && (
                  <div className="aev">
                    <span className="aev__t">{when(trade.startedAt)}</span>
                    <span className="aev__b"><b>TradeStarted</b> opened on ad #{trade.adId}</span>
                  </div>
                )}
                {trade.chat.map((m, i) => (
                  <div key={`c${i}`} className="aev">
                    <span className="aev__t">{when(m.time)}</span>
                    <span className="aev__b"><b>ChatMessage</b> {short(m.sender)}: {m.text}</span>
                  </div>
                ))}
                {trade.screenshots.filter((s) => s.hasProof).map((s, i) => (
                  <div key={`s${i}`} className="aev">
                    <span className="aev__t">{when(s.time)}</span>
                    <span className="aev__b"><b>ScreenshotShared</b> {short(s.sender)} shared a payment screenshot</span>
                  </div>
                ))}
                {trade.markedPaidAt && (
                  <div className="aev">
                    <span className="aev__t">{when(trade.markedPaidAt)}</span>
                    <span className="aev__b"><b>FiatMarkedPaid</b> {short(trade.markedPaidBy)} marked the INR as sent</span>
                  </div>
                )}
                {trade.confirmations.map((c, i) => (
                  <div key={`f${i}`} className="aev">
                    <span className="aev__t">{when(c.time)}</span>
                    <span className="aev__b"><b>TradeConfirmed</b> {short(c.wallet)} confirmed</span>
                  </div>
                ))}
                {trade.closedAt && (
                  <div className="aev">
                    <span className="aev__t">{when(trade.closedAt)}</span>
                    <span className="aev__b">
                      <b>{trade.status === 'COMPLETED' ? 'TradeCompleted' : 'TradeCancelled'}</b>{' '}
                      {trade.status === 'COMPLETED' ? 'crypto released to buyer' : 'escrow returned'} by{' '}
                      {short(trade.releasedBy)} via {trade.releaseFunction}
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function AdRow({ ad }: { ad: Ad }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`arow ${open ? 'is-open' : ''}`}>
      <button type="button" className="arow__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="arow__id">#{ad.id}</span>
        <span className="arow__pair">{ad.pair} · {ad.side}</span>
        <span className="arow__amt">{ad.remainingCrypto} left</span>
        <span className="arow__badges">
          <StatusChip status={ad.outcome} />
          {ad.tradesTaken.length > 0 && <span className="achip achip--done">{ad.tradesTaken.length} trades</span>}
        </span>
        <span className="arow__caret">▶</span>
      </button>
      {open && (
        <div className="arow__body">
          <div className="agrid">
            <section className="ablock">
              <h3>Order</h3>
              <dl>
                <div><dt>Outcome</dt><dd><StatusChip status={ad.outcome} /></dd></div>
                <div>
                  <dt>Creator</dt>
                  <dd><Addr a={ad.creator} /></dd>
                </div>
                <div><dt>Side / pair</dt><dd>{ad.side} {ad.pair}</dd></div>
                <div><dt>Original</dt><dd>{ad.originalCrypto} for ₹{ad.originalQuoteInr}</dd></div>
                <div><dt>Remaining</dt><dd>{ad.remainingCrypto}</dd></div>
                <div><dt>Created</dt><dd>{when(ad.createdAt)}</dd></div>
                {ad.cancelledAt && <div><dt>Cancelled</dt><dd>{when(ad.cancelledAt)}</dd></div>}
                <div>
                  <dt>Trades taken</dt>
                  <dd>{ad.tradesTaken.length ? ad.tradesTaken.map((t) => `#${t}`).join(', ') : 'none'}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  const [data, setData] = useState<Index | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'trades' | 'ads'>('trades');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [release, setRelease] = useState('');
  const [proof, setProof] = useState('any');
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/audit', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
        setData(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();

    if (tab === 'ads') {
      const asAdId = /^\d+$/.test(needle) ? Number(needle) : null;
      return data.ads
        .filter((a) => {
          if (!needle) return true;
          if (asAdId !== null) return a.id === asAdId;
          return [a.creator, a.pair, a.side, a.outcome, ...a.tradesTaken.map((x) => `#${x}`)]
            .join(' ')
            .toLowerCase()
            .includes(needle);
        })
        .map((a) => <AdRow key={a.id} ad={a} />);
    }

    // A bare number is treated as an id, not a substring. Substring matching
    // made "37" return 19 trades, because it also matched 137, 237 and 731.
    const asId = /^\d+$/.test(needle) ? Number(needle) : null;

    // Words people actually type, mapped onto the fields they mean. "stuck"
    // returned nothing before because no reason string contained the word.
    const KEYWORDS: Record<string, (t: Trade) => boolean> = {
      stuck: (t) => Boolean(t.stuck),
      expired: (t) => t.escrowState === 'EXPIRED_UNCLAIMED',
      unclaimed: (t) => t.escrowState === 'EXPIRED_UNCLAIMED',
      holding: (t) => t.escrowState !== 'RELEASED',
      released: (t) => t.escrowState === 'RELEASED',
      override: (t) => t.releasedByOwner,
      'owner override': (t) => t.releasedByOwner,
      router: (t) => Boolean(t.releaseWasIndirect),
      unconfirmed: (t) => Boolean(t.payoutAnomaly),
      anomaly: (t) => Boolean(t.payoutAnomaly),
      paid: (t) => t.status === 'PAID',
      open: (t) => t.status === 'OPEN',
      completed: (t) => t.status === 'COMPLETED',
      cancelled: (t) => t.status === 'CANCELLED',
      chat: (t) => t.chat.length > 0,
      screenshot: (t) => t.realScreenshotCount > 0,
    };

    return data.trades
      .filter((t) => {
        if (status && t.status !== status) return false;
        if (release === 'override' && !t.releasedByOwner) return false;
        if (release === 'normal' && t.releasedByOwner) return false;
        if (release === 'indirect' && !t.releaseWasIndirect) return false;
        if (proof === 'any' || proof === '') {
          // no proof filter
        } else if (proof === 'yes' && t.realScreenshotCount === 0) return false;
        else if (proof === 'no' && t.realScreenshotCount > 0) return false;
        else if (proof === 'placeholder' && !t.screenshots.some((s) => !s.hasProof)) return false;

        if (filter === 'stuck' && !t.stuck) return false;
        if (filter === 'holding' && (t.stuck === undefined || t.escrowState === 'RELEASED')) return false;
        if (filter === 'awaitingSeller' && t.escrowState !== 'AWAITING_SELLER') return false;
        if (filter === 'awaitingBuyer' && t.escrowState !== 'AWAITING_BUYER') return false;
        if (filter === 'anomaly' && !t.payoutAnomaly) return false;

        if (!needle) return true;
        // A numeric query is an id, full stop. Falling through to substring
        // matching made "37" also return 137, 237 and 731.
        if (asId !== null) return t.id === asId;
        const kw = KEYWORDS[needle];
        if (kw && kw(t)) return true;
        // releasedBy was missing from the haystack, so a trade could not be
        // found by whoever released it - which is the main thing being audited.
        return [
          t.seller, t.buyer, t.pair, t.status, t.releaseFunction, t.adId,
          t.releasedBy, t.markedPaidBy, t.releaseSentTo, t.reason, t.escrowState,
          t.outcome,
          ...t.confirmations.map((c) => c.wallet),
          ...t.chat.map((c) => c.text),
          ...t.chat.map((c) => c.sender),
          ...t.screenshots.map((s) => s.cid),
          ...t.screenshots.map((s) => s.sender),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .map((t) => <TradeRow key={t.id} trade={t} />);
  }, [data, tab, q, status, release, proof, filter]);

  if (loading) {
    return (
      <div className="fx-shell audit-root">
        <div className="audit-wrap"><p className="aempty">Loading audit index…</p></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fx-shell audit-root">
        <div className="audit-wrap">
          <div className="abanner">
            <b>Audit index unavailable.</b>
            <p>{error}</p>
            <p>
              Generate it from the project root with:
              <code className="acode"> npm run audit:build</code>
            </p>
            <p>
              The page is disabled in production builds. Set <code className="acode">AUDIT_PAGE_ENABLED=1</code>{' '}
              if you are serving it deliberately.
            </p>
            <p><Link href="/p2p" className="alink">Back to the desk</Link></p>
          </div>
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="fx-shell audit-root">
      <div className="audit-wrap">
        <header className="ahead">
          <div>
            <h1 className="ahead__t">P2P Escrow — Audit</h1>
            <p className="ahead__s">
              index built {data.generatedAt.replace('T', ' ').slice(0, 19)} UTC · blocks{' '}
              {data.blockRange.deployBlock.toLocaleString()} → {data.blockRange.head.toLocaleString()}
            </p>
          </div>
          <div className="ahead__m">
            <p>contract <code className="acode">{data.contract}</code></p>
            <p>owner <code className="acode">{data.escrowOwner}</code></p>
          </div>
        </header>

        {/*
          Escrow funds broken down by why they are held, because "in escrow" on
          its own is not actionable. Cancelled trades were checked against their
          own receipts and all refunded correctly, so this is not stranded
          refunds; the two buckets below are the ones that need a decision.
        */}
        <section className="afunds">
          <h2 className="afunds__t">Escrow funds — {s.escrowBalanceJSAV} JSAV</h2>
          <div className="afunds__grid">
            <div className="afund afund--stuck">
              <div className="afund__k">Stuck — needs cancelling</div>
              <div className="afund__v">{s.stuck.valueJSAV} JSAV</div>
              <div className="afund__n">{s.stuck.trades} trade(s)</div>
              <p className="afund__r">{s.stuck.reason}</p>
              <button type="button" className="abtn abtn--sm" onClick={() => { setTab('trades'); setFilter('stuck'); }}>
                Show these trades
              </button>
            </div>

            <div className="afund afund--wait">
              <div className="afund__k">Waiting on seller confirmation</div>
              <div className="afund__v">{s.awaitingSeller.valueJSAV} JSAV</div>
              <div className="afund__n">{s.awaitingSeller.trades} trade(s)</div>
              <p className="afund__r">{s.awaitingSeller.reason}</p>
              <button type="button" className="abtn abtn--sm" onClick={() => { setTab('trades'); setFilter('awaitingSeller'); }}>
                Show these trades
              </button>
            </div>

            <div className="afund afund--wait">
              <div className="afund__k">Waiting on buyer payment</div>
              <div className="afund__v">{s.awaitingBuyer.valueJSAV} JSAV</div>
              <div className="afund__n">{s.awaitingBuyer.trades} trade(s)</div>
              <p className="afund__r">{s.awaitingBuyer.reason}</p>
            </div>

            {Number(s.escrowUnattributed) > 0.0001 && (
              <div className="afund afund--owner">
                <div className="afund__k">Owner-only — no trade attached</div>
                <div className="afund__v">{s.escrowUnattributed} JSAV</div>
                <div className="afund__n">cannot be traded or claimed</div>
                <p className="afund__r">{s.escrowUnattributedReason}</p>
              </div>
            )}
          </div>
        </section>

        <div className="astats">
          <Stat label="Trades" value={s.trades} sub={`${s.tradesByStatus.OPEN || 0} open · ${s.tradesByStatus.PAID || 0} paid`} />
          <Stat label="Completed" value={s.tradesByStatus.COMPLETED || 0} sub={`${s.tradesByStatus.CANCELLED || 0} cancelled`} />
          <Stat label="Orders" value={s.ads} sub={`${s.adsActive} still active`} />
          <Stat label="Owner overrides" value={s.ownerOverrides} sub="forced release or refund" />
          <Stat label="Escrow balance" value={`${s.escrowBalanceJSAV} JSAV`} sub={`${s.escrowedInOpenTrades} backs open trades`} />
          <Stat label="Unattributed" value={`${s.escrowUnattributed} JSAV`} sub="held by no open trade" tone={Number(s.escrowUnattributed) > 0.0001 ? 'alert' : 'good'} />
          <Stat label="Chat messages" value={s.chatMessages} sub="on-chain" />
          <Stat label="Payment screenshots" value={s.realScreenshots} sub="real images" />
          <Stat label="KYC verified" value={s.kyc.verified} sub={`${s.kyc.submitted} submitted`} />
        </div>

        <div className="atabs">
          <button className={`atab ${tab === 'trades' ? 'is-active' : ''}`} onClick={() => setTab('trades')}>
            Trades <span className="atab__n">{data.trades.length}</span>
          </button>
          <button className={`atab ${tab === 'ads' ? 'is-active' : ''}`} onClick={() => setTab('ads')}>
            Orders <span className="atab__n">{data.ads.length}</span>
          </button>
        </div>

        <div className="actl">
          <input
            type="search"
            className="ainput"
            placeholder="Search id, wallet, chat text, CID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {tab === 'trades' && (
            <>
              <select className="ainput" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option>OPEN</option><option>PAID</option><option>COMPLETED</option><option>CANCELLED</option>
              </select>
              <select className="ainput" value={release} onChange={(e) => setRelease(e.target.value)}>
                <option value="">All releases</option>
                <option value="override">Owner override only</option>
                <option value="normal">Normal confirmation only</option>
                <option value="indirect">Sent via router</option>
              </select>
              <select className="ainput" value={proof} onChange={(e) => setProof(e.target.value)}>
                <option value="any">All — every payment-proof state</option>
                <option value="yes">Has a real screenshot</option>
                <option value="no">No screenshot at all</option>
                <option value="placeholder">Placeholder instead of an image</option>
              </select>
              <select className="ainput" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All escrow states</option>
                <option value="stuck">Stuck — expired, needs cancelling</option>
                <option value="holding">Currently holding escrow</option>
                <option value="awaitingBuyer">Waiting on buyer payment</option>
                <option value="awaitingSeller">Waiting on seller confirmation</option>
                <option value="anomaly">Payout not confirmed</option>
              </select>
            </>
          )}
          <button className="abtn abtn--sm" onClick={load}>Refresh</button>
          <span className="ahint">{rows ? rows.length : 0} shown</span>
        </div>

        <div>{rows}</div>
      </div>
    </div>
  );
}
