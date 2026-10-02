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
import {
  P2PESCROW_CONTRACT_ADDRESS,
  P2PESCROW_CONTRACT_ABI,
  BSC_CONFIG,
} from '@/config/web3Config';
import { useEthersSigner } from '@/hooks/useEthersSigner';
import { shortAddress } from '@/config/p2pEscrow';
import '../../p2p/p2p.css';

// keccak256("KYCSubmitted(address)") and keccak256("KYCVerified(address,bool)")
const TOPIC_SUBMITTED = '0x50254a0dab3f208f414bf247012e8d8c90928d1a1b1699b1b62df2326bfb09ab';
const TOPIC_VERIFIED = '0x7a02eb9b107b2ab713e88c3cdac538e5c21b689d0f1b1f22367578b28fc5d09';

type Applicant = {
  wallet: string;
  verified: boolean;
  submittedAt: number;
};

const RPC = 'https://bsc-rpc.publicnode.com';
const WINDOW = 5_000; // public-node limit, same as the P2P log reader

export default function KycAdminPage() {
  const { connect, connectors, isPending: connecting } = useConnect();
  const { address, isConnected, signer } = useEthersSigner();

  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyWallet, setBusyWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const isOwner = Boolean(
    address && address.toLowerCase() === '0xb32fccf4723fc19b8a097006f59437c15e88bbce',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new ethers.JsonRpcProvider(RPC, BSC_CONFIG.chainId, {
        staticNetwork: true,
      });
      const head = await provider.getBlockNumber();
      const from = Math.max(0, head - WINDOW);

      const [submitted, verified] = await Promise.all([
        provider.getLogs({
          address: P2PESCROW_CONTRACT_ADDRESS,
          topics: [TOPIC_SUBMITTED],
          fromBlock: from,
          toBlock: head,
        }),
        provider.getLogs({
          address: P2PESCROW_CONTRACT_ADDRESS,
          topics: [TOPIC_VERIFIED],
          fromBlock: from,
          toBlock: head,
        }),
      ]);

      const state = new Map<string, Applicant>();
      for (const log of submitted) {
        const wallet = ethers.getAddress('0x' + log.topics[1].slice(26));
        const prev = state.get(wallet);
        if (!prev || log.blockNumber >= prev.submittedAt) {
          state.set(wallet, {
            wallet,
            verified: prev?.verified ?? false,
            submittedAt: log.blockNumber,
          });
        }
      }
      for (const log of verified) {
        const wallet = ethers.getAddress('0x' + log.topics[1].slice(26));
        const prev = state.get(wallet);
        if (!prev) continue;
        // topic2 is the ABI-encoded bool: 0x...01 true, 0x...00 false
        const isTrue = BigInt(log.topics[2]) === 1n;
        state.set(wallet, { ...prev, verified: isTrue });
      }

      setApplicants(
        [...state.values()].sort((a, b) => b.submittedAt - a.submittedAt),
      );
      setStatus(
        `Read the most recent ${WINDOW.toLocaleString()} blocks only. Submissions older than that are not listed.`,
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
        verified: String(b[5]),
        updatedAt: String(b[6]),
      });
      setExpanded(wallet);
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err?.shortMessage || err?.message || 'Could not read that applicant.');
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
      setStatus(`${shortAddress(wallet)} ${next ? 'approved' : 'rejected'}.`);
      setExpanded(null);
      setDetail(null);
      await load();
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err?.shortMessage || err?.message || 'Transaction failed.');
    } finally {
      setBusyWallet(null);
    }
  };

  const onConnect = () => {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    if (injected) connect({ connector: injected });
  };

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
            <button className="p2p-btn" onClick={onConnect} disabled={connecting}>
              <span>{connecting ? 'Connecting…' : 'Connect Wallet'}</span>
            </button>
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

        {expanded && detail && (
          <section className="p2p-panel p-6">
            <div className="p2p-panel__head">
              <h2 className="p2p-panel__title">Applicant detail</h2>
              <button className="p2p-btn p2p-btn--sm p2p-btn--ghost" onClick={() => { setExpanded(null); setDetail(null); }}>
                <span>Close</span>
              </button>
            </div>

            <dl className="p2p-bank__grid">
              <dt>Wallet</dt>
              <dd>{expanded}</dd>
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
