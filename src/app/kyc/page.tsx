'use client';

import { useEffect, useMemo, useState } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { useWalletConnection } from '@/hooks/useWalletConnection';

type KycStatus = 'pending' | 'approved' | 'rejected';

type KycRecord = {
  wallet: string;
  fullName: string;
  email: string;
  mobileNo: string;
  bankAccountName: string;
  bankName: string;
  maskedAccountNumber: string;
  bankIfscSwift: string;
  bankBranch: string;
  hasIdFront: boolean;
  hasIdBack: boolean;
  hasPan: boolean;
  hasBankStatement: boolean;
  idFrontName: string;
  idBackName: string;
  panName: string;
  bankStatementName: string;
  status: KycStatus;
  reference: string;
  createdAt: string;
  updatedAt: string;
};

const INITIAL_FORM = {
  fullName: '',
  email: '',
  mobileNo: '',
  bankAccountName: '',
  bankName: '',
  bankAccountNumber: '',
  bankIfscSwift: '',
  bankBranch: '',
};

function statusLabel(status: KycStatus | null): string {
  if (!status) return 'Not Submitted';
  if (status === 'pending') return 'Pending Review';
  if (status === 'approved') return 'Approved';
  return 'Rejected';
}

export default function KycPage() {
  const { isConnected, address } = useWalletConnection();
  const [form, setForm] = useState(INITIAL_FORM);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [panFile, setPanFile] = useState<File | null>(null);
  const [bankStatementFile, setBankStatementFile] = useState<File | null>(null);
  const [record, setRecord] = useState<KycRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentStatus = useMemo(() => statusLabel(record?.status ?? null), [record]);

  useEffect(() => {
    const loadStatus = async () => {
      if (!isConnected || !address) {
        setRecord(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/kyc/status/${address}`);
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json?.error || 'Unable to load KYC status');
        }

        const nextRecord = json?.record as KycRecord | null;
        setRecord(nextRecord || null);
        if (nextRecord) {
          setForm({
            fullName: nextRecord.fullName || '',
            email: nextRecord.email || '',
            mobileNo: nextRecord.mobileNo || '',
            bankAccountName: nextRecord.bankAccountName || '',
            bankName: nextRecord.bankName || '',
            bankAccountNumber: '',
            bankIfscSwift: nextRecord.bankIfscSwift || '',
            bankBranch: nextRecord.bankBranch || '',
          });
        } else {
          setForm(INITIAL_FORM);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unable to load KYC status';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    loadStatus();
  }, [isConnected, address]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      setError('Connect your wallet to submit KYC.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (!idFrontFile || !idBackFile || !panFile || !bankStatementFile) {
        throw new Error('All four document uploads are required.');
      }

      const payload = new FormData();
      payload.append('wallet', address);
      payload.append('fullName', form.fullName);
      payload.append('email', form.email);
      payload.append('mobileNo', form.mobileNo);
      payload.append('bankAccountName', form.bankAccountName);
      payload.append('bankName', form.bankName);
      payload.append('bankAccountNumber', form.bankAccountNumber);
      payload.append('bankIfscSwift', form.bankIfscSwift);
      payload.append('bankBranch', form.bankBranch);
      payload.append('idFrontFile', idFrontFile);
      payload.append('idBackFile', idBackFile);
      payload.append('panFile', panFile);
      payload.append('bankStatementFile', bankStatementFile);

      const response = await fetch('/api/kyc/submit', {
        method: 'POST',
        body: payload,
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'KYC submission failed');
      }

      const nextRecord = json?.record as KycRecord;
      setRecord(nextRecord);
      setSuccess(`KYC submitted successfully. Reference: ${nextRecord.reference}`);
      setIdFrontFile(null);
      setIdBackFile(null);
      setPanFile(null);
      setBankStatementFile(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'KYC submission failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fx-shell">
      <main className="max-w-4xl mx-auto space-y-6">
        <div className="fx-card p-6 fx-reveal">
          <h1 className="fx-section-title text-3xl">KYC Verification</h1>
          <p className="text-sm text-[#b9b0a3] mt-2">
            Submit mobile number and required documents for verification.
          </p>
        </div>

        {!isConnected && (
          <div className="fx-card fx-card--lift p-6 space-y-4 text-sm text-[#b9b0a3]">
            <div className="fx-kicker">Wallet Required</div>
            <p>Connect your wallet to submit and track KYC status.</p>
            <div className="flex justify-start">
              <WalletConnect />
            </div>
          </div>
        )}

        {isConnected && (
          <>
            <div className="fx-card p-6 space-y-3 text-sm">
              <div className="fx-kicker">Current Status</div>
              <p className="text-[#b9b0a3]">Wallet: <span className="gold-text">{address}</span></p>
              <p className="text-[#b9b0a3]">
                Status: <span className="gold-text">{loading ? 'Loading...' : currentStatus}</span>
              </p>
              {record?.reference && (
                <p className="text-[#b9b0a3]">Reference: <span className="gold-text">{record.reference}</span></p>
              )}
              {record && (
                <>
                  <p className="text-[#b9b0a3]">Name: <span className="gold-text">{record.fullName}</span></p>
                  <p className="text-[#b9b0a3]">Email: <span className="gold-text">{record.email}</span></p>
                  <p className="text-[#b9b0a3]">Mobile: <span className="gold-text">{record.mobileNo}</span></p>
                  <p className="text-[#b9b0a3]">Bank: <span className="gold-text">{record.bankName}</span></p>
                  <p className="text-[#b9b0a3]">Account No: <span className="gold-text">{record.maskedAccountNumber}</span></p>
                </>
              )}
              {record?.reference && (
                <div className="text-[#b9b0a3] space-y-1">
                  <p>
                    ID Front:{' '}
                    <a href={`/api/kyc/document/${record.reference}/?kind=idFront`} target="_blank" rel="noopener noreferrer">{record.idFrontName || 'View'}</a>
                  </p>
                  <p>
                    ID Back:{' '}
                    <a href={`/api/kyc/document/${record.reference}/?kind=idBack`} target="_blank" rel="noopener noreferrer">{record.idBackName || 'View'}</a>
                  </p>
                  <p>
                    PAN:{' '}
                    <a href={`/api/kyc/document/${record.reference}/?kind=pan`} target="_blank" rel="noopener noreferrer">{record.panName || 'View'}</a>
                  </p>
                  <p>
                    Bank Statement:{' '}
                    <a href={`/api/kyc/document/${record.reference}/?kind=bankStatement`} target="_blank" rel="noopener noreferrer">{record.bankStatementName || 'View'}</a>
                  </p>
                </div>
              )}
            </div>

            <form className="fx-card p-6 space-y-4" onSubmit={onSubmit}>
              <div className="fx-kicker">Personal Details</div>

              <input
                className="fx-input"
                placeholder="Full Name"
                value={form.fullName}
                onChange={(e) => setForm((s) => ({ ...s, fullName: e.target.value }))}
                disabled={saving}
              />

              <input
                className="fx-input"
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                disabled={saving}
              />

              <input
                className="fx-input"
                placeholder="Mobile Number"
                value={form.mobileNo}
                onChange={(e) => setForm((s) => ({ ...s, mobileNo: e.target.value }))}
                disabled={saving}
              />

              <div className="fx-kicker">Bank Details</div>

              <input
                className="fx-input"
                placeholder="Account Holder Name"
                value={form.bankAccountName}
                onChange={(e) => setForm((s) => ({ ...s, bankAccountName: e.target.value }))}
                disabled={saving}
              />

              <input
                className="fx-input"
                placeholder="Bank Name"
                value={form.bankName}
                onChange={(e) => setForm((s) => ({ ...s, bankName: e.target.value }))}
                disabled={saving}
              />

              <input
                className="fx-input"
                placeholder="Account Number"
                value={form.bankAccountNumber}
                onChange={(e) => setForm((s) => ({ ...s, bankAccountNumber: e.target.value }))}
                disabled={saving}
              />

              <input
                className="fx-input"
                placeholder="IFSC / SWIFT Code"
                value={form.bankIfscSwift}
                onChange={(e) => setForm((s) => ({ ...s, bankIfscSwift: e.target.value }))}
                disabled={saving}
              />

              <input
                className="fx-input"
                placeholder="Branch Name"
                value={form.bankBranch}
                onChange={(e) => setForm((s) => ({ ...s, bankBranch: e.target.value }))}
                disabled={saving}
              />

              <div className="fx-kicker">Document Uploads</div>

              <div className="space-y-2">
                <div className="fx-kicker">ID Front Page Upload</div>
                <input
                  className="fx-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setIdFrontFile(e.target.files?.[0] || null)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <div className="fx-kicker">ID Back Page Upload</div>
                <input
                  className="fx-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setIdBackFile(e.target.files?.[0] || null)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <div className="fx-kicker">PAN Upload</div>
                <input
                  className="fx-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setPanFile(e.target.files?.[0] || null)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <div className="fx-kicker">Bank Statement Upload</div>
                <input
                  className="fx-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setBankStatementFile(e.target.files?.[0] || null)}
                  disabled={saving}
                />
              </div>

              {error && <div className="fx-alert fx-alert--error text-sm">{error}</div>}
              {success && <div className="fx-alert fx-alert--success text-sm">{success}</div>}

              <button className="fx-button" type="submit" disabled={saving}>
                {saving ? 'Submitting...' : 'Submit KYC'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}