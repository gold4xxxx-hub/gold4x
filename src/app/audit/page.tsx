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
import { AuditGate, useAuditToken } from './AuditGate';
import { KycPanel, type KycRecord } from './KycPanel';

/**
 * Jump from a person's drawer to those trades in the Trades tab.
 *
 * Without it, closing the drawer dropped you back on a list where finding
 * trade #7 among 68 meant scrolling and hunting for the id.
 */
function useTradeJump() {
  const [ids, setIds] = useState<number[] | null>(null);

  const show = useCallback((list: number[]) => {
    setIds(list);
    // Two frames: one to let the Trades tab render, one for the scroll target
    // to exist inside it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (list.length === 1) {
          document.getElementById(`trade-${list[0]}`)?.scrollIntoView({ block: 'center' });
        } else {
          document.getElementById('anchor-trades')?.scrollIntoView({ block: 'start' });
        }
      });
    });
  }, []);

  const clear = useCallback(() => setIds(null), []);
  return { ids, show, clear };
}

/**
 * Clickable wallet. Opens the KYC record for that address, with that person's
 * activity underneath. One drawer rather than several, because the question is
 * always "who is this person and what have they done" rather than one of the two
 * alone.
 */
function Addr({ a, ctx, showTrades }: { a: string; ctx?: AuditCtx; showTrades: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const person = ctx?.people.get(a.toLowerCase());

  return (
    <>
      <button
        type="button"
        className="alink alink--addr"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="View KYC record and activity"
      >
        {short(a)}
      </button>
      {open && (
        <KycPanel
          address={a}
          record={ctx?.kyc.get(a.toLowerCase())}
          onClose={() => setOpen(false)}
          extra={
            person && ctx ? (
              <PersonActivity person={person} ctx={ctx} onShowTrades={showTrades} />
            ) : undefined
          }
        />
      )}
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

  // A different CID restarts the cascade from the primary gateway. Callers key
  // this element by CID, so that remount is what resets the retry state - doing
  // it in an effect reset it a render late, briefly showing the previous
  // image's failure.

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

/**
 * One KYC holder's full record, flattened for the list.
 *
 * The activity columns come from the index rather than being recomputed here,
 * because resolving "every trade this person is in, and who they spoke to" on
 * each render means walking all 68 trades for each of 391 people.
 */
type Person = {
  wallet: string;
  bankHolderName: string;
  mobile: string;
  email: string;
  pan: string;
  bankName: string;
  submittedAt: string | null;
  verified: boolean;
  verifiedAt: string | null;
  firstVerifiedAt: string | null;
  verificationChanges: number;
  timesSubmitted: number;
  hasAadhaar: boolean;
  tradesAsSeller: number[];
  tradesAsBuyer: number[];
  ordersCreated: number[];
  chatMessages: number;
};

const tradeCount = (p: Person) => p.tradesAsSeller.length + p.tradesAsBuyer.length;

/** Everything the drawers need, built once so each row is a cheap prop. */
type AuditCtx = {
  kyc: Map<string, KycRecord>;
  people: Map<string, Person>;
  trades: Trade[];
  ads: Ad[];
};

const realCid = (v: string) =>
  /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(v);

/** How long approval took, in words. Null when either date is missing. */
function lag(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'under a minute later';
  if (mins < 60) return `${mins} min later`;
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours} h later`;
  return `${Math.round(ms / 86400000)} days later`;
}

function toPerson(r: KycRecord): Person {
  return {
    wallet: r.wallet,
    bankHolderName: r.bankHolderName?.trim() ?? '',
    mobile: r.mobile ?? '',
    email: r.email ?? '',
    pan: r.pan ?? '',
    bankName: r.bankName?.trim() ?? '',
    submittedAt: r.submittedAt,
    verified: r.verified,
    verifiedAt: r.verifiedAt,
    firstVerifiedAt: r.firstVerifiedAt,
    verificationChanges: r.verificationChanges ?? 0,
    timesSubmitted: r.timesSubmitted ?? 1,
    hasAadhaar: realCid(r.aadharFrontHash) && realCid(r.aadharBackHash),
    tradesAsSeller: r.tradesAsSeller ?? [],
    tradesAsBuyer: r.tradesAsBuyer ?? [],
    ordersCreated: r.ordersCreated ?? [],
    chatMessages: r.chatMessages ?? 0,
  };
}

/**
 * Everything this person ever sent or received in a trade chat.
 *
 * Split by direction because "who said this" is the question being audited: a
 * buyer's own words read very differently from the seller's, and a flat
 * transcript hides that entirely.
 */
type ChatLine = {
  tradeId: number;
  role: 'SOLD' | 'BOUGHT';
  time: string | null;
  block: number;
  text: string;
  shot: Shot | null;
};

function PersonChat({ wallet, trades }: { wallet: string; trades: Trade[] }) {
  const me = wallet.toLowerCase();

  const lines = useMemo<ChatLine[]>(() => {
    const out: ChatLine[] = [];
    for (const t of trades) {
      const role: ChatLine['role'] | null =
        t.seller.toLowerCase() === me ? 'SOLD' : t.buyer.toLowerCase() === me ? 'BOUGHT' : null;
      if (!role) continue;
      // Chat and screenshots share one timeline, so order both by block rather
      // than listing messages and then images.
      const merged = [
        ...t.chat.map((c) => ({ block: c.block, chat: c, shot: null as Shot | null })),
        ...t.screenshots.map((s) => ({ block: s.block, chat: null, shot: s })),
      ].sort((a, b) => a.block - b.block);
      for (const m of merged) {
        out.push({
          tradeId: t.id,
          role,
          time: m.chat ? m.chat.time : m.shot?.time ?? null,
          block: m.block,
          text: m.chat?.text ?? '',
          shot: m.shot,
        });
      }
    }
    return out.sort((a, b) => a.block - b.block);
  }, [trades, me]);

  if (lines.length === 0) {
    return <p className="aempty">This person has sent no chat messages.</p>;
  }

  return (
    <div className="atranscript">
      {lines.map((l, i) => (
        <div key={`${l.block}-${i}`} className="aline">
          <span className="aline__when">{when(l.time)}</span>
          <span className={`aline__role aline__role--${l.role.toLowerCase()}`}>{l.role}</span>
          <span className="aline__trade">
            <span className="alink alink--addr" title="Trade">
              #{l.tradeId}
            </span>
          </span>
          <span className="aline__body">
            {l.shot ? (
              l.shot.hasProof ? (
                <GatewayImage
                  key={`${l.tradeId}-${l.shot.cid}-${l.block}`}
                  cid={l.shot.cid}
                  alt={`Payment screenshot shared in trade #${l.tradeId}`}
                />
              ) : (
                <em className="aline__placeholder">
                  screenshot placeholder only — no image was shared
                </em>
              )
            ) : (
              l.text || <em className="aline__placeholder">empty message</em>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

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
    kyc: {
      submitted: number;
      updated: number;
      verified: number;
      decoded: number;
      withAadhaarFront: number;
      withAadhaarBack: number;
      withPan: number;
    };
  };
  trades: Trade[];
  ads: Ad[];
  kyc: KycRecord[];
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

/**
 * One person's orders and trades, side by side, with their side labelled.
 *
 * Reading "trade #12" without knowing whether they sold or bought is the gap
 * this closes: the same number means the opposite thing depending on the role,
 * and getting it backwards in an audit is worse than not seeing it at all.
 */
function PersonActivity({
  person,
  ctx,
  onShowTrades,
}: {
  person: Person;
  ctx: AuditCtx;
  onShowTrades: (ids: number[]) => void;
}) {
  const { trades, ads } = ctx;
  const showTrades = onShowTrades;
  const sellIds = new Set(person.tradesAsSeller);
  const buyIds = new Set(person.tradesAsBuyer);
  const orderIds = new Set(person.ordersCreated);

  const mine = trades.filter((t) => sellIds.has(t.id) || buyIds.has(t.id));
  const myOrders = ads.filter((a) => orderIds.has(a.id));

  if (mine.length === 0 && myOrders.length === 0) {
    return (
      <p className="aempty">
        This person has never traded or listed an order. They submitted KYC{' '}
        {person.submittedAt ? `on ${when(person.submittedAt)}` : 'but never traded'} and are
        {' '}{person.verified ? 'verified' : 'not verified'}.
      </p>
    );
  }

  return (
    <div className="apersonactivity">
      <h3 className="adrawer__h3">
        Trades <span className="acount">{mine.length}</span>
      </h3>
      {mine.length === 0 ? (
        <p className="aempty">No trades.</p>
      ) : (
        <table className="atable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Side</th>
              <th>Pair</th>
              <th className="anum">Amount</th>
              <th>Status</th>
              <th>Other party</th>
              <th>Started</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((t) => {
              const sold = sellIds.has(t.id);
              const other = sold ? t.buyer : t.seller;
              return (
                <tr key={t.id}>
                  <td>#{t.id}</td>
                  <td>
                    <span className={`achip ${sold ? 'achip--sell' : 'achip--buy'}`}>
                      {sold ? 'SOLD' : 'BOUGHT'}
                    </span>
                  </td>
                  <td>{t.pair}</td>
                  <td className="anum">
                    {t.cryptoAmount} {t.token}
                  </td>
                  <td>
                    <StatusChip status={t.status} />
                  </td>
                  <td>
                    <Addr a={other} ctx={ctx} showTrades={showTrades} />
                  </td>
                  <td className="anow">{when(t.startedAt)}</td>
                  <td className="anow">{t.closedAt ? when(t.closedAt) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="adrawer__h3">
        Orders <span className="acount">{myOrders.length}</span>
      </h3>
      {myOrders.length === 0 ? (
        <p className="aempty">No orders listed.</p>
      ) : (
        <table className="atable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Side</th>
              <th>Pair</th>
              <th className="anum">Original</th>
              <th className="anum">Remaining</th>
              <th>Status</th>
              <th>Taken in</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {myOrders.map((a) => (
              <tr key={a.id}>
                <td>#{a.id}</td>
                <td>{a.side}</td>
                <td>{a.pair}</td>
                <td className="anum">{a.originalCrypto}</td>
                <td className="anum">{a.remainingCrypto}</td>
                <td>
                  <StatusChip status={a.outcome} />
                </td>
                <td className="anow">
                  {a.tradesTaken.length ? a.tradesTaken.map((t) => `#${t}`).join(', ') : '—'}
                </td>
                <td className="anow">{when(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="adrawer__h3">
        Chat <span className="acount">{person.chatMessages}</span>
      </h3>
      <PersonChat wallet={person.wallet} trades={mine} />

      <button
        type="button"
        className="abtn abtn--sm"
        onClick={() => onShowTrades(mine.map((t) => t.id))}
      >
        Open these {mine.length} trades in the Trades tab
      </button>
    </div>
  );
}

/**
 * One person in the verified-users list.
 *
 * Name is shown next to the wallet because that is what you are searching for
 * in practice: nobody remembers an address, and the address alone makes it hard
 * to tell two similar rows apart.
 */
function PersonRow({
  person,
  ctx,
  showTrades,
}: {
  person: Person;
  ctx: AuditCtx;
  showTrades: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const n = tradeCount(person);

  return (
    <div className={`arow ${open ? 'is-open' : ''}`}>
      <button type="button" className="arow__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="arow__id">
          {person.verified ? (
            <span className="achip achip--is-done">VERIFIED</span>
          ) : (
            <span className="achip achip--is-closed">UNVERIFIED</span>
          )}
        </span>
        <span className="arow__pair">
          <b>{person.bankHolderName || '(no name on record)'}</b>
          <br />
          <span className="amono">{person.wallet}</span>
        </span>
        <span className="arow__amt">
          {n} trade{n === 1 ? '' : 's'}
          <br />
          <span className="adimplied">
            {person.ordersCreated.length} order{person.ordersCreated.length === 1 ? '' : 's'} ·{' '}
            {person.chatMessages} msg
          </span>
        </span>
        <span className="arow__badges">
          {person.timesSubmitted > 1 && (
            <span className="achip">RESUBMITTED ×{person.timesSubmitted}</span>
          )}
          {person.hasAadhaar ? (
            <span className="achip achip--is-done">AADHAAR</span>
          ) : (
            <span className="achip achip--stuck">NO AADHAAR</span>
          )}
          {person.verificationChanges > 1 && (
            <span className="achip">STATUS CHANGED ×{person.verificationChanges}</span>
          )}
        </span>
      </button>

      {open && (
        <div className="arow__body">
          <dl className="adgrid">
            <div><dt>Submitted</dt><dd>{when(person.submittedAt)}</dd></div>
            <div>
              <dt>Verified</dt>
              <dd>
                {person.verifiedAt ? when(person.verifiedAt) : 'never'}
                {person.verified && person.submittedAt && (
                  <span className="adimplied"> ({lag(person.submittedAt, person.firstVerifiedAt ?? person.verifiedAt)})</span>
                )}
              </dd>
            </div>
            <div><dt>Mobile</dt><dd className="admono">{person.mobile || '—'}</dd></div>
            <div><dt>Email</dt><dd>{person.email || '—'}</dd></div>
            <div><dt>PAN</dt><dd className="admono">{person.pan || '—'}</dd></div>
            <div><dt>Bank</dt><dd>{person.bankName || '—'}</dd></div>
          </dl>

          <div className="arow__actions">
            <button
              type="button"
              className="abtn abtn--sm"
              onClick={() => setDrawer(true)}
            >
              Full KYC record &amp; Aadhaar
            </button>
            <a
              className="alink"
              href={bscAddr(person.wallet) ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              BscScan
            </a>
          </div>

          {drawer && (
            <KycPanel
              address={person.wallet}
              record={ctx.kyc.get(person.wallet)}
              onClose={() => setDrawer(false)}
              extra={
                <PersonActivity person={person} ctx={ctx} onShowTrades={showTrades} />
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade, ctx, showTrades }: { trade: Trade; ctx: AuditCtx; showTrades: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const real = trade.screenshots.filter((s) => s.hasProof);

  return (
    <div className={`arow ${open ? 'is-open' : ''}`} id={`trade-${trade.id}`}>
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
                  <dd><Addr a={trade.seller} ctx={ctx} showTrades={showTrades} /></dd>
                </div>
                <div>
                  <dt>Buyer</dt>
                  <dd><Addr a={trade.buyer} ctx={ctx} showTrades={showTrades} /></dd>
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
                        by <Addr a={trade.releasedBy!} ctx={ctx} showTrades={showTrades} /><br />
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
                        <GatewayImage key={`${s.cid}-${s.block}`} cid={s.cid} alt="payment screenshot" />
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

function AdRow({ ad, ctx, showTrades }: { ad: Ad; ctx: AuditCtx; showTrades: (ids: number[]) => void }) {
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
                  <dd><Addr a={ad.creator} ctx={ctx} showTrades={showTrades} /></dd>
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
  const [tab, setTab] = useState<'trades' | 'ads' | 'people'>('trades');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [release, setRelease] = useState('');
  const [proof, setProof] = useState('any');
  const [filter, setFilter] = useState('');
  const [kycState, setKycState] = useState('');
  const [sortBy, setSortBy] = useState<'submitted' | 'verified' | 'activity'>('submitted');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Read-only access needs a verified wallet signature. Until the server has
  // issued a token there is nothing to fetch, and the request would be refused
  // anyway, so no attempt is made. That is deliberate: a 401 on every page load
  // would look like a broken site rather than a locked one.
  const { token, setToken, clearToken } = useAuditToken();
  const [locked, setLocked] = useState(false);

  const fetchIndex = useCallback(
    async (t: string) => {
      try {
        const r = await fetch(`/api/audit?token=${encodeURIComponent(t)}`, { cache: 'no-store' });
        const body = await r.json();
        if (r.status === 401) {
          // The token expired or the server restarted, which loses the
          // in-memory set. Drop it and show the gate again rather than an error.
          clearToken();
          setLocked(true);
          return;
        }
        if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
        setData(body);
        setError(null);
        setLocked(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [clearToken],
  );

  const load = useCallback(() => {
    if (!token) {
      setLocked(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchIndex(token);
  }, [token, fetchIndex]);

  useEffect(() => {
    if (token) void fetchIndex(token);
    else {
      setLocked(true);
      setLoading(false);
    }
  }, [token, fetchIndex]);

  // KYC keyed by wallet, so any address on the page resolves to its record in O(1)
  // and the drawer never has to fetch. Records come from public transaction
  // calldata, so this works with no wallet connected.
  const kycByWallet = useMemo(() => {
    const m = new Map<string, KycRecord>();
    for (const r of data?.kyc ?? []) m.set(r.wallet.toLowerCase(), r);
    return m;
  }, [data]);

  const people = useMemo(() => {
    const m = new Map<string, Person>();
    for (const r of data?.kyc ?? []) m.set(r.wallet.toLowerCase(), toPerson(r));
    return m;
  }, [data]);

  const ctx: AuditCtx = useMemo(
    () => ({
      kyc: kycByWallet,
      people,
      trades: data?.trades ?? [],
      ads: data?.ads ?? [],
    }),
    [kycByWallet, people, data],
  );

  // Jumping to one person's trades switches tab, clears filters that would hide
  // them, and pins the list to their trade ids until dismissed.
  const { ids: jumpIds, show: showTrades, clear: clearJump } = useTradeJump();

  useEffect(() => {
    if (jumpIds) {
      setTab('trades');
      setStatus('');
      setRelease('');
      setProof('any');
      setFilter('');
    }
  }, [jumpIds]);

  // Memoised because it feeds the rows useMemo: rebuilding the Set each render
  // would invalidate it every time and defeat the memo entirely.
  const pinned = useMemo(() => (jumpIds ? new Set(jumpIds) : null), [jumpIds]);

  const rows = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();

    if (tab === 'people') {
      // A numeric query is a trade or order id here, not a person, so searching
      // "12" should surface whoever was in trade #12 rather than nobody.
      const asId = /^\d+$/.test(needle) ? Number(needle) : null;
      const list = [...people.values()].filter((p) => {
        if (kycState === 'verified' && !p.verified) return false;
        if (kycState === 'unverified' && p.verified) return false;
        if (kycState === 'never-traded' && tradeCount(p) > 0) return false;
        if (kycState === 'traded' && tradeCount(p) === 0) return false;
        if (kycState === 'listed' && p.ordersCreated.length === 0) return false;
        if (kycState === 'resubmitted' && p.timesSubmitted < 2) return false;
        if (kycState === 'no-aadhaar' && p.hasAadhaar) return false;

        if (!needle) return true;
        if (asId !== null) {
          return (
            p.tradesAsSeller.includes(asId) ||
            p.tradesAsBuyer.includes(asId) ||
            p.ordersCreated.includes(asId)
          );
        }
        const kw: Record<string, (p: Person) => boolean> = {
          verified: (p) => p.verified,
          unverified: (p) => !p.verified,
          seller: (p) => p.tradesAsSeller.length > 0,
          buyer: (p) => p.tradesAsBuyer.length > 0,
          chat: (p) => p.chatMessages > 0,
          aadhaar: (p) => p.hasAadhaar,
          resubmitted: (p) => p.timesSubmitted > 1,
        };
        if (kw[needle]) return kw[needle](p);
        return [p.wallet, p.bankHolderName, p.email, p.mobile, p.pan, p.bankName]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });

      const time = (p: Person) =>
        sortBy === 'verified'
          ? (p.verifiedAt ?? '')
          : sortBy === 'activity'
            ? String(tradeCount(p)).padStart(6, '0')
            : (p.submittedAt ?? '');

      // Newest first by default: the people who just arrived are the ones being
      // reviewed. Entries with no timestamp sort last either way, so a missing
      // date never masquerades as the most recent.
      // Ties break by wallet in whichever direction is selected, so that
      // toggling the order gives a true mirror of the list. Breaking ties the
      // same way both times made people who submitted in the same second sit in
      // the same relative position regardless of the sort, which reads as the
      // control not working.
      const dir = sortOrder === 'asc' ? 1 : -1;
      list.sort((a, b) => {
        const ta = time(a);
        const tb = time(b);
        // Missing timestamps sort last in both directions. A record with no date
        // must never appear as the newest.
        if (!ta && !tb) return a.wallet.localeCompare(b.wallet) * dir;
        if (!ta) return 1;
        if (!tb) return -1;
        if (ta === tb) return a.wallet.localeCompare(b.wallet) * dir;
        return (ta < tb ? -1 : 1) * dir;
      });

      return list.map((p) => (
        <PersonRow key={p.wallet} person={p} ctx={ctx} showTrades={showTrades} />
      ));
    }

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
        .map((a) => <AdRow key={a.id} ad={a} ctx={ctx} showTrades={showTrades} />);
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
        // A jump pins the list to exactly those trades, so filters left over
        // from earlier browsing cannot silently hide them.
        if (pinned && !pinned.has(t.id)) return false;

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
          // A counterparty's name is what you search for when you know who you
          // are looking at but not which address they used.
          ...[t.seller, t.buyer, t.releasedBy]
            .filter(Boolean)
            .map((w) => people.get(String(w).toLowerCase())?.bankHolderName ?? ''),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (sortOrder === 'asc' ? 1 : -1) * (a.id - b.id))
      .map((t) => <TradeRow key={t.id} trade={t} ctx={ctx} showTrades={showTrades} />);
  }, [
    data, tab, q, status, release, proof, filter,
    people, ctx, kycState, sortBy, sortOrder, pinned, showTrades,
  ]);

  // Checked before loading, because the gate has nothing to do while a fetch
  // is in flight, and rendering it during the first paint would flash the lock
  // screen at someone who already signed in.
  if (locked) {
    return (
      <div className="fx-shell audit-root">
        <div className="audit-wrap">
          <AuditGate
            token={token}
            setToken={setToken}
            onUnlocked={(t) => {
              setLoading(true);
              void fetchIndex(t);
            }}
          />
        </div>
      </div>
    );
  }

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
          <Stat
            label="KYC verified"
            value={s.kyc.verified}
            sub={`${s.kyc.decoded} records · ${s.kyc.withAadhaarFront} with Aadhaar`}
          />
        </div>

        <div className="atabs">
          <button className={`atab ${tab === 'trades' ? 'is-active' : ''}`} onClick={() => setTab('trades')}>
            Trades <span className="atab__n">{data.trades.length}</span>
          </button>
          <button className={`atab ${tab === 'ads' ? 'is-active' : ''}`} onClick={() => setTab('ads')}>
            Orders <span className="atab__n">{data.ads.length}</span>
          </button>
          <button
            className={`atab ${tab === 'people' ? 'is-active' : ''}`}
            onClick={() => setTab('people')}
          >
            Verified users <span className="atab__n">{data.kyc.length}</span>
          </button>
        </div>

        <div id="anchor-trades" />

        <div className="actl">
          {pinned && (
            <>
              <span className="ajump">
                Showing {pinned.size} trade{pinned.size === 1 ? '' : 's'} from one person
              </span>
              <button className="abtn abtn--sm" onClick={clearJump}>
                Show all trades
              </button>
            </>
          )}
          <input
            type="search"
            className="ainput"
            placeholder={
              tab === 'people'
                ? 'Search name, email, mobile, PAN, wallet, or a trade id…'
                : 'Search id, wallet, name, chat text, CID…'
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {tab === 'people' && (
            <>
              <select className="ainput" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="submitted">Sort by submission date</option>
                <option value="verified">Sort by verification date</option>
                <option value="activity">Sort by trade count</option>
              </select>
              <select className="ainput" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}>
                <option value="desc">Latest first</option>
                <option value="asc">Oldest first</option>
              </select>
              <select className="ainput" value={kycState} onChange={(e) => setKycState(e.target.value)}>
                <option value="">Every KYC state</option>
                <option value="verified">Verified only</option>
                <option value="unverified">Submitted, never verified</option>
                <option value="traded">Has traded</option>
                <option value="never-traded">Never traded</option>
                <option value="listed">Has listed an order</option>
                <option value="resubmitted">Resubmitted at least once</option>
                <option value="no-aadhaar">No Aadhaar image</option>
              </select>
            </>
          )}
          {tab === 'trades' && (
            <>
              <select className="ainput" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}>
                <option value="desc">Latest first</option>
                <option value="asc">Oldest first</option>
              </select>
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
