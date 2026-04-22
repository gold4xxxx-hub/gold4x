'use client';

import { useEffect, useState } from 'react';
import { WalletConnect } from '@/components/WalletConnect';
import { WalletInfo } from '@/components/WalletInfo';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
import Dashboard from '@/components/Dashboard';
import { ethers } from 'ethers';

type RegisterToken = 'JSAV' | 'USDT' | 'USDC';
type WithdrawToken = 'JSAV' | 'USDT' | 'USDC';
type IndexedUsersResponse = {
  count: number;
  source: 'contract' | 'bscscan';
};

const REGISTER_AMOUNT = {
  JSAV: '50',
  STABLE: '52.5',
} as const;

const INVEST_MIN_STABLE = '105.5';

const ERC20_ABI_MIN = [
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
];

function parseTxError(err: any, fallback: string): string {
  const msg =
    err?.shortMessage ||
    err?.reason ||
    err?.error?.message ||
    err?.message ||
    fallback;

  if (String(msg).toLowerCase().includes('missing revert data')) {
    return `${fallback} (transaction reverted; possible causes: not registered, insufficient claimable amount, wrong token, or unmet contract conditions).`;
  }

  return String(msg);
}

async function getPayoutSnapshot(contract: ethers.Contract, userAddress: string) {
  const d = await contract.dashboardMegaView(userAddress);
  return {
    registered: Boolean(d?.registered),
    claimable: BigInt(d?.claimable ?? 0),
    available: BigInt(d?.available ?? 0),
    contractJSAV: BigInt(d?.contractJSAV ?? 0),
    contractUSDT: BigInt(d?.contractUSDT ?? 0),
    contractUSDC: BigInt(d?.contractUSDC ?? 0),
  };
}

