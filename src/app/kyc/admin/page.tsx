'use client';

// KYC approvals, driven entirely by the verified P2PEscrow contract.
//
// The contract has no list-submissions getter, so pending applicants are
// discovered by reading KYCSubmitted events. Approval calls verifyKYC, which
// is what releases the onlyVerifiedKYC gate on createAd and startTrade.
//
// The previous version listed an in-memory Map, so approvals here did nothing
// to the trading desk. That path has been removed.

import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import {
  P2PESCROW_CONTRACT_ADDRESS,
  P2PESCROW_CONTRACT_ABI,
  isP2pEscrowOwner,
} from '@/config/web3Config';
import { useEthersSigner } from '@/hooks/useEthersSigner';
import { getKycApplicants, type KycApplicant } from '@/lib/p2pLogs';
import { shortAddress } from '@/config/p2pEscrow';
import '../../p2p/p2p.css';

/** Kept in step with the shared log reader's window. */
const LOG_WINDOW = 5_000;

// BSC produces a block roughly every 0.45s, so the window above is only about
// 37 minutes of history. That is the practical limit of a list built from
// eth_getLogs on a public node: it will not show older applicants, which is
// why the manual wallet lookup exists and is the reliable path.
const SECONDS_PER_BLOCK = 0.45;

export default function KycAdminPage() {
  const { address, isConnected, signer } = useEthersSigner();
  const { connect: connectWallet } = useConnect();

  const [applicants, setApplicants] = useState<KycApplicant[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, string> | null>(null);
  const [detailWallet, setDetailWallet] = useState<string | null>(null);
  const [manualWallet, setManualWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busyWallet, setBusyWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const isOwner = isP2pEscrowOwner(address);

  // The event list only covers a short window (see LOG_WINDOW below), so
  // looking an applicant up by wallet is the reliable path. It calls the
  // contract directly, which needs no log query at all.
  const lookupManual = async () => {
    const value = manualWallet.trim();
    if (!value) return;
    if (!ethers.isAddress(value)) {
      setError('That is not a valid wallet address.');
      return;
    }
    setError(null);
    await openDetail(ethers.getAddress(value));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Delegates to the shared log reader, which serialises eth_getLogs. Two
      // concurrent queries here made the public node return "could not
      // coalesce error".
      const { applicants, truncated } = await getKycApplicants();
      setApplicants(applicants);
      setStatus(
        applicants.length === 0
          ? 'No submissions in the last ' +
            `${LOG_WINDOW.toLocaleString()} blocks, which is roughly ` +
            `${Math.round((LOG_WINDOW * SECONDS_PER_BLOCK) / 60)} minutes of BSC history. ` +
            'If someone applied earlier than that, look them up by wallet below.'
          : `Showing ${applicants.length} from the last ` +
            `${LOG_WINDOW.toLocaleString()} blocks.` +
            (truncated ? ' Older submissions may not be listed.' : ''),
      );
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err?.shortMessage || err?.message || 'Could not read KYC events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Full record for one applicant. owner-gated on-chain.
  const openDetail = async (wallet: string) => {
    if (!signer) {
      setError('Connect the owner wallet to read applicant details.');
      return;
    }
    setBusyWallet(wallet);
    setDetail(null);
    try {
      const c = new ethers.Contract(
        P2PESCROW_CONTRACT_ADDRESS,
        P2PESCROW_CONTRACT_ABI,
        signer,
      );
      const [a, b] = await Promise.all([
        c.getKYCForAdmin(wallet),
        c.getKYCForAdmin2(wallet),
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
        submitted: String(b[4]),
        verified: String(b[5]),
        updatedAt: String(b[6]),
      });
      setDetailWallet(wallet);
      setExpanded(wallet);
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setDetail(null);
      setExpanded(null);
      setError(
        err?.shortMessage ||
          err?.message ||
          'Could not read that applicant. If they have not submitted KYC, the contract rejects the read.',
      );
    } finally {
      setBusyWallet(null);
    }
  };

  const setVerified = async (wallet: string, next: boolean) => {
    if (!signer) {
      setError('Connect the owner wallet to approve or reject.');
      return;
    }
    setBusyWallet(wallet);
    setError(null);
    try {
      const c = new ethers.Contract(
        P2PESCROW_CONTRACT_ADDRESS,
        P2PESCROW_CONTRACT_ABI,
        signer,
      );
      await (await c.verifyKYC(wallet, next)).wait();
      setStatus(
        `${shortAddress(wallet)} ${next ? 'approved' : 'rejected'} on-chain. ` +
          'They can trade immediately if approved.',
      );
      // Refresh the event list, but keep the panel open so the result is
      // visible. A user found by manual lookup will not appear in the list.
      await load();
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err?.shortMessage || err?.message || 'Transaction failed.');
    } finally {
      setBusyWallet(null);
    }
  };

  // Matches the main page's golden button exactly: construct the injected
  // connector directly with injected() rather than looking it up in the
  // connectors array. Looking it up depends on EIP-6963 discovery having
  // already finished, which it often has not on first paint, so the old button
  // found nothing and did nothing.
  //
  // injected() also works inside SafePal's in-app browser, which injects
  // window.ethereum. RainbowKit's ConnectButton was the wrong tool here: it
  // opens a wallet-picker modal asking which wallet to use, which is
  // pointless when the visitor is already inside a wallet browser.
  const handleConnect = () => {
    setError(null);
    connectWallet(
      { connector: injected() },
      {
        onSuccess: () => setConnecting(false),
        onError: (e: Error) => {
          setConnecting(false);
          setError(
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

  const walletConnect = (
    <button
      type="button"
      className="p2p-btn"
      onClick={handleConnect}
      disabled={connecting}
    >
      <span>{connecting ? 'Connecting…' : 'Connect Wallet'}</span>
    </button>
  );

  return (
    <div className="fx-shell p2p-root">
      <div className="p2p-ambient" aria-hidden="true">
        <div className="p2p-ambient__orb p2p-ambient__orb--gold" />
        <div className="p2p-ambient__orb p2p-ambient__orb--emerald" />
        <div className="p2p-ambient__grid" />
      </div>

      <div className="max-w-4xl mx-auto space-y-6 relative">
        <header className="p2p-hero p-6 sm:p-8">
          <div className="p2p-hero__inner">
            <div className="flex items-center gap-2 mb-4">
              <span className="p2p-chip p2p-chip--muted">Owner only</span>
            </div>
            <h1 className="p2p-hero__title text-3xl sm:text-4xl">KYC Approvals</h1>
            <p className="text-sm text-[#b9b0a3] mt-3 max-w-2xl">
              Applicants are read from on-chain events. Approving calls
              verifyKYC, which is what unlocks trading on the P2P desk.
            </p>
          </div>
        </header>

        {!isConnected && (
          <div className="p2p-panel p-6">
            <div className="p2p-tile__label mb-2">Owner wallet required</div>
            <p className="text-sm text-[#b9b0a3] mb-4">
              Connect the owner wallet to review applicants. Reading is open,
              but approving is restricted to the contract owner.
            </p>
            {walletConnect}
          </div>
        )}

        {isConnected && address && !isOwner && (
          <div className="p2p-alert p2p-alert--warn">
            <span className="p2p-dot" style={{ marginTop: 6 }} />
            Connected as {shortAddress(address)}, which is not the contract
            owner. You can read the list, but approve and reject will revert.
          </div>
        )}

        {error && <div className="p2p-alert p2p-alert--error">{error}</div>}
        {status && <div className="p2p-alert p2p-alert--info">{status}</div>}

        {/* Reliable path. The event list can only cover a short window, so
            looking a wallet up directly always works: it calls the contract
            rather than scanning for events. */}
        <section className="p2p-panel p-6">
          <div className="p2p-panel__head">
            <h2 className="p2p-panel__title">Look up an applicant</h2>
            <span className="p2p-panel__count">any wallet, any age</span>
          </div>
          <p className="text-sm text-[#b9b0a3] mb-4">
            Paste the applicant&apos;s wallet address. This reads their record
            straight from the contract, so it works even if their submission is
            older than the list below.
          </p>
          <div className="flex gap-2">
            <input
              className="p2p-input flex-1"
              placeholder="0x…"
              aria-label="Applicant wallet address"
              value={manualWallet}
              onChange={(e) => setManualWallet(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookupManual();
              }}
            />
            <button
              className="p2p-btn"
              onClick={() => void lookupManual()}
              disabled={busyWallet === manualWallet.trim() || !manualWallet.trim()}
            >
              <span>Look up</span>
            </button>
          </div>
        </section>

        <section className="p2p-panel p-6">
          <div className="p2p-panel__head">
            <h2 className="p2p-panel__title">Applicants</h2>
            <div className="flex items-center gap-3">
              <span className="p2p-panel__count">{applicants.length} found</span>
              <button className="p2p-btn p2p-btn--sm p2p-btn--ghost" onClick={() => void load()} disabled={loading}>
                <span>{loading ? 'Loading…' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {applicants.length === 0 ? (
            <div className="p2p-empty">
              <div className="p2p-empty__ring">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4l3 2" />
                </svg>
              </div>
              <p className="p2p-empty__text">
                {loading
                  ? 'Reading events from chain…'
                  : 'No KYC submissions in the recent block window. Once a user submits, a transaction will appear here.'}
              </p>
            </div>
          ) : (
            <div className="p2p-table-wrap">
              <table className="p2p-table">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Status</th>
                    <th>Block</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {applicants.map((a) => (
                    <tr key={a.wallet}>
                      <td className="p2p-addr">{a.wallet}</td>
                      <td className="text-center">
                        <span className={a.verified ? 'p2p-chip p2p-chip--open' : 'p2p-chip p2p-chip--paid'}>
                          {a.verified ? 'verified' : 'pending'}
                        </span>
                      </td>
                      <td className="p2p-num text-center">{a.submittedAt}</td>
                      <td className="text-center">
                        <div className="flex gap-2 justify-center">
                          <button
                            className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                            onClick={() => void openDetail(a.wallet)}
                            disabled={busyWallet === a.wallet}
                          >
                            <span>{busyWallet === a.wallet ? '…' : 'View'}</span>
                          </button>
                          {a.verified ? (
                            <button
                              className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                              onClick={() => void setVerified(a.wallet, false)}
                              disabled={busyWallet === a.wallet}
                            >
                              <span>Reject</span>
                            </button>
                          ) : (
                            <button
                              className="p2p-btn p2p-btn--sm"
                              onClick={() => void setVerified(a.wallet, true)}
                              disabled={busyWallet === a.wallet}
                            >
                              <span>Approve</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {expanded && detail && detailWallet && (
          <section className="p2p-panel p-6">
            <div className="p2p-panel__head">
              <h2 className="p2p-panel__title">Applicant detail</h2>
              <button className="p2p-btn p2p-btn--sm p2p-btn--ghost" onClick={() => { setExpanded(null); setDetail(null); setDetailWallet(null); }}>
                <span>Close</span>
              </button>
            </div>

            <div className="p2p-tiles">
              <div className="p2p-tile">
                <div className="p2p-tile__label">Status</div>
                <div className="p2p-tile__value">
                  {detail.verified === 'true' ? 'Verified' : 'Pending'}
                </div>
              </div>
              <div className="p2p-tile">
                <div className="p2p-tile__label">Actions</div>
                <div className="flex gap-2 mt-1">
                  {detail.verified === 'true' ? (
                    <button
                      className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                      onClick={() => void setVerified(detailWallet, false)}
                      disabled={busyWallet === detailWallet}
                    >
                      <span>Revoke verification</span>
                    </button>
                  ) : (
                    <button
                      className="p2p-btn p2p-btn--sm"
                      onClick={() => void setVerified(detailWallet, true)}
                      disabled={busyWallet === detailWallet}
                    >
                      <span>Approve</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <dl className="p2p-bank__grid">
              <dt>Wallet</dt>
              <dd>{detailWallet}</dd>
              <dt>Name</dt>
              <dd>{detail.bankHolderName || '—'}</dd>
              <dt>Bank</dt>
              <dd>{detail.bankName || '—'}</dd>
              <dt>Account</dt>
              <dd>{detail.bankAccountNumber || '—'}</dd>
              <dt>IFSC</dt>
              <dd>{detail.ifscCode || '—'}</dd>
              <dt>Mobile</dt>
              <dd>{detail.mobile || '—'}</dd>
              <dt>Email</dt>
              <dd>{detail.email || '—'}</dd>
              <dt>PAN</dt>
              <dd>{detail.pan || '—'}</dd>
            </dl>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(['Aadhaar front', 'Aadhaar back'] as const).map((label) => {
                const cid =
                  label === 'Aadhaar front'
                    ? detail.aadharFrontHash
                    : detail.aadharBackHash;
                return (
                  <div key={label} className="p2p-tile">
                    <div className="p2p-tile__label">{label}</div>
                    {cid ? (
                      <a
                        className="p2p-tile__value p2p-tile__value--mono break-all underline"
                        href={`https://gateway.pinata.cloud/ipfs/${cid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {cid}
                      </a>
                    ) : (
                      <div className="p2p-tile__value">not on record</div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p2p-alert p2p-alert--warn mt-4">
              <span className="p2p-dot" style={{ marginTop: 6 }} />
              These values are public. They are readable from contract storage by
              anyone with no wallet and no key, permanently, regardless of this
              admin page.
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
