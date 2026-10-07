'use client';

// KYC lookup for a single address, opened by clicking any address on the audit
// page.
//
// No wallet is required, and that is a correction rather than a shortcut.
//
// submitKYC and updateKYC take the whole KYC struct as a single tuple argument,
// so every field - name, bank account, IFSC, PAN, mobile, email and both Aadhaar
// CIDs - is written into the transaction input, which is public to everyone. The
// owner-only getters getKYCForAdmin and getKYCForAdmin2 are a second route to the
// same data, not the only one, and requiring the owner wallet to see a record that
// is already on-chain bought nothing.
//
// The index decodes those calls at build time. This panel only reads the result.

import { useEffect, useState, type ReactNode } from 'react';

export type KycRecord = {
  wallet: string;
  bankHolderName: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  aadharFrontHash: string;
  aadharBackHash: string;
  mobile: string;
  email: string;
  pan: string;
  submittedAt: string | null;
  updatedAt: string | null;
  lastCall: string;
  timesSubmitted: number;
  viaRouter: boolean;
  tx: string;
  block: number;
  verified: boolean;
  verifiedAt: string | null;
  firstVerifiedAt: string | null;
  verificationChanges: number;
  verifiedTx: string | null;
  tradesAsSeller: number[];
  tradesAsBuyer: number[];
  ordersCreated: number[];
  chatMessages: number;
};

