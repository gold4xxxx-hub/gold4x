'use client';

// KYC application form. Submits on-chain, which means every field here is
// written to public storage permanently and is readable by anyone who knows
// the wallet. See the note below the form.

import React, { useEffect, useState } from 'react';
import type { Signer } from 'ethers';
import { submitKyc, getStoredKyc } from '@/hooks/useP2PEscrow';

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
  aadharFrontHash: 'Aadhaar front (IPFS hash)',
  aadharBackHash: 'Aadhaar back (IPFS hash)',
  mobile: 'Mobile',
  email: 'Email',
  pan: 'PAN',
};

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

      <form onSubmit={onSubmit} className="p2p-kyc-fields">
        {(Object.keys(form) as (keyof typeof EMPTY)[]).map((k) => (
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
        ))}
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