export default function Home() {
  const { isConnected } = useWalletConnection();
  const [indexedUsersCount, setIndexedUsersCount] = useState<number | null>(null);
  const [indexedUsersSource, setIndexedUsersSource] = useState<IndexedUsersResponse['source'] | null>(null);

  // ── Register state ──────────────────────────────
  const [showRegister, setShowRegister] = useState(false);
  const [referrer, setReferrer] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerTx, setRegisterTx] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerToken, setRegisterToken] = useState<RegisterToken>('JSAV');
  const [registerFeeText, setRegisterFeeText] = useState('-');
  const [registerFeeRaw, setRegisterFeeRaw] = useState<bigint>(BigInt(0));
  const [registerFeeLoading, setRegisterFeeLoading] = useState(false);
  const [stableAddresses, setStableAddresses] = useState<{ USDT: string; USDC: string }>({
    USDT: ethers.ZeroAddress,
    USDC: ethers.ZeroAddress,
  });

  // ── Invest state ───────────────────────────────
  const [showInvest, setShowInvest] = useState(false);
  const [investToken, setInvestToken] = useState<RegisterToken>('JSAV');
  const [investAmount, setInvestAmount] = useState('');
  const [investMinText, setInvestMinText] = useState('-');
  const [investMinRaw, setInvestMinRaw] = useState<bigint>(BigInt(0));
  const [investDecimals, setInvestDecimals] = useState(18);
  const [investMetaLoading, setInvestMetaLoading] = useState(false);
  const [investLoading, setInvestLoading] = useState(false);
  const [investTx, setInvestTx] = useState<string | null>(null);
  const [investError, setInvestError] = useState<string | null>(null);

  // ── Claim / Withdraw state ────────────────────
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawToken, setWithdrawToken] = useState<WithdrawToken>('USDT');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawTx, setWithdrawTx] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  useEffect(() => {
    const loadIndexedUsers = async (force = false) => {
      try {
        // Add cache-busting timestamp when forcing refresh
        const url = force ? `/api/stats/users?t=${Date.now()}` : '/api/stats/users';
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to load indexed users');
        }

        const data = (await response.json()) as IndexedUsersResponse;
        setIndexedUsersCount(data.count);
        setIndexedUsersSource(data.source);
      } catch {
        // Keep UI stable if stats API is slow/unavailable.
        setIndexedUsersCount((prev) => prev ?? 817);
        setIndexedUsersSource(null);
      }
    };

    // Initial load
    loadIndexedUsers();

    // Poll every 30 seconds for auto-updates
    const intervalId = setInterval(() => loadIndexedUsers(), 30000);

    return () => clearInterval(intervalId);
  }, []);

  // Refresh user count when registration transaction completes
  useEffect(() => {
    if (registerTx) {
      // Wait a bit for the blockchain to update, then refresh with cache-busting
      const timeoutId = setTimeout(() => {
        const refreshUsers = async () => {
          try {
            // Force cache-bust to get latest data
            const response = await fetch(`/api/stats/users?t=${Date.now()}`);
            if (response.ok) {
              const data = (await response.json()) as IndexedUsersResponse;
              setIndexedUsersCount(data.count);
              setIndexedUsersSource(data.source);
            }
          } catch {
            // Keep the last known count if refresh fails.
            setIndexedUsersCount((prev) => prev ?? 817);
          }
        };
        refreshUsers();
      }, 5000);
      return () => clearTimeout(timeoutId);
    }
  }, [registerTx]);

  useEffect(() => {
    const loadRegisterFee = async () => {
      if (!showRegister || !(window as any).ethereum) return;
      setRegisterFeeLoading(true);
      setRegisterError(null);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);

        const [usdt, usdc] = await Promise.all([contract.USDT(), contract.USDC()]);
        setStableAddresses({ USDT: usdt as string, USDC: usdc as string });

        if (registerToken === 'JSAV') {
          setRegisterFeeRaw(BigInt(0));
          setRegisterFeeText(`${REGISTER_AMOUNT.JSAV} JSAV`);
          setRegisterFeeLoading(false);
          return;
        }

        const stable = registerToken === 'USDT' ? (usdt as string) : (usdc as string);
        if (!stable || stable === ethers.ZeroAddress) {
          setRegisterFeeText('Token address unavailable');
          setRegisterFeeLoading(false);
          return;
        }

        let decimals = 18;
        try {
          const stableContract = new ethers.Contract(stable, ERC20_ABI_MIN, provider);
          const stableDecimals = await stableContract.decimals();
          decimals = Number(stableDecimals);
        } catch {
          decimals = 18;
        }

        setRegisterFeeRaw(ethers.parseUnits(REGISTER_AMOUNT.STABLE, decimals));
        setRegisterFeeText(`${REGISTER_AMOUNT.STABLE} ${registerToken}`);
      } catch (e: any) {
        setRegisterFeeText('-');
        setRegisterFeeRaw(BigInt(0));
        setRegisterError(e?.reason || e?.message || 'Unable to prepare register amount.');
      } finally {
        setRegisterFeeLoading(false);
      }
    };

    loadRegisterFee();
  }, [showRegister, registerToken]);

  useEffect(() => {
    const loadInvestMeta = async () => {
      if (!showInvest || !(window as any).ethereum) return;
      setInvestMetaLoading(true);
      setInvestError(null);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);
        const [minDepositRaw, jsavDecimals, usdt, usdc] = await Promise.all([
          contract.MIN_DEPOSIT(),
          contract.decimals(),
          contract.USDT(),
          contract.USDC(),
        ]);

        setStableAddresses({ USDT: usdt as string, USDC: usdc as string });

        if (investToken === 'JSAV') {
          const d = Number(jsavDecimals);
          setInvestDecimals(d);
          setInvestMinRaw(minDepositRaw as bigint);
          setInvestMinText(`${ethers.formatUnits(minDepositRaw as bigint, d)} JSAV`);
          return;
        }

        const stable = investToken === 'USDT' ? (usdt as string) : (usdc as string);
        if (!stable || stable === ethers.ZeroAddress) {
          setInvestMinRaw(BigInt(0));
          setInvestMinText('Token address unavailable');
          return;
        }

        try {
          const stableToken = new ethers.Contract(stable, ERC20_ABI_MIN, provider);
          const sd = await stableToken.decimals();
          setInvestDecimals(Number(sd));
          setInvestMinRaw(ethers.parseUnits(INVEST_MIN_STABLE, Number(sd)));
        } catch {
          setInvestDecimals(18);
          setInvestMinRaw(ethers.parseUnits(INVEST_MIN_STABLE, 18));
        }
        setInvestMinText(`${INVEST_MIN_STABLE} ${investToken}`);
      } catch (e: any) {
        setInvestMinRaw(BigInt(0));
        setInvestMinText('-');
        setInvestError(e?.reason || e?.message || 'Unable to prepare invest settings.');
      } finally {
        setInvestMetaLoading(false);
      }
    };

    loadInvestMeta();
  }, [showInvest, investToken]);

  useEffect(() => {
    const preloadStableAddresses = async () => {
      if (!isConnected || !(window as any).ethereum) return;
      if (stableAddresses.USDT !== ethers.ZeroAddress && stableAddresses.USDC !== ethers.ZeroAddress) return;
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);
        const [usdt, usdc] = await Promise.all([contract.USDT(), contract.USDC()]);
        setStableAddresses({ USDT: usdt as string, USDC: usdc as string });
      } catch {
        // Keep silent; claim can still work without stable addresses.
      }
    };

    preloadStableAddresses();
  }, [isConnected, stableAddresses.USDT, stableAddresses.USDC]);

  const handleRegister = async () => {
    if (!(window as any).ethereum) return setRegisterError('Wallet not found.');
    const addr = referrer.trim();
    if (!addr) {
      return setRegisterError('Referrer address is required.');
    }
    if (!ethers.isAddress(addr)) {
      return setRegisterError('Invalid referrer address.');
    }
    setRegisterLoading(true);
    setRegisterError(null);
    setRegisterTx(null);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      let tx;
      if (registerToken === 'JSAV') {
        tx = await contract.register(addr);
      } else {
        const stable = registerToken === 'USDT' ? stableAddresses.USDT : stableAddresses.USDC;
        if (!stable || stable === ethers.ZeroAddress) {
          throw new Error(`${registerToken} address is not configured on contract.`);
        }

        const owner = await signer.getAddress();
        const stableToken = new ethers.Contract(stable, ERC20_ABI_MIN, signer);
        const allowance = await stableToken.allowance(owner, JSAVIOR_CONTRACT_ADDRESS);
        if ((allowance as bigint) < registerFeeRaw) {
          const approveTx = await stableToken.approve(JSAVIOR_CONTRACT_ADDRESS, registerFeeRaw);
          await approveTx.wait();
        }

        tx = await contract.registerWithStable(stable, addr);
      }
      const receipt = await tx.wait();
      setRegisterTx(receipt.hash);
    } catch (e: any) {
      setRegisterError(parseTxError(e, 'Register transaction failed'));
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleInvest = async () => {
    if (!(window as any).ethereum) return setInvestError('Wallet not found.');
    if (!investAmount || Number(investAmount) <= 0) {
      return setInvestError('Enter a valid amount.');
    }

    setInvestLoading(true);
    setInvestError(null);
    setInvestTx(null);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      const amountRaw = ethers.parseUnits(investAmount, investDecimals);

      let tx;
      if (investToken === 'JSAV') {
        if (amountRaw < investMinRaw) {
          throw new Error(`Minimum invest is ${investMinText}`);
        }
        tx = await contract.invest(amountRaw);
      } else {
        if (amountRaw < investMinRaw) {
          throw new Error(`Minimum invest is ${investMinText}`);
        }

        const stable = investToken === 'USDT' ? stableAddresses.USDT : stableAddresses.USDC;
        if (!stable || stable === ethers.ZeroAddress) {
          throw new Error(`${investToken} address is not configured on contract.`);
        }

        const owner = await signer.getAddress();
        const stableToken = new ethers.Contract(stable, ERC20_ABI_MIN, signer);
        const allowance = await stableToken.allowance(owner, JSAVIOR_CONTRACT_ADDRESS);
        if ((allowance as bigint) < amountRaw) {
          const approveTx = await stableToken.approve(JSAVIOR_CONTRACT_ADDRESS, amountRaw);
          await approveTx.wait();
        }

        tx = await contract.investWithStable(stable, amountRaw);
      }

      const receipt = await tx.wait();
      setInvestTx(receipt.hash);
      setInvestAmount('');
    } catch (e: any) {
      setInvestError(parseTxError(e, 'Investment transaction failed'));
    } finally {
      setInvestLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!(window as any).ethereum) return setClaimError('Wallet not found.');

    setClaimLoading(true);
    setClaimError(null);
    setClaimTx(null);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);

      const payout = await getPayoutSnapshot(contract, userAddress);
      if (!payout.registered) {
        throw new Error('This wallet is not registered in the contract.');
      }

      const tx = await contract.claimAll();
      const receipt = await tx.wait();
      setClaimTx(receipt.hash);
    } catch (e: any) {
      setClaimError(parseTxError(e, 'Claim transaction failed'));
    } finally {
      setClaimLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!(window as any).ethereum) return setWithdrawError('Wallet not found.');

    setWithdrawLoading(true);
    setWithdrawError(null);
    setWithdrawTx(null);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      const payout = await getPayoutSnapshot(contract, userAddress);

      if (payout.claimable <= BigInt(0)) {
        throw new Error('No claimed balance is available to withdraw right now. Use Claim All first if rewards have accrued.');
      }

      let tx;
      if (withdrawToken === 'JSAV') {
        if (payout.contractJSAV <= BigInt(0)) {
          throw new Error('Contract JSAV liquidity is currently unavailable.');
        }
        tx = await contract.withdraw(ethers.ZeroAddress);
      } else {
        if (withdrawToken === 'USDT' && payout.contractUSDT <= BigInt(0)) {
          throw new Error('Contract USDT liquidity is currently unavailable.');
        }
        if (withdrawToken === 'USDC' && payout.contractUSDC <= BigInt(0)) {
          throw new Error('Contract USDC liquidity is currently unavailable.');
        }

        let stable = withdrawToken === 'USDT' ? stableAddresses.USDT : stableAddresses.USDC;
        if (!stable || stable === ethers.ZeroAddress) {
          stable = withdrawToken === 'USDT' ? (await contract.USDT()) : (await contract.USDC());
          setStableAddresses((prev) => ({ ...prev, [withdrawToken]: stable as string }));
        }

        if (!stable || stable === ethers.ZeroAddress) {
          throw new Error(`${withdrawToken} address is not configured on contract.`);
        }

        tx = await contract.withdraw(stable as string);
      }

      const receipt = await tx.wait();
      setWithdrawTx(receipt.hash);
    } catch (e: any) {
      setWithdrawError(parseTxError(e, 'Withdraw transaction failed'));
    } finally {
      setWithdrawLoading(false);
    }
  };

  return (
    <div className="fx-shell">
      <main className="max-w-6xl mx-auto space-y-10">
        {!isConnected ? (
          <div className="fx-card fx-card--gold p-12 text-center fx-reveal" style={{ maxWidth: 520, margin: '60px auto' }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6" style={{ background: 'rgba(245,214,110,0.1)', border: '1px solid rgba(245,214,110,0.22)' }}>
              <svg width="28" height="28" fill="none" stroke="var(--fx-gold-strong)" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <h2 className="fx-section-title text-2xl mb-3">Connect Your Wallet</h2>
            <p className="fx-lead text-sm mb-6" style={{ maxWidth: 320, margin: '0 auto 1.5rem' }}>
              Connect to BSC to unlock the JSAVIOR command console.
            </p>
            <div className="flex justify-center">
              <WalletConnect />
            </div>
            <p className="text-xs mt-5" style={{ color: 'var(--fx-ink-subtle)' }}>Binance Smart Chain · Mainnet</p>
          </div>
        ) : (
          <>
            <header className="fx-card fx-card--gold p-6 sm:p-8 fx-reveal">
              <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="fx-pill">JSAVIOR Network</span>
                    <span className="fx-pill fx-pill--emerald">BSC Live</span>
                    <span className="fx-pill fx-pill--ghost">JSAV Token</span>
                  </div>
                  <h1 className="fx-title text-4xl sm:text-5xl">JSAVIOR</h1>
                  <p className="fx-lead max-w-lg">
                    Precision-grade DeFi operations on Binance Smart Chain. Track rewards,
                    invest, claim, and withdraw — all from one refined command hub.
                  </p>
                  <div className="flex flex-wrap gap-5 text-sm" style={{ color: 'var(--fx-ink-muted)' }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fx-gold-strong)' }} />
                      Token: <span className="gold-text">JSAV</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fx-emerald)' }} />
                      Chain: <span className="gold-text">BSC Mainnet</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fx-emerald)', boxShadow: '0 0 6px rgba(0,201,173,0.7)' }} />
                      Status: <span style={{ color: 'var(--fx-emerald-bright)', fontWeight: 600 }}>Live</span>
                    </div>
                  </div>
                </div>
                <div className="fx-card p-5 sm:p-6 w-full lg:w-[320px] space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.3em] text-[#b9b0a3]">Command</span>
                    <span className="gold-badge">Verified</span>
                  </div>
                  <p className="text-sm text-[#b9b0a3]">
                    Launch critical actions from a single, secured control panel.
                  </p>
                  <div className="fx-alert fx-alert--success text-sm">
                    Connection verified on BSC.
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {!showRegister ? (
                      <button
                        className="fx-button"
                        onClick={() => {
                          setShowRegister(true);
                          setRegisterToken('JSAV');
                          setRegisterTx(null);
                          setRegisterError(null);
                        }}
                      >
                        Register
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">
                            Token
                          </label>
                          <select
                            className="fx-input text-xs"
                            value={registerToken}
                            onChange={e => setRegisterToken(e.target.value as RegisterToken)}
                            disabled={registerLoading}
                          >
                            <option value="JSAV">JSAV</option>
                            <option value="USDT">USDT</option>
                            <option value="USDC">USDC</option>
                          </select>
                        </div>
                        <div className="fx-alert text-xs">
                          Required amount:{' '}
                          <span className="gold-text">
                            {registerFeeLoading ? 'Loading…' : registerFeeText}
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--fx-ink-subtle)' }}>
                          Estimation:{' '}
                          {registerToken === 'JSAV'
                            ? 'Configured fixed amount: 50 JSAV.'
                            : 'Configured fixed amount: 52.5 stable tokens; raw approval uses token decimals.'}
                        </p>
                        <label className="block text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--fx-emerald-bright)' }}>
                          Referrer Address
                        </label>
                        <input
                          className="fx-input text-xs"
                          placeholder="Referrer address (required)"
                          value={referrer}
                          onChange={e => setReferrer(e.target.value)}
                          disabled={registerLoading}
                          style={{ color: 'var(--fx-emerald-bright)' }}
                        />
                        {registerError && (
                          <div className="fx-alert fx-alert--error text-xs">{registerError}</div>
                        )}
                        {registerTx && (
                          <div className="fx-alert fx-alert--success text-xs">
                            ✓ Registered!{' '}
                            <a
                              href={`https://bscscan.com/tx/${registerTx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              View tx
                            </a>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            className="fx-button flex-1"
                            onClick={handleRegister}
                            disabled={registerLoading || registerFeeLoading || !referrer.trim()}
                          >
                            {registerLoading ? 'Confirming…' : `Confirm (${registerToken})`}
                          </button>
                          <button
                            className="fx-button fx-button--dark"
                            onClick={() => {
                              setShowRegister(false);
                              setReferrer('');
                              setRegisterError(null);
                              setRegisterFeeText('-');
                            }}
                            disabled={registerLoading}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {!showInvest ? (
                      <button
                        className="fx-button fx-button--dark"
                        onClick={() => {
                          setShowInvest(true);
                          setInvestToken('JSAV');
                          setInvestAmount('');
                          setInvestTx(null);
                          setInvestError(null);
                        }}
                      >
                        Invest
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">
                            Token
                          </label>
                          <select
                            className="fx-input text-xs"
                            value={investToken}
                            onChange={e => setInvestToken(e.target.value as RegisterToken)}
                            disabled={investLoading}
                          >
                            <option value="JSAV">JSAV</option>
                            <option value="USDT">USDT</option>
                            <option value="USDC">USDC</option>
                          </select>
                        </div>
                        <input
                          className="fx-input text-xs"
                          placeholder={`Amount in ${investToken}`}
                          value={investAmount}
                          onChange={e => setInvestAmount(e.target.value)}
                          disabled={investLoading}
                        />
                        <div className="fx-alert text-xs">
                          Minimum:{' '}
                          <span className="gold-text">
                            {investMetaLoading ? 'Loading…' : investMinText}
                          </span>
                        </div>
                        {investError && (
                          <div className="fx-alert fx-alert--error text-xs">{investError}</div>
                        )}
                        {investTx && (
                          <div className="fx-alert fx-alert--success text-xs">
                            ✓ Invested!{' '}
                            <a
                              href={`https://bscscan.com/tx/${investTx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              View tx
                            </a>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            className="fx-button flex-1"
                            onClick={handleInvest}
                            disabled={investLoading || investMetaLoading}
                          >
                            {investLoading ? 'Confirming…' : `Confirm (${investToken})`}
                          </button>
                          <button
                            className="fx-button fx-button--dark"
                            onClick={() => {
                              setShowInvest(false);
                              setInvestAmount('');
                              setInvestError(null);
                              setInvestMinText('-');
                            }}
                            disabled={investLoading}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      className="fx-button fx-button--dark"
                      onClick={handleClaim}
                      disabled={claimLoading}
                    >
                      {claimLoading ? 'Claiming...' : 'Claim All'}
                    </button>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--fx-ink-subtle)' }}>
                      Claim All updates your internal claimable balance. Use Withdraw to receive JSAV, USDT, or USDC.
                    </p>
                    {claimError && (
                      <div className="fx-alert fx-alert--error text-xs">{claimError}</div>
                    )}
                    {claimTx && (
                      <div className="fx-alert fx-alert--success text-xs">
                        ✓ Claim recorded.{' '}
                        <a
                          href={`https://bscscan.com/tx/${claimTx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          View tx
                        </a>
                        {' '}Then use Withdraw to transfer tokens.
                      </div>
                    )}

                    {!showWithdraw ? (
                      <button
                        className="fx-button fx-button--dark"
                        onClick={() => {
                          setShowWithdraw(true);
                          setWithdrawToken('USDT');
                          setWithdrawError(null);
                          setWithdrawTx(null);
                        }}
                      >
                        Withdraw
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">
                            Withdraw Token
                          </label>
                          <select
                            className="fx-input text-xs"
                            value={withdrawToken}
                            onChange={e => setWithdrawToken(e.target.value as WithdrawToken)}
                            disabled={withdrawLoading}
                          >
                            <option value="JSAV">JSAV</option>
                            <option value="USDT">USDT</option>
                            <option value="USDC">USDC</option>
                          </select>
                        </div>
                        {withdrawError && (
                          <div className="fx-alert fx-alert--error text-xs">{withdrawError}</div>
                        )}
                        {withdrawTx && (
                          <div className="fx-alert fx-alert--success text-xs">
                            ✓ Withdrawn!{' '}
                            <a
                              href={`https://bscscan.com/tx/${withdrawTx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              View tx
                            </a>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            className="fx-button flex-1"
                            onClick={handleWithdraw}
                            disabled={withdrawLoading}
                          >
                            {withdrawLoading ? 'Confirming...' : `Confirm (${withdrawToken})`}
                          </button>
                          <button
                            className="fx-button fx-button--dark"
                            onClick={() => {
                              setShowWithdraw(false);
                              setWithdrawError(null);
                            }}
                            disabled={withdrawLoading}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      className="fx-button fx-button--ghost"
                      onClick={() => { window.location.href = '/p2p'; }}
                    >
                      Open P2P Desk
                    </button>
                  </div>
                </div>
              </div>
            </header>

            <section className="fx-card p-4 sm:p-5 fx-reveal fx-reveal--delay-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 text-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-1 sm:px-3 sm:border-r" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <span className="fx-kicker">JSAV Price</span>
                  <span className="font-bold text-base" style={{ color: 'var(--fx-gold-strong)' }}>$1.04</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-1 sm:px-3 sm:border-r" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <span className="fx-kicker">BSC Gas</span>
                  <span className="font-bold text-base" style={{ color: 'var(--fx-emerald-bright)' }}>3.2 Gwei</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-1 sm:px-3">
                  <span className="fx-kicker">ROI Cap</span>
                  <span className="font-bold text-base" style={{ color: 'var(--fx-ink)' }}>3.0×</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-1 sm:px-3 sm:border-l" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <span className="fx-kicker">Total Users</span>
                  <span className="font-bold text-base" style={{ color: 'var(--fx-emerald-bright)' }}>
                    {indexedUsersCount === null ? '...' : indexedUsersCount}
                  </span>
                </div>
              </div>
            </section>

            <div className="space-y-8 fx-reveal fx-reveal--delay-3">
            <Dashboard />

            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
              <aside className="space-y-6">
                <WalletInfo />
              </aside>

              <div className="fx-card p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                  <h2 className="fx-section-title text-2xl">Protocol Snapshot</h2>
                  <span className="fx-pill fx-pill--ghost">BSC Mainnet</span>
                </div>
                <ul className="text-sm text-[#b9b0a3] space-y-2">
                  <li>
                    Contract: <span className="gold-text">{JSAVIOR_CONTRACT_ADDRESS}</span>
                  </li>
                  <li>Total users currently shown: {indexedUsersCount === null ? 'loading' : indexedUsersCount}.</li>
                  <li>Registration and investment flows are available in the Command panel.</li>
                  <li>Claim All accrues rewards to your internal claimable balance; Withdraw sends the selected asset to your wallet.</li>
                  <li>Stable token support includes USDT and USDC.</li>
                  <li>All transactions are executed directly from your connected wallet.</li>
                </ul>
              </div>
            </div>
            </div>
          </>
        )}

        <footer className="text-center text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>
          <p>
            <span className="gold-text">JSAVIOR</span>
            <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
            Next.js · ethers.js · wagmi
            <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
            Binance Smart Chain
          </p>
        </footer>
      </main>
    </div>
  );
}