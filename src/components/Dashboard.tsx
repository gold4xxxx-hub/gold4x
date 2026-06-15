import React, { useCallback, useEffect, useState } from 'react';
import { useWalletConnection, useBSCNetwork } from '@/hooks/useWalletConnection';
import ProgressBar from './ProgressBar';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
import { ethers } from 'ethers';

/** Explicit latest head for eth_call; avoids stale snapshots from some RPC/wallet defaults. */
const READ_CALL_OPTS = { blockTag: 'latest' as const };

function useCountUp(target: number | null, duration = 1200) {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      return;
    }

    let start: number | null = null;
    let raf: number;

    function step(now: number) {
      if (start === null) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(eased * target!);
      if (t < 1) raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
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

  const animatedCap = useCountUp(cap);
  const animatedClaimable = useCountUp(claimable);
  const animatedTotalEarned = useCountUp(totalEarned);

  const loadDashboard = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isConnected || !address || !(window as any).ethereum || !isBSC) return;
      const silent = Boolean(opts?.silent);
      if (!silent) setLoading(true);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        if (!provider) return;
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);

        const [dashboard, launchTime] = await Promise.all([
          contract.dashboardMegaView.staticCall(address, READ_CALL_OPTS),
          contract.launchTime.staticCall(READ_CALL_OPTS),
        ]);

        let tokenDecimals = 18;
        try {
          tokenDecimals = Number(await contract.decimals.staticCall(READ_CALL_OPTS));
        } catch (e) {
          console.warn('decimals() call failed, defaulting to 18:', e);
          tokenDecimals = 18;
        }

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
            const vol = await contract.monthlyVolume.staticCall(address, m, READ_CALL_OPTS);
            const monthPersonal = fromUnits(vol.personalBV, tokenDecimals);
            const monthTeam = fromUnits(vol.teamBV, tokenDecimals);
            if (monthPersonal > 0 || monthTeam > 0) {
              console.log(`monthlyVolume monthId ${m}:`, { personal: monthPersonal, team: monthTeam });
            }
            totalPersonalBV += monthPersonal;
            totalTeamBV += monthTeam;
          } catch (mvErr) {
            console.warn(`monthlyVolume monthId ${m} failed:`, mvErr);
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
        // Use monthlyVolume data if dashboard returns 0
        const dashPersonalBV = fromUnits(dashboard.personalBV, tokenDecimals);
        const dashTeamBV = fromUnits(dashboard.teamBV, tokenDecimals);
        const dashTotalBV = fromUnits(dashboard.totalBV, tokenDecimals);

        // Use total BV from all months (the contract only returns current month in dashboard)
        const finalPersonalBV = totalPersonalBV > 0 ? totalPersonalBV : dashPersonalBV;
        const finalTeamBV = totalTeamBV > 0 ? totalTeamBV : dashTeamBV;
        const finalTotalBV = finalPersonalBV + finalTeamBV;
        console.log('Final BV values:', { finalPersonalBV, finalTeamBV, finalTotalBV });

        // Compute cumulative legs with BV (contract only checks current month)
        const starBVRequiredBN = await contract.STAR_BV_REQUIRED.staticCall(READ_CALL_OPTS).catch(() => null);
        const starBVRequired = starBVRequiredBN !== null ? fromUnits(starBVRequiredBN, tokenDecimals) : 25000;
        let cumulativeLegsWithBV = 0;
        const dirCount = Number(dashboard.directCount);
        if (dirCount > 0) {
          const directAddrPromises: Promise<string>[] = [];
          for (let i = 0; i < dirCount; i++) {
            directAddrPromises.push(contract.directs.staticCall(address, i, READ_CALL_OPTS));
          }
          const directAddresses = await Promise.all(directAddrPromises);
          for (const legAddr of directAddresses) {
            const monthPromises = [];
            for (let m = launchMonthId; m <= currentMonthId; m++) {
              monthPromises.push(
                contract.monthlyVolume.staticCall(legAddr, m, READ_CALL_OPTS)
                  .catch(() => ({ personalBV: BigInt(0), teamBV: BigInt(0) }))
              );
            }
            const monthlyVols = await Promise.all(monthPromises);
            let legTotal = 0;
            for (const vol of monthlyVols) {
              legTotal += fromUnits(vol.personalBV, tokenDecimals) + fromUnits(vol.teamBV, tokenDecimals);
            }
            if (legTotal >= starBVRequired) cumulativeLegsWithBV++;
          }
        }
        console.log('Cumulative legs with BV (all months):', cumulativeLegsWithBV);

        setPersonalBV(finalPersonalBV);
        setTeamBV(finalTeamBV);
        setTotalBV(finalTotalBV);
        setLegsWithBV(cumulativeLegsWithBV);
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

  const [updatingRank, setUpdatingRank] = useState(false);
  const [lastAutoUpdateAt, setLastAutoUpdateAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isConnected || !address || !(window as any).ethereum || !isBSC) return;
    if (!rankNeedsUpdate) return;
    // Throttle automatic attempts: don't try more than once per 5 minutes
    const now = Date.now();
    if (lastAutoUpdateAt && now - lastAutoUpdateAt < 5 * 60_000) return;
    if (updatingRank) return;

    let cancelled = false;
    (async () => {
      try {
        setUpdatingRank(true);
        setLastAutoUpdateAt(now);
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        if (!provider) return;
        const signer = await provider.getSigner();
        if (!signer) return;
        const contractWithSigner = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, signer);
        const tx = await contractWithSigner.updateRank(address);
        console.log('Auto updateRank tx sent:', tx);
        await tx.wait();
        if (cancelled) return;
        // Refresh dashboard after successful update
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
  }, [rankNeedsUpdate, isConnected, address, isBSC, lastAutoUpdateAt, updatingRank, loadDashboard]);


  return (
    <div className="fx-card p-8 mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="fx-section-title text-xl">Portfolio Overview</h2>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="fx-pill fx-pill--ghost">{fmtRank(effectiveRank)}</span>
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

      <div className="fx-data-strip mb-9" style={{ position: 'relative' }}>
        <div className="fx-data-strip__item" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: -1, left: -1, width: 12, height: 12, borderTop: '2px solid var(--fx-gold)', borderLeft: '2px solid var(--fx-gold)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderBottom: '2px solid var(--fx-gold)', borderRight: '2px solid var(--fx-gold)', opacity: 0.7 }} />
          <div className="fx-data-strip__label">ROI Cap</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-data-strip__value fx-data-strip__value--gold">{fmt(animatedCap)}</div>}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
        <div className="fx-data-strip__item" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: -1, left: -1, width: 12, height: 12, borderTop: '2px solid var(--fx-gold)', borderLeft: '2px solid var(--fx-gold)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderBottom: '2px solid var(--fx-gold)', borderRight: '2px solid var(--fx-gold)', opacity: 0.7 }} />
          <div className="fx-data-strip__label">Withdrawable</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-data-strip__value">{fmt(animatedClaimable)}</div>}
          <div className="fx-data-strip__unit">JSAV Balance</div>
        </div>
        <div className="fx-data-strip__item" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: -1, left: -1, width: 12, height: 12, borderTop: '2px solid var(--fx-gold)', borderLeft: '2px solid var(--fx-gold)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderBottom: '2px solid var(--fx-gold)', borderRight: '2px solid var(--fx-gold)', opacity: 0.7 }} />
          <div className="fx-data-strip__label">Total Earned</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-data-strip__value fx-data-strip__value--gold">{fmt(animatedTotalEarned)}</div>}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Status: <span style={{ color: registered ? 'var(--fx-emerald-bright)' : 'var(--fx-ink-muted)', fontWeight: 400 }}>{registered === null ? '-' : registered ? 'Registered' : 'Not Registered'}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Withdrawn: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmt(withdrawn)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Directs: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmtInt(directCount)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Rank: <span style={{ color: effectiveRank && effectiveRank > 0 ? 'var(--fx-gold-strong)' : 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmtRank(effectiveRank)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Cap Used: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{capPercent === null ? '-' : `${capPercent.toFixed(2)}%`}</span></div>
      </div>

      {/* Removed unused on-chain rank / legs buttons per request */}

      {/* Removed rank explanatory alert per request */}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="fx-stat">
          <div className="fx-stat__label">ROI Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value fx-data-strip__value--gold">{fmt(roiIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Direct Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value">{fmt(directIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Level Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value">{fmt(levelIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label">Rank Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value fx-data-strip__value--gold">{fmt(rankIncome)}</div>}
          <div className="fx-stat__sub">JSAV</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Directs Needed: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmtInt(directsNeeded)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Cap Type: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{capType === null ? '-' : capType}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Available: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmt(available)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Reserved: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmt(reserved)}</span></div>
      </div>

      <div className="fx-divider my-6" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <div className="fx-stat">
          <div className="fx-stat__label" style={{ color: 'var(--fx-ink-subtle)' }}>Personal BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value">{fmt(personalBV)}</div>}
          <div className="fx-stat__sub">Volume</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label" style={{ color: 'var(--fx-ink-subtle)' }}>Team BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value">{fmt(teamBV)}</div>}
          <div className="fx-stat__sub">Volume</div>
        </div>

        <div className="fx-stat">
          <div className="fx-stat__label" style={{ color: 'var(--fx-ink-subtle)' }}>Total BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <div className="fx-stat__value fx-data-strip__value--gold">{fmt(totalBV)}</div>}
          <div className="fx-stat__sub">Volume</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Contract JSAV: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmt(contractJSAV)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Contract USDT: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmt(contractUSDT)}</span></div>
        <div className="fx-alert text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>Contract USDC: <span style={{ color: 'var(--fx-ink-muted)', fontWeight: 400 }}>{fmt(contractUSDC)}</span></div>
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
          {!loading && <div className="text-xs" style={{ color: 'var(--fx-gold-strong)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{percent.toFixed(1)}%</div>}
        </div>
        {loading ? <div className="fx-skeleton h-4 w-full" /> : <ProgressBar percent={percent} />}
        {!loading && (
          <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--fx-ink-subtle)' }}>
            <span>{fmt(invested)} used</span>
            <span>{fmt(cap)} ceiling</span>
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