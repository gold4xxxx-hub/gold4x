'use client';

// KYC application form. Submits on-chain, which means every field here is
// written to public storage permanently and is readable by anyone who knows
// the wallet. See the note below the form.

import React, { useEffect, useState } from 'react';
import type { Signer } from 'ethers';
import { submitKyc, getStoredKyc } from '@/hooks/useP2PEscrow';
import DocumentUpload from './DocumentUpload';

type Props = {
  signer: Signer | null;
  submitted: boolean;
  verified: boolean;
  onDone: () => void;
};

const EMPTY = {
  bankHolderName: '',
  bankAccountNumber: '',
  ifscCode: '',
  bankName: '',
  aadharFrontHash: '',
  aadharBackHash: '',
  mobile: '',
  email: '',
  pan: '',
};

const KYC_LABELS: Record<keyof typeof EMPTY, string> = {
  bankHolderName: 'Bank holder name',
  bankAccountNumber: 'Bank account number',
  ifscCode: 'IFSC code',
  bankName: 'Bank name',
  aadharFrontHash: 'Aadhaar front',
  aadharBackHash: 'Aadhaar back',
  mobile: 'Mobile',
  email: 'Email',
  pan: 'PAN',
};

// The Aadhaar fields take an image upload rather than typed text.
const DOCUMENT_FIELDS = ['aadharFrontHash', 'aadharBackHash'] as const;

export default function KycPanel({ signer, submitted, verified, onDone }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Prefill from storage so correcting one field does not mean retyping all
  // nine. getStoredKyc() is party-scoped and returns null when nothing is on
  // file.
  useEffect(() => {
    if (!signer) return;
    let cancelled = false;
    signer
      .getAddress()
      .then((address: string) => getStoredKyc(address))
      .then((existing) => {
        if (cancelled || !existing) return;
        setForm(existing.draft);
      })
      .catch(() => {
        // No stored KYC, or the read failed. Start from blank either way.
      });
    return () => {
      cancelled = true;
    };
  }, [signer]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signer) return setError('Connect a wallet first.');
    setBusy(true);
    setError(null);
    try {
      await submitKyc(signer, form, submitted);
      setOk(true);
      onDone();
    } catch (err) {
      const e = err as { shortMessage?: string; reason?: string; message?: string };
      setError(e?.shortMessage || e?.reason || e?.message || 'KYC submission failed.');
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <div className="p2p-panel p-5">
        <div className="p2p-tile__label mb-2">KYC</div>
        <p className="text-sm text-[#b9b0a3]">
          Your KYC is verified. You can post ads and take trades.
        </p>
      </div>
    );
  }

  return (
    <div className="p2p-panel p-5">
      <div className="p2p-tile__label mb-2">KYC required</div>
      <p className="text-sm text-[#b9b0a3] mb-4">
        {submitted
          ? 'Your application is pending owner review. You can update the details below while it is pending.'
          : 'Submit your details to enable trading. An owner must verify the application before you can post ads.'}
      </p>

      <div className="p2p-kyc-banner mb-4">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flexShrink: 0 }}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="11" r="2" />
          <path d="M5 17c1.5-2 3-3 4-3s2.5 1 4 3" />
        </svg>
        <span>
          Aadhaar images upload to a private link. Only the link is stored on-chain.
        </span>
      </div>

      <form onSubmit={onSubmit} className="p2p-kyc-fields">
        {(Object.keys(form) as (keyof typeof EMPTY)[]).map((k) =>
          (DOCUMENT_FIELDS as readonly string[]).includes(k) ? (
            <div key={k}>
              <DocumentUpload
                id={`kyc-${k}`}
                label={KYC_LABELS[k]}
                value={form[k]}
                onChange={(cid) => setForm((f) => ({ ...f, [k]: cid }))}
              />
            </div>
          ) : (
            <div key={k} className="p2p-field">
              <label className="p2p-label" htmlFor={`kyc-${k}`}>
                {KYC_LABELS[k]}
              </label>
              <input
                id={`kyc-${k}`}
                required
                className="p2p-input"
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              />
            </div>
          ),
        )}
        <div className="md:col-span-2">
          <button type="submit" className="p2p-btn" disabled={busy}>
            <span>{busy ? 'Submitting…' : submitted ? 'Update KYC' : 'Submit KYC'}</span>
          </button>
        </div>
      </form>

      {error && <div className="p2p-alert p2p-alert--error mt-4">{error}</div>}
      {ok && !error && (
        <div className="p2p-alert p2p-alert--warn mt-4">
          Submitted. Waiting for owner verification.
        </div>
      )}
    </div>
  );
}
