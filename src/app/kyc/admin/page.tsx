'use client';

import { useState } from 'react';

type KycEntry = {
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
  status: 'pending' | 'approved' | 'rejected';
  reference: string;
  createdAt: string;
  updatedAt: string;
};

export default function KycAdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [entries, setEntries] = useState<KycEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingRef, setActionLoadingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadPending = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/kyc/admin/pending/?key=${encodeURIComponent(adminKey)}`);
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Unable to load pending KYC entries');
      }

      setEntries((json?.entries || []) as KycEntry[]);
      setLoaded(true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unable to load pending KYC entries';
      setError(message);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (reference: string, status: 'approved' | 'rejected') => {
    setActionLoadingRef(reference);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/kyc/admin/status/?key=${encodeURIComponent(adminKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, status }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Unable to update KYC status');
      }

      setEntries((prev) => prev.filter((item) => item.reference !== reference));
      setSuccess(`KYC ${reference} marked as ${status}.`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unable to update KYC status';
      setError(message);
    } finally {
      setActionLoadingRef(null);
    }
  };

  return (
    <div className="fx-shell">
      <main className="max-w-6xl mx-auto space-y-6">
        <div className="fx-card p-6 fx-reveal">
          <h1 className="fx-section-title text-3xl">KYC Admin</h1>
          <p className="text-sm text-[#b9b0a3] mt-2">View pending KYC submissions.</p>
        </div>

        <div className="fx-card p-6 space-y-4">
          <div className="fx-kicker">Access</div>
          <input
            className="fx-input"
            type="password"
            placeholder="Admin key"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            disabled={loading}
          />
          <button className="fx-button" onClick={loadPending} disabled={loading || !adminKey.trim()}>
            {loading ? 'Loading...' : 'Load Pending KYC'}
          </button>
          <p className="text-xs text-[#8a8896]">
            Default key: <span className="gold-text">0xf7252055eA263770817Dd73363A3259DEDAe9050</span>. Set env <span className="gold-text">KYC_ADMIN_KEY</span> to override.
          </p>
          {error && <div className="fx-alert fx-alert--error text-sm">{error}</div>}
          {success && <div className="fx-alert fx-alert--success text-sm">{success}</div>}
        </div>

        {loaded && (
          <div className="space-y-4">
            <div className="fx-card p-4 text-sm text-[#b9b0a3]">
              Pending entries: <span className="gold-text">{entries.length}</span>
            </div>

            {entries.length === 0 ? (
              <div className="fx-card p-6 text-sm text-[#b9b0a3]">No pending KYC entries.</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.reference} className="fx-card p-6 space-y-3 text-sm text-[#b9b0a3]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="fx-kicker">{entry.reference}</span>
                    <span className="fx-pill fx-pill--ghost">Pending</span>
                  </div>
                  <p>Wallet: <span className="gold-text">{entry.wallet}</span></p>
                  <p>Name: <span className="gold-text">{entry.fullName}</span></p>
                  <p>Email: <span className="gold-text">{entry.email}</span></p>
                  <p>Mobile No: <span className="gold-text">{entry.mobileNo}</span></p>
                  <p>Account Holder: <span className="gold-text">{entry.bankAccountName}</span></p>
                  <p>Bank: <span className="gold-text">{entry.bankName}</span></p>
                  <p>Account No: <span className="gold-text">{entry.maskedAccountNumber}</span></p>
                  <p>IFSC / SWIFT: <span className="gold-text">{entry.bankIfscSwift}</span></p>
                  <p>Branch: <span className="gold-text">{entry.bankBranch}</span></p>
                  <p>
                    ID Front: <a href={`/api/kyc/document/${entry.reference}/?kind=idFront`} target="_blank" rel="noopener noreferrer">{entry.idFrontName || 'Open'}</a>
                  </p>
                  <p>
                    ID Back: <a href={`/api/kyc/document/${entry.reference}/?kind=idBack`} target="_blank" rel="noopener noreferrer">{entry.idBackName || 'Open'}</a>
                  </p>
                  <p>
                    PAN: <a href={`/api/kyc/document/${entry.reference}/?kind=pan`} target="_blank" rel="noopener noreferrer">{entry.panName || 'Open'}</a>
                  </p>
                  <p>
                    Bank Statement: <a href={`/api/kyc/document/${entry.reference}/?kind=bankStatement`} target="_blank" rel="noopener noreferrer">{entry.bankStatementName || 'Open'}</a>
                  </p>
                  <p className="text-xs text-[#8a8896]">Submitted: {new Date(entry.createdAt).toLocaleString()}</p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      className="fx-button"
                      onClick={() => updateStatus(entry.reference, 'approved')}
                      disabled={actionLoadingRef === entry.reference || loading}
                    >
                      {actionLoadingRef === entry.reference ? 'Updating...' : 'Approve'}
                    </button>
                    <button
                      className="fx-button fx-button--dark"
                      onClick={() => updateStatus(entry.reference, 'rejected')}
                      disabled={actionLoadingRef === entry.reference || loading}
                    >
                      {actionLoadingRef === entry.reference ? 'Updating...' : 'Reject'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}