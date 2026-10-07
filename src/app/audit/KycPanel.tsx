'use client';

// KYC lookup for a single address, opened by clicking any address on the audit
// page.
//
// The contract's KYC details are only readable through getKYCForAdmin and
// getKYCForAdmin2, and both revert with "Not owner" unless msg.sender is the
// escrow owner. That is the right design for identity documents, so this panel
// asks for the owner's wallet rather than routing around the gate. Verified: a
// plain eth_call from an unowned key reverts on both getters.
//
// The KYC events only carry the wallet address, so there is no way to read this
// from the event log instead.

import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useAccount } from 'wagmi';

import { useEthersSigner } from '@/hooks/useEthersSigner';
import {
  P2PESCROW_CONTRACT_ADDRESS,
  P2PESCROW_CONTRACT_ABI,
  isP2pEscrowOwner,
} from '@/config/web3Config';

type Detail = {
  bankHolderName: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  aadharFrontHash: string;
  aadharBackHash: string;
  mobile: string;
  email: string;
  pan: string;
  submitted: boolean;
  verified: boolean;
};

const GATEWAYS = [
  (cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`,
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
];

const isCid = (v: string) => /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(v);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** One Aadhaar side. Falls back across gateways, then shows an explicit state. */
function DocImage({ hash, label }: { hash: string; label: string }) {
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStage(0);
    setFailed(false);
  }, [hash]);

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={GATEWAYS[stage](hash)}
        alt={`${label} Aadhaar document`}
        onError={() => (stage + 1 < GATEWAYS.length ? setStage((s) => s + 1) : setFailed(true))}
      />
      <span className="adoc__cap">
        {label} · <a href={GATEWAYS[0](hash)} target="_blank" rel="noopener noreferrer">{short(hash)}</a>
      </span>
    </div>
  );
}

export function KycPanel({
  address,
  onClose,
}: {
  address: string;
  onClose: () => void;
}) {
  const { signer } = useEthersSigner();
  const { address: connected, isConnected } = useAccount();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The getters are onlyOwner, so the read only succeeds from the owner wallet.
  const ownerOk = isP2pEscrowOwner(connected);

  const load = useCallback(async () => {
    if (!signer) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const c = new ethers.Contract(
        P2PESCROW_CONTRACT_ADDRESS,
        P2PESCROW_CONTRACT_ABI,
        signer,
      );
      const [a, b] = await Promise.all([
        c.getKYCForAdmin(address),
        c.getKYCForAdmin2(address),
      ]);
      setDetail({
        bankHolderName: String(a[0]),
        bankAccountNumber: String(a[1]),
        ifscCode: String(a[2]),
        bankName: String(a[3]),
        aadharFrontHash: String(a[4]),
        aadharBackHash: String(b[0]),
        mobile: String(b[1]),
        email: String(b[2]),
        pan: String(b[3]),
        submitted: Boolean(b[4]),
        verified: Boolean(b[5]),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /not owner/i.test(msg)
          ? 'The contract refused this read. Only the escrow owner wallet can view KYC records.'
          : /no kyc|empty/i.test(msg)
            ? 'This address has no KYC record on-chain.'
            : `Could not read KYC: ${msg.slice(0, 140)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [signer, address]);

  useEffect(() => {
    if (ownerOk) void load();
  }, [ownerOk, load]);

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

        {!isConnected && (
          <p className="adrawer__msg">
            Connect the escrow owner wallet to read this record. The contract
            rejects KYC reads from any other address.
          </p>
        )}
        {isConnected && !ownerOk && (
          <p className="adrawer__msg adrawer__msg--warn">
            Connected as <code>{connected ? short(connected) : 'unknown'}</code>, which is not
            the escrow owner. The contract will refuse this read.
          </p>
        )}
        {error && <p className="adrawer__msg adrawer__msg--warn">{error}</p>}
        {busy && <p className="adrawer__msg">Reading from BSC…</p>}

        {detail && (
          <>
            <div className="adrawer__badges">
              <span className={`achip ${detail.verified ? 'achip--is-done' : 'achip--is-closed'}`}>
                {detail.verified ? 'VERIFIED' : detail.submitted ? 'SUBMITTED — NOT VERIFIED' : 'NO RECORD'}
              </span>
            </div>

            <dl className="adgrid">
              <div><dt>Name</dt><dd>{detail.bankHolderName || '—'}</dd></div>
              <div><dt>Mobile</dt><dd>{detail.mobile || '—'}</dd></div>
              <div><dt>Email</dt><dd>{detail.email || '—'}</dd></div>
              <div><dt>PAN</dt><dd>{detail.pan || '—'}</dd></div>
              <div><dt>Bank</dt><dd>{detail.bankName || '—'}</dd></div>
              <div><dt>Account</dt><dd>{detail.bankAccountNumber || '—'}</dd></div>
              <div><dt>IFSC</dt><dd>{detail.ifscCode || '—'}</dd></div>
            </dl>

            <h3 className="adrawer__h3">Aadhaar documents</h3>
            <div className="adrawer__docs">
              <DocImage hash={detail.aadharFrontHash} label="Front" />
              <DocImage hash={detail.aadharBackHash} label="Back" />
            </div>
            <p className="adrawer__note">
              These fields are stored as plaintext in a public BSC transaction and
              are permanently readable by anyone. Only the document CID goes to
              IPFS.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
