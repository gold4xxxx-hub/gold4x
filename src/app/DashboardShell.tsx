'use client';

import { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { WalletInfo } from '@/components/WalletInfo';
import { CountUp } from '@/components/CountUp';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
import Dashboard from '@/components/Dashboard';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

let _ethers: any = null;
async function getEthers() {
  if (!_ethers) {
    _ethers = (await import('ethers')).ethers;
  }
  return _ethers;
}

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

async function getPayoutSnapshot(contract: any, userAddress: string) {
  try {
    const d = await contract.dashboardMegaView.staticCall(userAddress);
    return {
      registered: Boolean(d?.registered),
      claimable: BigInt(d?.claimable ?? 0),
      available: BigInt(d?.available ?? 0),
      contractJSAV: BigInt(d?.contractJSAV ?? 0),
      contractUSDT: BigInt(d?.contractUSDT ?? 0),
      contractUSDC: BigInt(d?.contractUSDC ?? 0),
    };
  } catch (e) {
    console.error('getPayoutSnapshot failed:', e);
    return { registered: false, claimable: BigInt(0), available: BigInt(0), contractJSAV: BigInt(0), contractUSDT: BigInt(0), contractUSDC: BigInt(0) };
  }
}

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('DashboardErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '24px 16px',
          margin: '16px 0',
          background: '#1a0000',
          border: '1px solid #ff3333',
          borderRadius: '8px',
          color: '#ff5555',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#ff7777' }}>
            ⚠ Dashboard Error
          </div>
          <div>{this.state.error.message}</div>
          <div style={{ marginTop: 12, opacity: 0.6, fontSize: 11 }}>
            {this.state.error.stack?.split('\n').slice(0, 4).join('\n')}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function DashboardShell() {
  const { isConnected } = useWalletConnection();
  const [indexedUsersCount, setIndexedUsersCount] = useState<number | null>(null);
  const [indexedUsersSource, setIndexedUsersSource] = useState<IndexedUsersResponse['source'] | null>(null);

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
    USDT: ZERO_ADDRESS,
    USDC: ZERO_ADDRESS,
  });

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
        const url = force ? `/api/stats/users?t=${Date.now()}` : '/api/stats/users';
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed');
        const data = (await response.json()) as IndexedUsersResponse;
        setIndexedUsersCount(data.count);
        setIndexedUsersSource(data.source);
      } catch {
        setIndexedUsersCount((prev) => prev ?? 0);
        setIndexedUsersSource(null);
      }
    };
    loadIndexedUsers();
    const intervalId = setInterval(() => loadIndexedUsers(), 30000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (registerTx) {
      const timeoutId = setTimeout(async () => {
        try {
          const res = await fetch(`/api/stats/users?t=${Date.now()}`);
          if (res.ok) {
            const data = (await res.json()) as IndexedUsersResponse;
            setIndexedUsersCount(data.count);
            setIndexedUsersSource(data.source);
          }
        } catch {
          setIndexedUsersCount((prev) => prev ?? 0);
        }
      }, 5000);
      return () => clearTimeout(timeoutId);
    }
  }, [registerTx]);

  useEffect(() => {
    if (!showRegister || !(window as any).ethereum) return;
    (async () => {
      setRegisterFeeLoading(true);
      setRegisterError(null);
      try {
        const ethers = await getEthers();
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);
        const [usdt, usdc] = await Promise.all([contract.USDT.staticCall(), contract.USDC.staticCall()]);
        setStableAddresses({ USDT: usdt as string, USDC: usdc as string });

        if (registerToken === 'JSAV') {
          setRegisterFeeRaw(BigInt(0));
          setRegisterFeeText(`${REGISTER_AMOUNT.JSAV} JSAV`);
          setRegisterFeeLoading(false);
          return;
        }

        const stable = registerToken === 'USDT' ? (usdt as string) : (usdc as string);
        if (!stable || stable === ZERO_ADDRESS) {
          setRegisterFeeText('Token address unavailable');
          setRegisterFeeLoading(false);
          return;
        }

        let decimals = 18;
        try {
          const sc = new ethers.Contract(stable, ERC20_ABI_MIN, provider);
          const sd = await sc.decimals.staticCall();
          decimals = Number(sd);
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
    })();
  }, [showRegister, registerToken]);

  useEffect(() => {
    if (!showInvest || !(window as any).ethereum) return;
    (async () => {
      setInvestMetaLoading(true);
      setInvestError(null);
      try {
        const ethers = await getEthers();
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);
        const [minDepositRaw, jsavDecimals, usdt, usdc] = await Promise.all([
          contract.MIN_DEPOSIT.staticCall(),
          contract.decimals.staticCall(),
          contract.USDT.staticCall(),
          contract.USDC.staticCall(),
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
        if (!stable || stable === ZERO_ADDRESS) {
          setInvestMinRaw(BigInt(0));
          setInvestMinText('Token address unavailable');
          return;
        }

        try {
          const st = new ethers.Contract(stable, ERC20_ABI_MIN, provider);
          const sd = await st.decimals.staticCall();
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
    })();
  }, [showInvest, investToken]);

  useEffect(() => {
    if (!isConnected || !(window as any).ethereum) return;
    if (stableAddresses.USDT !== ZERO_ADDRESS && stableAddresses.USDC !== ZERO_ADDRESS) return;
    (async () => {
      try {
        const ethers = await getEthers();
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);
        const [usdt, usdc] = await Promise.all([contract.USDT.staticCall(), contract.USDC.staticCall()]);
        setStableAddresses({ USDT: usdt as string, USDC: usdc as string });
      } catch { /* silent */ }
    })();
  }, [isConnected, stableAddresses.USDT, stableAddresses.USDC]);

  const handleRegister = async () => {
    if (!(window as any).ethereum) return setRegisterError('Wallet not found.');
    const addr = referrer.trim();
    if (!addr) return setRegisterError('Referrer address is required.');
    const ethers = await getEthers();
    if (!ethers.isAddress(addr)) return setRegisterError('Invalid referrer address.');
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
        if (!stable || stable === ZERO_ADDRESS) throw new Error(`${registerToken} address not configured.`);
        const owner = await signer.getAddress();
        const st = new ethers.Contract(stable, ERC20_ABI_MIN, signer);
        const allowance = await st.allowance.staticCall(owner, JSAVIOR_CONTRACT_ADDRESS);
        if ((allowance as bigint) < registerFeeRaw) {
          const appTx = await st.approve(JSAVIOR_CONTRACT_ADDRESS, registerFeeRaw);
          await appTx.wait();
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
    if (!investAmount || Number(investAmount) <= 0) return setInvestError('Enter a valid amount.');
    setInvestLoading(true);
    setInvestError(null);
    setInvestTx(null);
    try {
      const ethers = await getEthers();
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      const amountRaw = ethers.parseUnits(investAmount, investDecimals);
      let tx;
      if (investToken === 'JSAV') {
        if (amountRaw < investMinRaw) throw new Error(`Minimum invest is ${investMinText}`);
        tx = await contract.invest(amountRaw);
      } else {
        if (amountRaw < investMinRaw) throw new Error(`Minimum invest is ${investMinText}`);
        const stable = investToken === 'USDT' ? stableAddresses.USDT : stableAddresses.USDC;
        if (!stable || stable === ZERO_ADDRESS) throw new Error(`${investToken} address not configured.`);
        const owner = await signer.getAddress();
        const st = new ethers.Contract(stable, ERC20_ABI_MIN, signer);
        const allowance = await st.allowance.staticCall(owner, JSAVIOR_CONTRACT_ADDRESS);
        if ((allowance as bigint) < amountRaw) {
          const appTx = await st.approve(JSAVIOR_CONTRACT_ADDRESS, amountRaw);
          await appTx.wait();
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
      const ethers = await getEthers();
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      const payout = await getPayoutSnapshot(contract, userAddress);
      if (!payout.registered) throw new Error('Not registered.');
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
      const ethers = await getEthers();
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      const payout = await getPayoutSnapshot(contract, userAddress);
      if (payout.claimable <= BigInt(0)) throw new Error('No claimable balance.');
      let tx;
      if (withdrawToken === 'JSAV') {
        if (payout.contractJSAV <= BigInt(0)) throw new Error('JSAV liquidity unavailable.');
        tx = await contract.withdraw(ZERO_ADDRESS);
      } else {
        if (withdrawToken === 'USDT' && payout.contractUSDT <= BigInt(0)) throw new Error('USDT liquidity unavailable.');
        if (withdrawToken === 'USDC' && payout.contractUSDC <= BigInt(0)) throw new Error('USDC liquidity unavailable.');
        let stable = withdrawToken === 'USDT' ? stableAddresses.USDT : stableAddresses.USDC;
        if (!stable || stable === ZERO_ADDRESS) {
          stable = withdrawToken === 'USDT' ? await contract.USDT.staticCall() : await contract.USDC.staticCall();
          setStableAddresses((prev) => ({ ...prev, [withdrawToken]: stable as string }));
        }
        if (!stable || stable === ZERO_ADDRESS) throw new Error(`${withdrawToken} address not configured.`);
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

        <header className="hero-panel p-6 sm:p-10 fx-reveal">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            <div className="space-y-6 lg:pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="hero-pill">JSAVIOR Network</span>
                <span className="hero-pill" style={{ borderColor: 'rgba(45,139,120,0.25)', color: 'var(--fx-emerald-bright)' }}>BSC Live</span>
                <span className="hero-pill">JSAV Token</span>
              </div>
              <h1 className="fx-hero-title" data-text="JSAVIOR">JSAVIOR</h1>
              <p className="fx-lead max-w-xl text-base" style={{ marginTop: '20px' }}>
                Precision-grade DeFi operations on Binance Smart Chain. Track rewards,
                invest, claim, and withdraw — all from one refined command hub.
              </p>
              <div className="flex flex-wrap gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fx-emerald)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>Token:</span>
                  <span style={{ color: 'var(--fx-ink)', fontWeight: 500 }}>JSAV</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fx-emerald)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>Chain:</span>
                  <span style={{ color: 'var(--fx-ink)', fontWeight: 500 }}>BSC Mainnet</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fx-emerald)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>Status:</span>
                  <span style={{ color: 'var(--fx-emerald-bright)', fontWeight: 600 }}>Live</span>
                </div>
              </div>
            </div>
            <div className="command-panel w-full lg:w-[340px] space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.6)' }}>Command</span>
                <span className="fx-status-badge fx-status-badge--verified">Verified</span>
              </div>
              <p className="text-sm" style={{ color: 'var(--fx-ink-muted)' }}>
                Launch critical actions from a single, secured control panel.
              </p>
              <div className="connection-box text-sm">
                Connection verified on BSC
              </div>
              <section className="stats-bar py-2 px-3">
                <div className="grid grid-cols-2 text-xs gap-y-2">
                  <div className="stat-cell">
                    <span className="fx-kicker">JSAV Price</span>
                    <span className="stats-bar__value--sm"><span className="stats-bar__dot"></span><CountUp value={1.04} format={(n) => `$${n.toFixed(2)}`} /></span>
                  </div>
                  <div className="stat-cell">
                    <span className="fx-kicker">BSC Gas</span>
                    <span className="stats-bar__value--sm stats-bar__value--gold"><CountUp value={3.2} format={(n) => `${n.toFixed(1)} Gwei`} /></span>
                  </div>
                  <div className="stat-cell">
                    <span className="fx-kicker">ROI Cap</span>
                    <span className="stats-bar__value--sm"><CountUp value={3.0} format={(n) => `${n.toFixed(1)}×`} /></span>
                  </div>
                  <div className="stat-cell">
                    <span className="fx-kicker">Total Users</span>
                    <span className="stats-bar__value--sm stats-bar__value--gold">
                      <CountUp value={indexedUsersCount} format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })} />
                    </span>
                  </div>
                </div>
              </section>
              <div className="grid grid-cols-1 gap-3">
                {!showRegister ? (
                  <button className="fx-button--gold" onClick={() => { setShowRegister(true); setRegisterToken('JSAV'); setRegisterTx(null); setRegisterError(null); }}>
                    Register
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.08em] mb-1" style={{ color: 'rgba(255,255,255,0.6)' }}>Token</label>
                      <select className="fx-input text-xs" value={registerToken} onChange={e => setRegisterToken(e.target.value as RegisterToken)} disabled={registerLoading}>
                        <option value="JSAV">JSAV</option><option value="USDT">USDT</option><option value="USDC">USDC</option>
                      </select>
                    </div>
                    <div className="fx-alert text-xs">Required amount: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{registerFeeLoading ? 'Loading…' : registerFeeText}</span></div>
                    <label className="block text-[10px] uppercase tracking-[0.08em] mb-1" style={{ color: 'rgba(255,255,255,0.6)' }}>Referrer Address</label>
                    <input className="fx-input text-xs" placeholder="Referrer address (required)" value={referrer} onChange={e => setReferrer(e.target.value)} disabled={registerLoading} />
                    {registerError && <div className="fx-alert fx-alert--error text-xs">{registerError}</div>}
                    {registerTx && <div className="fx-alert fx-alert--success text-xs">✓ Registered! <a href={`https://bscscan.com/tx/${registerTx}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a></div>}
                    <div className="flex gap-2">
                      <button className="fx-button--gold flex-1" onClick={handleRegister} disabled={registerLoading || registerFeeLoading || !referrer.trim()}>{registerLoading ? 'Confirming…' : `Confirm (${registerToken})`}</button>
                      <button className="fx-btn-sweep fx-btn-sweep--ghost" onClick={() => { setShowRegister(false); setReferrer(''); setRegisterError(null); setRegisterFeeText('-'); }} disabled={registerLoading}>Cancel</button>
                    </div>
                  </div>
                )}
                {!showInvest ? (
                  <button className="fx-btn-sweep" onClick={() => { setShowInvest(true); setInvestToken('JSAV'); setInvestAmount(''); setInvestTx(null); setInvestError(null); }}>Invest</button>
                ) : (
                  <div className="space-y-2">
                    <select className="fx-input text-xs" value={investToken} onChange={e => setInvestToken(e.target.value as RegisterToken)} disabled={investLoading}>
                      <option value="JSAV">JSAV</option><option value="USDT">USDT</option><option value="USDC">USDC</option>
                    </select>
                    <input className="fx-input text-xs" placeholder={`Amount in ${investToken}`} value={investAmount} onChange={e => setInvestAmount(e.target.value)} disabled={investLoading} />
                    <div className="fx-alert text-xs">Minimum: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{investMetaLoading ? 'Loading…' : investMinText}</span></div>
                    {investError && <div className="fx-alert fx-alert--error text-xs">{investError}</div>}
                    {investTx && <div className="fx-alert fx-alert--success text-xs">✓ Invested! <a href={`https://bscscan.com/tx/${investTx}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a></div>}
                    <div className="flex gap-2">
                      <button className="fx-btn-sweep fx-btn-sweep--emerald flex-1" onClick={handleInvest} disabled={investLoading || investMetaLoading}>{investLoading ? 'Confirming…' : `Confirm (${investToken})`}</button>
                      <button className="fx-btn-sweep fx-btn-sweep--ghost" onClick={() => { setShowInvest(false); setInvestAmount(''); setInvestError(null); setInvestMinText('-'); }} disabled={investLoading}>Cancel</button>
                    </div>
                  </div>
                )}
                <button className="fx-btn-sweep fx-btn-sweep--ghost" onClick={handleClaim} disabled={claimLoading}>{claimLoading ? 'Claiming...' : 'Claim All'}</button>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--fx-ink-subtle)' }}>Claim All updates your internal claimable balance. Use Withdraw to receive JSAV, USDT, or USDC.</p>
                {claimError && <div className="fx-alert fx-alert--error text-xs">{claimError}</div>}
                {claimTx && <div className="fx-alert fx-alert--success text-xs">✓ Claim recorded. <a href={`https://bscscan.com/tx/${claimTx}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a> Then use Withdraw to transfer tokens.</div>}
                {!showWithdraw ? (
                  <button className="fx-btn-sweep fx-btn-sweep--ghost" onClick={() => { setShowWithdraw(true); setWithdrawToken('USDT'); setWithdrawError(null); setWithdrawTx(null); }}>Withdraw</button>
                ) : (
                  <div className="space-y-2">
                    <select className="fx-input text-xs" value={withdrawToken} onChange={e => setWithdrawToken(e.target.value as WithdrawToken)} disabled={withdrawLoading}>
                      <option value="JSAV">JSAV</option><option value="USDT">USDT</option><option value="USDC">USDC</option>
                    </select>
                    {withdrawError && <div className="fx-alert fx-alert--error text-xs">{withdrawError}</div>}
                    {withdrawTx && <div className="fx-alert fx-alert--success text-xs">✓ Withdrawn! <a href={`https://bscscan.com/tx/${withdrawTx}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a></div>}
                    <div className="flex gap-2">
                      <button className="fx-btn-sweep fx-btn-sweep--emerald flex-1" onClick={handleWithdraw} disabled={withdrawLoading}>{withdrawLoading ? 'Confirming...' : `Confirm (${withdrawToken})`}</button>
                      <button className="fx-btn-sweep fx-btn-sweep--ghost" onClick={() => { setShowWithdraw(false); setWithdrawError(null); }} disabled={withdrawLoading}>Cancel</button>
                    </div>
                  </div>
                )}
                <button className="fx-btn-sweep fx-btn-sweep--ghost" onClick={() => { window.location.href = '/p2p'; }}>Open P2P Desk</button>
              </div>
            </div>
          </div>
        </header>

        <DashboardErrorBoundary>
          <Dashboard />
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8 mt-12">
            <aside className="space-y-6 fx-reveal">
              <WalletInfo />
            </aside>
            <div className="protocol-card fx-reveal fx-reveal--delay-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <h2 className="protocol-title">Protocol Snapshot</h2>
                <span className="protocol-badge">BSC Mainnet</span>
              </div>
              <ul>
                <li>Contract: <span className="protocol-address">{JSAVIOR_CONTRACT_ADDRESS}</span></li>
                <li>Total users: {indexedUsersCount === null ? <span>loading</span> : <CountUp value={indexedUsersCount} format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })} />}.</li>
                <li>Registration and investment flows are available in the Command panel.</li>
                <li>Claim All accrues rewards; Withdraw sends the selected asset.</li>
                <li>Stable token support: USDT and USDC.</li>
                <li>All transactions execute directly from your wallet.</li>
              </ul>
            </div>
          </div>
          <footer className="app-footer">
            <p>
              <span>JSAVIOR</span>
              <span className="footer-sep">·</span>
              Next.js · ethers.js · wagmi
              <span className="footer-sep">·</span>
              Binance Smart Chain
            </p>
          </footer>
        </DashboardErrorBoundary>
      </main>
    </div>
  );
}
