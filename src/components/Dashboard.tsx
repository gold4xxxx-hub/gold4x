import React, { useCallback, useEffect, useState } from 'react';
import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';
import ProgressBar from './ProgressBar';
import { CountUp } from './CountUp';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
/** Explicit latest head for eth_call; avoids stale snapshots from some RPC/wallet defaults. */
const READ_CALL_OPTS = { blockTag: 'latest' as const };

let _ethers: any = null;
async function getEthers() {
  if (!_ethers) {
    _ethers = (await import('ethers')).ethers;
  }
  return _ethers;
}

function truncateAddress(addr: string) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
}

function fmt(n: number | null): string {
  if (n === null) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtInt(n: number | null): string {
  if (n === null) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtRank(n: number | null): string {
  if (n === null) return '-';
  const rankMap: Record<number, string> = {
    0: 'Not Ranked',
    1: 'Star',
    2: 'Gold',
    3: 'Diamond',
  };
  return rankMap[n] || `Rank ${n}`;
}

function inferEffectiveRank(
  onChainRank: number | null,
  directCount: number | null,
  legsWithBV: number | null,
  legsWithStar: number | null,
  legsWithGold: number | null,
): number | null {
  if (onChainRank === null) return null;
  if (onChainRank > 0) return onChainRank;

  if (directCount === null || directCount < 4) return onChainRank;
  if (legsWithGold !== null && legsWithGold >= 4) return 3;
  if (legsWithStar !== null && legsWithStar >= 4) return 2;
  if (legsWithBV !== null && legsWithBV >= 4) return 1;

  return onChainRank;
}

export const Dashboard: React.FC = () => {
  const { address, isConnected } = useWalletConnection();
  const { isBSC } = useBSCNetwork();
  const [invested, setInvested] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [claimable, setClaimable] = useState<number | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [reserved, setReserved] = useState<number | null>(null);
  const [withdrawn, setWithdrawn] = useState<number | null>(null);
  const [totalEarned, setTotalEarned] = useState<number | null>(null);
  const [roiIncome, setRoiIncome] = useState<number | null>(null);
  const [directIncome, setDirectIncome] = useState<number | null>(null);
  const [levelIncome, setLevelIncome] = useState<number | null>(null);
  const [rankIncome, setRankIncome] = useState<number | null>(null);
  const [directCount, setDirectCount] = useState<number | null>(null);
  const [directsNeeded, setDirectsNeeded] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [capType, setCapType] = useState<number | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [capPercent, setCapPercent] = useState<number | null>(null);
  const [personalBV, setPersonalBV] = useState<number | null>(null);
  const [teamBV, setTeamBV] = useState<number | null>(null);
  const [totalBV, setTotalBV] = useState<number | null>(null);
  const [legsWithBV, setLegsWithBV] = useState<number | null>(null);
  const [legsWithStar, setLegsWithStar] = useState<number | null>(null);
  const [legsWithGold, setLegsWithGold] = useState<number | null>(null);
  const [contractJSAV, setContractJSAV] = useState<number | null>(null);
  const [contractUSDT, setContractUSDT] = useState<number | null>(null);
  const [contractUSDC, setContractUSDC] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadDashboard = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isConnected || !address || !(window as any).ethereum || !isBSC) return;
      const silent = Boolean(opts?.silent);
      if (!silent) setLoading(true);
      try {
        const ethers = await getEthers();
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        if (!provider) return;
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);

        const [dashboard] = await Promise.all([
          contract.dashboardMegaView.staticCall(address, READ_CALL_OPTS),
        ]);

        let tokenDecimals = 18;
        try {
          tokenDecimals = Number(await contract.decimals.staticCall(READ_CALL_OPTS));
        } catch (e) {
          console.warn('decimals() call failed, defaulting to 18:', e);
          tokenDecimals = 18;
        }

        setInvested(Number(ethers.formatUnits(dashboard.totalInvested, tokenDecimals)));
        setCap(Number(ethers.formatUnits(dashboard.totalCap, tokenDecimals)));
        setClaimable(Number(ethers.formatUnits(dashboard.claimable, tokenDecimals)));
        setAvailable(Number(ethers.formatUnits(dashboard.available, tokenDecimals)));
        setReserved(Number(ethers.formatUnits(dashboard.reserved, tokenDecimals)));
        setWithdrawn(Number(ethers.formatUnits(dashboard.withdrawn, tokenDecimals)));
        setTotalEarned(Number(ethers.formatUnits(dashboard.totalEarned, tokenDecimals)));
        setRoiIncome(Number(ethers.formatUnits(dashboard.roi, tokenDecimals)));
        setDirectIncome(Number(ethers.formatUnits(dashboard.direct, tokenDecimals)));
        setLevelIncome(Number(ethers.formatUnits(dashboard.level, tokenDecimals)));
        setRankIncome(Number(ethers.formatUnits(dashboard.rankIncome, tokenDecimals)));
        setDirectCount(Number(dashboard.directCount));
        setDirectsNeeded(Number(dashboard.directsNeeded));

        // Prefer the on-chain `currentRank` call as authoritative — fall back to dashboard.rank only if the call fails.
        let onChainRank: number | null = null;
        try {
          const currentRank = await contract.currentRank.staticCall(address, READ_CALL_OPTS);
          onChainRank = Number(currentRank);
          console.log('currentRank:', onChainRank);
        } catch (rankErr) {
          console.warn('currentRank read failed, falling back to dashboard.rank:', rankErr);
          if (dashboard?.rank !== undefined && dashboard?.rank !== null) {
            onChainRank = Number(dashboard.rank);
            console.log('dashboard.rank used as fallback:', onChainRank);
          }
        }

        setRank(onChainRank);
        setCapType(Number(dashboard.capType));
        setRegistered(Boolean(dashboard.registered));
        setCapPercent(Number(dashboard.capPercent) / 100);

        // Use BV directly from contract (current month only — matches _calculateRank)
        const dashPersonalBV = Number(ethers.formatUnits(dashboard.personalBV, tokenDecimals));
        const dashTeamBV = Number(ethers.formatUnits(dashboard.teamBV, tokenDecimals));
        const finalPersonalBV = dashPersonalBV;
        const finalTeamBV = dashTeamBV;
        const finalTotalBV = dashPersonalBV + dashTeamBV;
        console.log('BV values (current month):', { finalPersonalBV, finalTeamBV, finalTotalBV });

        // Use legs directly from contract (current month only — matches _calculateRank)
        const legsWithBV = Number(dashboard.legsWithBV);
        const legsWithStar = Number(dashboard.legsWithStar);
        const legsWithGold = Number(dashboard.legsWithGold);
        console.log('Contract legs:', { withBV: legsWithBV, withStar: legsWithStar, withGold: legsWithGold });

        setPersonalBV(finalPersonalBV);
        setTeamBV(finalTeamBV);
        setTotalBV(finalTotalBV);
        setLegsWithBV(legsWithBV);
        setLegsWithStar(legsWithStar);
        setLegsWithGold(legsWithGold);
        setContractJSAV(Number(ethers.formatUnits(dashboard.contractJSAV, tokenDecimals)));
        setContractUSDT(Number(ethers.formatUnits(dashboard.contractUSDT, 18)));
        setContractUSDC(Number(ethers.formatUnits(dashboard.contractUSDC, 18)));
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        setInvested(null);
        setCap(null);
        setClaimable(null);
        setAvailable(null);
        setReserved(null);
        setWithdrawn(null);
        setTotalEarned(null);
        setRoiIncome(null);
        setDirectIncome(null);
        setLevelIncome(null);
        setRankIncome(null);
        setDirectCount(null);
        setDirectsNeeded(null);
        setRank(null);
        setCapType(null);
        setRegistered(null);
        setCapPercent(null);
        setPersonalBV(null);
        setTeamBV(null);
        setTotalBV(null);
        setLegsWithBV(null);
        setLegsWithStar(null);
        setLegsWithGold(null);
        setContractJSAV(null);
        setContractUSDT(null);
        setContractUSDC(null);
      }
      if (!silent) setLoading(false);
    },
    [isConnected, address],
  );

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const id = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [isConnected, address, loadDashboard]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadDashboard({ silent: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isConnected, address, loadDashboard]);

  // ── Rank-update hooks (moved before connection guard so all hooks are unconditional) ──
  const [updatingRank, setUpdatingRank] = useState(false);
  const [lastAutoUpdateAt, setLastAutoUpdateAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isConnected || !address || !(window as any).ethereum || !isBSC) return;
    const effectiveRank = inferEffectiveRank(rank, directCount, legsWithBV, legsWithStar, legsWithGold);
    const needsUpdate = rank !== null && effectiveRank !== null && effectiveRank > rank;
    if (!needsUpdate) return;
    const now = Date.now();
    if (lastAutoUpdateAt && now - lastAutoUpdateAt < 5 * 60_000) return;
    if (updatingRank) return;

    let cancelled = false;
    (async () => {
      try {
        setUpdatingRank(true);
        setLastAutoUpdateAt(now);
        const ethers = await getEthers();
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        if (!provider) return;
        const signer = await provider.getSigner();
        if (!signer) return;
        const contractWithSigner = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
        const tx = await contractWithSigner.updateRank(address);
        console.log('Auto updateRank tx sent:', tx);
        await tx.wait();
        if (cancelled) return;
        await loadDashboard();
      } catch (err) {
        console.warn('Auto updateRank failed:', err);
      } finally {
        if (!cancelled) setUpdatingRank(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, isBSC, rank, directCount, legsWithBV, legsWithStar, legsWithGold, lastAutoUpdateAt, updatingRank, loadDashboard]);

  // ── Connection guard ────────────────────────────────────────────────────────────────
  if (!isConnected || !address) {
    return (
      <div className="fx-card p-8 fx-reveal">
        <div className="flex items-center justify-between mb-6">
          <h2 className="fx-section-title text-xl">Portfolio Overview</h2>
        </div>
        <p className="text-sm" style={{ color: 'var(--fx-ink-subtle)' }}>
          Connect your wallet to view portfolio data.
        </p>
      </div>
    );
  }

  let percent = 0;
  if (invested !== null && cap && cap > 0) {
    percent = Math.min(100, (invested / cap) * 100);
  }

  const effectiveRank = inferEffectiveRank(rank, directCount, legsWithBV, legsWithStar, legsWithGold);
  const rankNeedsUpdate =
    rank !== null &&
    effectiveRank !== null &&
    effectiveRank > rank;

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="fx-card p-8 fx-reveal">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="fx-section-title text-xl">Portfolio Overview</h2>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            className="fx-button fx-button--dark fx-button--sm"
            onClick={() => window.location.href = '/p2p'}
          >
            P2P Desk
          </button>
          <button
            className="fx-button fx-button--dark fx-button--sm"
            onClick={() => void loadDashboard()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="fx-data-strip mb-8 fx-reveal--slow" style={{ position: 'relative' }}>
        <div className="fx-data-strip__item fx-reveal" style={{ position: 'relative', transitionDelay: '250ms', background: '#111111', borderRadius: '12px' }}>
          <div className="fx-data-strip__label">ROI Cap</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={cap} duration={1500} startDelay={200} format={fmt} className="fx-data-strip__value fx-data-strip__value--hero-sm" />}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
        <div className="fx-data-strip__item fx-reveal" style={{ position: 'relative', transitionDelay: '0ms', background: '#191919', borderRadius: '12px' }}>
          <div className="fx-data-strip__label">Withdrawable</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={claimable} duration={1500} startDelay={200} format={fmt} className="fx-data-strip__value fx-data-strip__value--gold-bright fx-data-strip__value--hero-lg" />}
          <div className="fx-data-strip__unit">JSAV Balance</div>
        </div>
        <div className="fx-data-strip__item fx-reveal" style={{ position: 'relative', transitionDelay: '120ms' }}>
          <div className="fx-data-strip__label">Total Earned</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={totalEarned} duration={1500} startDelay={200} format={fmt} className="fx-data-strip__value fx-data-strip__value--gold" />}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="portfolio-info-row grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="fx-alert text-xs fx-reveal">Status: <span style={{ color: registered ? 'var(--fx-emerald-bright)' : 'var(--fx-ink-muted)', fontWeight: 600 }}>{registered === null ? '-' : registered ? 'Registered' : 'Not Registered'}</span></div>
        <div className="fx-alert text-xs fx-reveal fx-reveal--delay-1">Withdrawn: <span style={{ fontWeight: 500 }}><CountUp value={withdrawn} format={fmt} /></span></div>
        <div className="fx-alert text-xs fx-reveal fx-reveal--delay-2">Directs: <span style={{ fontWeight: 500 }}><CountUp value={directCount} format={fmtInt} /></span></div>
        <div className="fx-alert text-xs fx-reveal fx-reveal--delay-3">Cap Used: <span style={{ fontWeight: 500 }}>{capPercent === null ? '-' : `${capPercent.toFixed(2)}%`}</span></div>
      </div>

      {/* Removed unused on-chain rank / legs buttons per request */}

      {/* Removed rank explanatory alert per request */}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <div className="fx-stat fx-reveal fx-reveal--offset-300">
          <div className="fx-stat__label">ROI Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={roiIncome} format={fmt} className="fx-stat__value fx-data-strip__value--gold" />}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat fx-reveal fx-reveal--delay-1 fx-reveal--offset-300">
          <div className="fx-stat__label">Direct Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={directIncome} format={fmt} className="fx-stat__value" />}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat fx-reveal fx-reveal--delay-2 fx-reveal--offset-300">
          <div className="fx-stat__label">Level Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={levelIncome} format={fmt} className="fx-stat__value" />}
          <div className="fx-stat__sub">JSAV</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="fx-alert text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>Directs Needed: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 500 }}><CountUp value={directsNeeded} format={fmtInt} /></span></div>
        <div className="fx-alert text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>Cap Type: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 500 }}>{capType === null ? '-' : capType}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>Available: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', minWidth: '110px', display: 'inline-block' }}><CountUp value={available} format={fmt} /></span></div>
        <div className="fx-alert text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>Reserved: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', minWidth: '100px', display: 'inline-block' }}><CountUp value={reserved} format={fmt} /></span></div>
      </div>

      <div className="fx-divider my-6" />

      <div className="bv-stats grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6 fx-reveal fx-reveal--delay-2">
        <div className="fx-stat">
          <div className="fx-stat__label">Personal BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={personalBV} format={fmt} className="fx-stat__value" />}
          <div className="fx-stat__sub">Volume</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Team BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={teamBV} format={fmt} className="fx-stat__value" />}
          <div className="fx-stat__sub">Volume</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Total BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={totalBV} format={fmt} className="fx-stat__value fx-data-strip__value--gold" />}
          <div className="fx-stat__sub">Volume</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="contract-info-row grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="fx-alert text-xs">Contract JSAV: <span style={{ fontWeight: 500 }}><CountUp value={contractJSAV} format={fmt} /></span></div>
        <div className="fx-alert text-xs">Contract USDT: <span style={{ fontWeight: 500 }}><CountUp value={contractUSDT} format={fmt} /></span></div>
        <div className="fx-alert text-xs">Contract USDC: <span style={{ fontWeight: 500 }}><CountUp value={contractUSDC} format={fmt} /></span></div>
      </div>

      {rankNeedsUpdate && (
        <div className="fx-alert text-xs mb-6">
          Rank achieved by team criteria: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmtRank(effectiveRank)}</span>. On-chain rank update is pending.
        </div>
      )}

      <div className="fx-alert text-xs mb-6">
        Can Claim Now:{' '}
<span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>
          {claimable === null ? '-' : claimable > 0 ? 'Yes' : 'No'}
        </span>
      </div>

        <div className="mb-6">
          <div className="flex items-end justify-between mb-1">
            <div className="text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Capital Allocation</div>
            {!loading && <div className="text-xs" style={{ color: 'var(--fx-ink-muted)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{percent.toFixed(1)}%</div>}
          </div>
          {loading ? <div className="fx-skeleton h-4 w-full" /> : <ProgressBar percent={percent} />}
          {!loading && (
            <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--fx-ink-subtle)' }}>
              <span><CountUp value={invested} format={fmt} /> used</span>
              <span><CountUp value={cap} format={fmt} /> ceiling</span>
            </div>
          )}
        </div>

      <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--fx-ink-subtle)' }} />
          <span className="fx-address-mono">{truncateAddress(address || '')}</span>
        </div>
        <button
          onClick={handleCopy}
          className="fx-copy-btn"
          title="Copy address"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default Dashboard;