const GATEWAYS = [
  (cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`,
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
];

const isCid = (v: string) => /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(v);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (iso?: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 19)} UTC` : '—');

/** How long it took to approve someone, in words rather than milliseconds. */
function gap(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min later`;
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours} h later`;
  return `${Math.round(ms / 86400000)} days later`;
}

/** One Aadhaar side. Falls back across gateways, then shows an explicit state. */
function DocImage({ hash, label }: { hash: string; label: string }) {
  // Remounting on a new hash is what resets the retry state, rather than an
  // effect: keying the element by CID gives a genuinely fresh component, which
  // also avoids a render pass showing the previous document's failure.
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!hash) {
    return (
      <div className="adoc adoc--empty">
        <span className="adoc__t">{label}</span>
        <span className="adoc__d">No reference stored</span>
      </div>
    );
  }
  if (!isCid(hash)) {
    // The contract requires a non-empty string, so a placeholder is written when
    // the applicant supplies no document. It is not a CID and must not be
    // rendered as an image.
    return (
      <div className="adoc adoc--empty">
        <span className="adoc__t">{label}</span>
        <span className="adoc__d">
          No document supplied — the contract stores <code>{hash}</code> as a
          placeholder.
        </span>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="adoc adoc--empty">
        <span className="adoc__t">{label}</span>
        <span className="adoc__d">Image could not be loaded from any gateway.</span>
        <a href={GATEWAYS[0](hash)} target="_blank" rel="noopener noreferrer">
          {hash}
        </a>
      </div>
    );
  }
  return (
    <div className="adoc">
      {/* A button, not the image itself, so it is keyboard reachable and can
          carry an accessible name. The 12-digit Aadhaar number is the smallest
          text on the card, so the thumbnail cannot be the only way to read it. */}
      <button
        type="button"
        className="adoc__zoom"
        onClick={() => window.open(GATEWAYS[0](hash), '_blank', 'noopener,noreferrer')}
        aria-label={`Open the ${label} Aadhaar document full size in a new tab`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={GATEWAYS[stage](hash)}
          alt={`${label} Aadhaar document`}
          onError={() => (stage + 1 < GATEWAYS.length ? setStage((s) => s + 1) : setFailed(true))}
        />
      </button>
      <span className="adoc__cap">
        {label} · <a href={GATEWAYS[0](hash)} target="_blank" rel="noopener noreferrer">{short(hash)}</a>
      </span>
    </div>
  );
}

/**
 * Optional extra section rendered under the KYC fields. Passed in rather than
 * imported, because the activity tables need the trade and order lists that the
 * page already holds, and re-fetching them here would duplicate that data.
 */
/**
 * One labelled field with a copy button.
 *
 * Declared outside the panel rather than inside it: a component defined during
 * render is a new type on every pass, so React unmounts and remounts it and
 * throws away its state each time.
 */
function Cell({
  k,
  label,
  detail,
  mono,
  copied,
  onCopy,
}: {
  k: keyof KycRecord;
  label: string;
  detail: KycRecord | null;
  mono?: boolean;
  copied: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <div>
      <dt>
        {label}
        <button
          type="button"
          className="adrawer__copy"
          onClick={() => onCopy(String(k), String(detail?.[k] ?? ''))}
          title="Copy"
        >
          {copied === String(k) ? 'copied' : 'copy'}
        </button>
      </dt>
      <dd className={mono ? 'admono' : undefined}>{detail?.[k] || '—'}</dd>
    </div>
  );
}

export function KycPanel({
  address,
  record,
  onClose,
  extra,
}: {
  address: string;
  record?: KycRecord;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const detail = record ?? null;
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1400);
    });
  };

  return (
    <div className="adrawer" role="dialog" aria-modal="true" aria-label="KYC record">
      <div className="adrawer__scrim" onClick={onClose} />
      <div className="adrawer__panel">
        <header className="adrawer__head">
          <div>
            <h2>KYC record</h2>
            <a
              className="adrawer__addr"
              href={`https://bscscan.com/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {address}
            </a>
          </div>
          <button type="button" className="adrawer__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {!detail && (
          <p className="adrawer__msg adrawer__msg--warn">
            No KYC submission found for this address. Either they never applied,
            or the transaction could not be read when the index was built.
          </p>
        )}

        {detail && (
          <>
            <div className="adrawer__badges">
              <span className={`achip ${detail.verified ? 'achip--is-done' : 'achip--is-closed'}`}>
                {detail.verified ? 'VERIFIED' : 'SUBMITTED — NOT VERIFIED'}
              </span>
              {detail.timesSubmitted > 1 && (
                <span className="achip">
                  RESUBMITTED ×{detail.timesSubmitted}
                </span>
              )}
              {detail.viaRouter && <span className="achip">VIA ROUTER</span>}
            </div>

            <dl className="adgrid">
              <Cell k="bankHolderName" label="Name" detail={detail} copied={copied} onCopy={copy} />
              <Cell k="mobile" label="Mobile" mono detail={detail} copied={copied} onCopy={copy} />
              <Cell k="email" label="Email" detail={detail} copied={copied} onCopy={copy} />
              <Cell k="pan" label="PAN" mono detail={detail} copied={copied} onCopy={copy} />
              <Cell k="bankName" label="Bank" detail={detail} copied={copied} onCopy={copy} />
              <Cell k="bankAccountNumber" label="Account" mono detail={detail} copied={copied} onCopy={copy} />
              <Cell k="ifscCode" label="IFSC" mono detail={detail} copied={copied} onCopy={copy} />
              <div>
                <dt>Submitted</dt>
                <dd>{when(detail.submittedAt)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{detail.updatedAt ? when(detail.updatedAt) : 'never'}</dd>
              </div>
              <div>
                <dt>Verified</dt>
                <dd>
                  {detail.verifiedAt ? (
                    <>
                      {when(detail.verifiedAt)}
                      {detail.verified && detail.submittedAt && (
                        <span className="adimplied">
                          {' '}
                          ({gap(detail.submittedAt, detail.firstVerifiedAt ?? detail.verifiedAt)})
                        </span>
                      )}
                    </>
                  ) : (
                    'never'
                  )}
                </dd>
              </div>
              <div>
                <dt>Times submitted</dt>
                <dd>{detail.timesSubmitted}</dd>
              </div>
            </dl>

            <h3 className="adrawer__h3">Activity</h3>
            <dl className="adgrid">
              <div>
                <dt>Sold in</dt>
                <dd>{detail.tradesAsSeller.length ? detail.tradesAsSeller.map((t) => `#${t}`).join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Bought in</dt>
                <dd>{detail.tradesAsBuyer.length ? detail.tradesAsBuyer.map((t) => `#${t}`).join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Orders created</dt>
                <dd>{detail.ordersCreated.length ? detail.ordersCreated.map((o) => `#${o}`).join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Chat messages</dt>
                <dd>{detail.chatMessages}</dd>
              </div>
            </dl>

            <h3 className="adrawer__h3">Aadhaar documents</h3>
            <div className="adrawer__docs">
              <DocImage key={`front-${detail.aadharFrontHash}`} hash={detail.aadharFrontHash} label="Front" />
              <DocImage key={`back-${detail.aadharBackHash}`} hash={detail.aadharBackHash} label="Back" />
            </div>
            <p className="adrawer__note">
              Read from{' '}
              <a href={`https://bscscan.com/tx/${detail.tx}`} target="_blank" rel="noopener noreferrer">
                tx {detail.tx.slice(0, 10)}…
              </a>{' '}
              at block {detail.block}. No wallet needed: the fields sit in public
              transaction calldata, and only the document CIDs go to IPFS.
            </p>

            {extra}
          </>
        )}
      </div>
    </div>
  );
}
