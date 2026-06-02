import React, { useCallback, useEffect, useState } from 'react';
import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';
import ProgressBar from './ProgressBar';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
import { ethers } from 'ethers';

/** Explicit latest head for eth_call; avoids stale snapshots from some RPC/wallet defaults. */
const READ_CALL_OPTS = { blockTag: 'latest' as const };

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
  totalBV: number | null,
  teamBV: number | null,
  personalBV: number | null = null,
): number | null {
  if (onChainRank === null) return null;
  if (onChainRank > 0) return onChainRank;

  // Must have at least 4 direct referrals to qualify for any rank
  if (directCount === null || directCount < 4) return onChainRank;

  // Diamond: 4+ legs with Gold rank
  if (legsWithGold !== null && legsWithGold >= 4) return 3;
  
  // Gold: 4+ legs with Star rank
  if (legsWithStar !== null && legsWithStar >= 4) return 2;
  
  // Star: 4+ legs with BV OR sufficient BV (personal or team)
  if (legsWithBV !== null && legsWithBV >= 4) return 1;
  if (personalBV !== null && personalBV >= 10000) return 1;
  if (totalBV !== null && totalBV >= 10000) return 1;

  return onChainRank;
}

function fromUnits(value: unknown, decimals: number): number {
  const v = value as bigint | number | string;
  return Number(ethers.formatUnits(v, decimals));
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
  const [rankUpdateLoading, setRankUpdateLoading] = useState(false);

  const loadDashboard = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isConnected || !address || !(window as any).ethereum || !isBSC) return;
      const silent = Boolean(opts?.silent);
      if (!silent) setLoading(true);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);

        const [dashboard, tokenDecimalsRaw, launchTime] = await Promise.all([
          contract.dashboardMegaView(address, READ_CALL_OPTS),
          contract.decimals(READ_CALL_OPTS),
          contract.launchTime(READ_CALL_OPTS),
        ]);

        const tokenDecimals = Number(tokenDecimalsRaw);

        // Calculate month IDs like the contract does: block.timestamp / 30 days
        const now = Math.floor(Date.now() / 1000);
        const launch = Number(launchTime);
        const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;
        const currentMonthId = Math.floor(now / SECONDS_PER_MONTH);
        const launchMonthId = Math.floor(launch / SECONDS_PER_MONTH);
        console.log('Month calculation:', { now, launch, currentMonthId, launchMonthId });

        // Fetch ALL monthly volumes and sum them up (BV is stored per month by timestamp)
        let totalPersonalBV = 0;
        let totalTeamBV = 0;
        for (let m = launchMonthId; m <= currentMonthId; m++) {
          try {
            const vol = await contract.monthlyVolume(address, m, READ_CALL_OPTS);
            const monthPersonal = fromUnits(vol.personalBV, tokenDecimals);
            const monthTeam = fromUnits(vol.teamBV, tokenDecimals);
            if (monthPersonal > 0 || monthTeam > 0) {
              console.log(`monthlyVolume monthId ${m}:`, { personal: monthPersonal, team: monthTeam });
            }
            totalPersonalBV += monthPersonal;
            totalTeamBV += monthTeam;
          } catch (mvErr) {
            // Continue to next month
          }
        }
        console.log('Total BV across all months:', { totalPersonalBV, totalTeamBV, monthsChecked: currentMonthId - launchMonthId + 1 });

        // Debug: log raw BV values from contract
        console.log('Raw dashboard:', dashboard);
        console.log('Dashboard type:', typeof dashboard, Array.isArray(dashboard) ? 'isArray' : 'notArray');
        console.log('Keys:', Object.keys(dashboard));
        console.log('Index 15-17:', dashboard[15]?.toString?.(), dashboard[16]?.toString?.(), dashboard[17]?.toString?.());
        console.log('Named props:', {
          personalBV: dashboard.personalBV?.toString?.(),
          teamBV: dashboard.teamBV?.toString?.(),
          totalBV: dashboard.totalBV?.toString?.(),
        });
        console.log('Full dashboard array:', Array.from(dashboard).map((v, i) => `${i}: ${v?.toString?.()}`).join(', '));

        setInvested(fromUnits(dashboard.totalInvested, tokenDecimals));
        setCap(fromUnits(dashboard.totalCap, tokenDecimals));
        setClaimable(fromUnits(dashboard.claimable, tokenDecimals));
        setAvailable(fromUnits(dashboard.available, tokenDecimals));
        setReserved(fromUnits(dashboard.reserved, tokenDecimals));
        setWithdrawn(fromUnits(dashboard.withdrawn, tokenDecimals));
        setTotalEarned(fromUnits(dashboard.totalEarned, tokenDecimals));
        setRoiIncome(fromUnits(dashboard.roi, tokenDecimals));
        setDirectIncome(fromUnits(dashboard.direct, tokenDecimals));
        setLevelIncome(fromUnits(dashboard.level, tokenDecimals));
        setRankIncome(fromUnits(dashboard.rankIncome, tokenDecimals));
        setDirectCount(Number(dashboard.directCount));
        setDirectsNeeded(Number(dashboard.directsNeeded));

        let onChainRank: number | null = null;
        if (dashboard?.rank !== undefined && dashboard?.rank !== null) {
          onChainRank = Number(dashboard.rank);
        } else {
          try {
            const currentRank = await contract.currentRank(address, READ_CALL_OPTS);
            onChainRank = Number(currentRank);
            console.log('Fallback currentRank:', onChainRank);
          } catch (rankErr) {
            console.warn('currentRank fallback failed:', rankErr);
          }
        }

        setRank(onChainRank);
        setCapType(Number(dashboard.capType));
        setRegistered(Boolean(dashboard.registered));
        setCapPercent(Number(dashboard.capPercent) / 100);
        // Use monthlyVolume data if dashboard returns 0
        const dashPersonalBV = fromUnits(dashboard.personalBV, tokenDecimals);
        const dashTeamBV = fromUnits(dashboard.teamBV, tokenDecimals);
        const dashTotalBV = fromUnits(dashboard.totalBV, tokenDecimals);

        // Use total BV from all months (the contract only returns current month in dashboard)
        const finalPersonalBV = totalPersonalBV > 0 ? totalPersonalBV : dashPersonalBV;
        const finalTeamBV = totalTeamBV > 0 ? totalTeamBV : dashTeamBV;
        const finalTotalBV = totalPersonalBV > 0 || totalTeamBV > 0 ? finalPersonalBV + finalTeamBV : dashTotalBV;
        console.log('Final BV values:', { finalPersonalBV, finalTeamBV, finalTotalBV, dashTotalBV });

        setPersonalBV(finalPersonalBV);
        setTeamBV(finalTeamBV);
        setTotalBV(finalTotalBV);
        setLegsWithBV(Number(dashboard.legsWithBV));
        setLegsWithStar(Number(dashboard.legsWithStar));
        setLegsWithGold(Number(dashboard.legsWithGold));
        setContractJSAV(fromUnits(dashboard.contractJSAV, tokenDecimals));
        setContractUSDT(fromUnits(dashboard.contractUSDT, 18));
        setContractUSDC(fromUnits(dashboard.contractUSDC, 18));
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

  if (!isConnected) return null;

  let percent = 0;
  if (invested !== null && cap && cap > 0) {
    percent = Math.min(100, (invested / cap) * 100);
  }

  const effectiveRank = inferEffectiveRank(rank, directCount, legsWithBV, legsWithStar, legsWithGold, totalBV, teamBV, personalBV);
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

  const handleUpdateRank = async () => {
    if (!(window as any).ethereum || !address) {
      alert('Wallet not connected');
      return;
    }
    setRankUpdateLoading(true);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
      const tx = await contract.updateRank(address);
      const receipt = await tx.wait();
      alert(`Rank updated! TX: ${receipt.hash}`);
      // Reload dashboard to show new on-chain rank
      await new Promise(r => setTimeout(r, 1000));
      void loadDashboard();
    } catch (error: any) {
      alert(`Failed to update rank: ${error?.reason || error?.message || 'Unknown error'}`);
    } finally {
      setRankUpdateLoading(false);
    }
  };

  return (
    <div className="fx-card p-6 mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <div className="fx-kicker mb-1">Portfolio Overview</div>
          <h2 className="fx-section-title text-xl">Dashboard</h2>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="fx-pill fx-pill--ghost">{fmtRank(effectiveRank)}</span>
          <button
            className="fx-button fx-button--dark fx-button--sm"
            onClick={() => void loadDashboard({ silent: true })}
            title="Refresh dashboard data"
            disabled={loading}
          >
            {loading ? '⟳ Syncing...' : '⟳ Refresh'}
          </button>
          <button
            className="fx-button fx-button--dark fx-button--sm"
            onClick={() => window.location.href = '/p2p'}
          >
            P2P Desk
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="fx-stat">
          <div className="fx-stat__label">ROI Cap</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value" style={{ color: 'var(--fx-gold-strong)' }}>{fmt(cap)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Withdrawable</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value" style={{ color: 'var(--fx-emerald-bright)' }}>{fmt(claimable)}</div>}
          <div className="fx-stat__sub">JSAV Balance</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Total Earned</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value" style={{ color: '#c084fc' }}>{fmt(totalEarned)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Withdrawn</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value" style={{ color: '#93c5fd' }}>{fmt(withdrawn)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <div className="fx-alert text-xs">Status: <span className="gold-text">{registered === null ? '-' : registered ? 'Registered' : 'Not Registered'}</span></div>
        <div className="fx-alert text-xs">Directs: <span className="gold-text">{fmtInt(directCount)}</span></div>
        <div className="fx-alert text-xs">Rank: <span className="gold-text">{fmtRank(effectiveRank)}</span></div>
        <div className="fx-alert text-xs">Cap Used: <span className="gold-text">{capPercent === null ? '-' : `${capPercent.toFixed(2)}%`}</span></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <div className="fx-alert text-xs">
          On-chain rank: <span className="gold-text">{rank === null ? '-' : fmtRank(rank)}</span>
        </div>
        <div className="fx-alert text-xs">
          Legs w/ BV: <span className="gold-text">{fmtInt(legsWithBV)}</span>
        </div>
        <div className="fx-alert text-xs">
          Legs w/ Star: <span className="gold-text">{fmtInt(legsWithStar)}</span>
        </div>
        <div className="fx-alert text-xs">
          Legs w/ Gold: <span className="gold-text">{fmtInt(legsWithGold)}</span>
        </div>
      </div>

      {!loading &&
        rank === 0 &&
        directCount !== null &&
        directCount >= 4 &&
        effectiveRank === 0 && (
          <div className="fx-alert text-xs mb-6" style={{ color: 'var(--fx-ink-subtle)' }}>
            Rank label stays Not Ranked until the contract stores a rank or reports ≥4 qualifying legs (BV / Star / Gold).
            Large team BV alone does not override those counters.
          </div>
        )}

      {!loading && rankNeedsUpdate && (
        <div className="fx-alert text-xs mb-6" style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--fx-emerald-bright)' }}>
          <div className="flex items-center justify-between">
            <span>
              ✓ You qualify for <strong>{fmtRank(effectiveRank)}</strong> rank! Click below to persist on-chain.
            </span>
            <button
              className="fx-button fx-button--sm"
              style={{ background: 'var(--fx-emerald-bright)', color: '#000' }}
              onClick={handleUpdateRank}
              disabled={rankUpdateLoading}
            >
              {rankUpdateLoading ? 'Updating...' : 'Update Rank'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="fx-stat">
          <div className="fx-stat__label">ROI Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(roiIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Direct Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(directIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Level Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(levelIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Rank Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(rankIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="fx-alert text-xs">Directs Needed: <span className="gold-text">{fmtInt(directsNeeded)}</span></div>
        <div className="fx-alert text-xs">Cap Type: <span className="gold-text">{capType === null ? '-' : capType}</span></div>
        <div className="fx-alert text-xs">Available: <span className="gold-text">{fmt(available)}</span></div>
        <div className="fx-alert text-xs">Reserved: <span className="gold-text">{fmt(reserved)}</span></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <div className="fx-stat">
          <div className="fx-stat__label">Personal BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(personalBV)}</div>}
          <div className="fx-stat__sub">Volume</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Team BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(teamBV)}</div>}
          <div className="fx-stat__sub">Volume</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Total BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24 mt-1" /> : <div className="fx-stat__value">{fmt(totalBV)}</div>}
          <div className="fx-stat__sub">Volume</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
        <div className="fx-alert text-xs">Contract JSAV: <span className="gold-text">{fmt(contractJSAV)}</span></div>
        <div className="fx-alert text-xs">Contract USDT: <span className="gold-text">{fmt(contractUSDT)}</span></div>
        <div className="fx-alert text-xs">Contract USDC: <span className="gold-text">{fmt(contractUSDC)}</span></div>
      </div>

      {rankNeedsUpdate && (
        <div className="fx-alert text-xs mb-6">
          Rank achieved by team criteria: <span className="gold-text">{fmtRank(effectiveRank)}</span>. On-chain rank update is pending.
        </div>
      )}

      <div className="fx-alert text-xs mb-6">
        Can Claim Now:{' '}
        <span className="gold-text">
          {claimable === null ? '-' : claimable > 0 ? 'Yes' : 'No'}
        </span>
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2 text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>
          <span>Investment Progress</span>
          <span style={{ color: 'var(--fx-gold-strong)', fontWeight: 600 }}>{percent.toFixed(1)}%</span>
        </div>
        {loading ? <div className="fx-skeleton h-1.5 w-full" /> : <ProgressBar percent={percent} />}
        {!loading && (
          <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--fx-ink-subtle)' }}>
            <span>{fmt(invested)} invested</span>
            <span>{fmt(cap)} cap</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--fx-emerald)', boxShadow: '0 0 8px rgba(0,201,173,0.65)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--fx-ink-muted)' }}>{truncateAddress(address || '')}</span>
        </div>
        <button
          onClick={handleCopy}
          className="text-xs transition-colors"
          style={{ color: copied ? 'var(--fx-emerald-bright)' : 'var(--fx-ink-subtle)' }}
        >
          {copied ? 'Copied' : 'Copy address'}
        </button>
      </div>
    </div>
  );
};

export default Dashboard;