'use client';

// KYC onboarding. Submission, storage and approval all live in the verified
// P2PEscrow contract — submitKYC / updateKYC by the user, verifyKYC by the
// owner. There is no server-side store behind this page.
//
// The previous version of this page posted to /api/kyc/submit and read from an
// in-memory Map, so submissions were lost on every restart or redeploy and were
// invisible to the trading desk. That path has been removed.

import { useEffect, useState } from 'react';
import { useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import KycPanel from '@/components/p2p/KycPanel';
import { useKycStatus, getStoredKyc } from '@/hooks/useP2PEscrow';
import { useEthersSigner } from '@/hooks/useEthersSigner';
import { BSC_CONFIG, isP2pEscrowOwner } from '@/config/web3Config';
import { shortAddress } from '@/config/p2pEscrow';
import '../p2p/p2p.css';

export default function KycPage() {
  const { switchChain, isPending: switching } = useSwitchChain();

  const { address, isConnected, signer, chainId } = useEthersSigner();
  const { status: kyc, refresh: refreshKyc } = useKycStatus(address);

  const [stored, setStored] = useState<{
    bankHolderName: string;
    bankAccountNumber: string;
    ifscCode: string;
    bankName: string;
    aadharFrontHash: string;
    aadharBackHash: string;
    mobile: string;
    email: string;
    pan: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the caller's stored KYC so an update can be prefilled. Guarded so the
  // state update lands in a promise callback rather than the effect body.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getStoredKyc(address)
      .then((r) => {
        if (!cancelled) setStored(r?.draft ?? null);
      })
      .catch(() => {
        if (!cancelled) setStored(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, kyc.submitted, kyc.updatedAt]);

  const onSwitch = () => switchChain({ chainId: BSC_CONFIG.chainId });

  const onDone = () => {
    setNotice('KYC submitted. An owner must verify it before you can trade.');
    void refreshKyc();
  };

  const wrongChain = isConnected && chainId !== null && chainId !== BSC_CONFIG.chainId;

  const isOwner = isP2pEscrowOwner(address);

  return (
    <div className="fx-shell p2p-root">
      <div className="p2p-ambient" aria-hidden="true">
        <div className="p2p-ambient__orb p2p-ambient__orb--gold" />
        <div className="p2p-ambient__orb p2p-ambient__orb--emerald" />
        <div className="p2p-ambient__grid" />
      </div>

      <div className="max-w-3xl mx-auto space-y-6 relative">
        <header className="p2p-hero p-6 sm:p-8">
          <div className="p2p-hero__inner">
            <div className="flex items-center gap-2 mb-4">
              <span className="p2p-chip p2p-chip--open">
                <span className="p2p-dot" />
                On-chain verification
              </span>
            </div>
            <h1 className="p2p-hero__title text-3xl sm:text-4xl">Identity Verification</h1>
            <p className="text-sm text-[#b9b0a3] mt-3 max-w-2xl">
              Your details are submitted as a transaction to the escrow contract
              and can only be updated by you. An owner verifies the application,
              which is what unlocks posting ads and taking trades on the P2P desk.
            </p>
            {/* Owner-only, so the applicant list is not advertised to every
                visitor. The admin page enforces the same check on-chain. */}
            {isOwner && (
              <div className="mt-5">
                <a
                  className="p2p-btn p2p-btn--sm p2p-btn--ghost"
                  href="/kyc/admin/"
                  style={{ textDecoration: 'none' }}
                >
                  <span>Owner: review KYC applications</span>
                </a>
              </div>
            )}
          </div>
        </header>

        {!isConnected && (
          <div className="p2p-panel p-6">
            <div className="p2p-tile__label mb-2">Wallet required</div>
            <p className="text-sm text-[#b9b0a3] mb-4">
              Connect the wallet you want verified. The address is the identity
              on-chain, so connect the same wallet you intend to trade with.
            </p>
            {/* RainbowKit's ConnectButton, same as the top nav, so it offers
                every connector that is actually present and reports its own
                errors. The previous hand-rolled button silently did nothing. */}
            <div className="gold-connect-wrapper rounded-md">
              <ConnectButton />
            </div>
          </div>
        )}

        {isConnected && address && (
          <>
            <div className="p2p-tiles">
              <div className="p2p-tile">
                <div className="p2p-tile__label">Wallet</div>
                <div className="p2p-tile__value p2p-tile__value--mono">
                  {shortAddress(address)}
                </div>
              </div>
              <div className="p2p-tile">
                <div className="p2p-tile__label">Status</div>
                <div className="p2p-tile__value">
                  {kyc.loading
                    ? 'checking…'
                    : kyc.verified
                      ? 'Verified'
                      : kyc.submitted
                        ? 'Pending owner review'
                        : 'Not submitted'}
                </div>
              </div>
            </div>

            {wrongChain && (
              <div className="p2p-alert p2p-alert--warn">
                <span className="p2p-dot" style={{ marginTop: 6 }} />
                <div className="flex-1">
                  <p className="mb-2">
                    Your wallet is on the wrong network. The contract is on BSC,
                    and submitting will fail on any other chain.
                  </p>
                  <button
                    className="p2p-btn p2p-btn--sm"
                    onClick={() => void onSwitch()}
                    disabled={switching}
                  >
                    <span>{switching ? 'Switching…' : 'Switch to BSC'}</span>
                  </button>
                </div>
              </div>
            )}

            {notice && <div className="p2p-alert p2p-alert--info">{notice}</div>}

            <KycPanel
              signer={signer}
              submitted={kyc.submitted}
              verified={kyc.verified}
              onDone={onDone}
            />

            {stored && kyc.submitted && (
              <div className="p2p-panel p-5">
                <div className="p2p-tile__label mb-2">What is on record</div>
                <p className="text-sm text-[#b9b0a3] mb-3">
                  These are the values currently stored in the contract for your
                  wallet.
                </p>
                <dl className="p2p-bank__grid">
                  <dt>Name</dt>
                  <dd>{stored.bankHolderName || '—'}</dd>
                  <dt>Bank</dt>
                  <dd>{stored.bankName || '—'}</dd>
                  <dt>Account</dt>
                  <dd>{stored.bankAccountNumber || '—'}</dd>
                  <dt>IFSC</dt>
                  <dd>{stored.ifscCode || '—'}</dd>
                  <dt>Mobile</dt>
                  <dd>{stored.mobile || '—'}</dd>
                  <dt>Email</dt>
                  <dd>{stored.email || '—'}</dd>
                  <dt>PAN</dt>
                  <dd>{stored.pan || '—'}</dd>
                </dl>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(['Aadhaar front', 'Aadhaar back'] as const).map((label) => {
                    const cid =
                      label === 'Aadhaar front'
                        ? stored.aadharFrontHash
                        : stored.aadharBackHash;
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
