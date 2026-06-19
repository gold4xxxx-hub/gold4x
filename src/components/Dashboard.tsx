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

const LAUNCH_TIME = 1773541606;
const CYCLE_SECS = 2592000;

function useCycleCountdown() {
  const [countdown, setCountdown] = useState<{ d: number; h: number; m: number; s: number; progress: number } | null>(null);
  useEffect(() => {
    function tick() {
      const now = Math.floor(Date.now() / 1000);
      const monthId = Math.floor((now - LAUNCH_TIME) / CYCLE_SECS);
      const nextReset = (monthId + 1) * CYCLE_SECS + LAUNCH_TIME;
      const diff = nextReset - now;
      if (diff <= 0) { setCountdown(null); return; }
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      const progress = (diff / CYCLE_SECS) * 100;
      setCountdown({ d, h, m, s, progress });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return countdown;
}

export const Dashboard: React.FC = () => {
  const { address, isConnected } = useWalletConnection();
  const { isBSC } = useBSCNetwork();
  const countdown = useCycleCountdown();
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
  const [allTimePersonalBV, setAllTimePersonalBV] = useState<number | null>(null);
  const [allTimeTeamBV, setAllTimeTeamBV] = useState<number | null>(null);
  const [allTimeTotalBV, setAllTimeTotalBV] = useState<number | null>(null);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<{ month: number; start: string; end: string; personalBV: number; teamBV: number; totalBV: number }[] | null>(null);
  const [joinDate, setJoinDate] = useState<string | null>(null);
  const [showMonthlyBreakdown, setShowMonthlyBreakdown] = useState(false);
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

        // Fetch all-time BV by launch-relative cycles (aligns with BV reset schedule)
        try {
          const CYCLE = 2592000;
          const now = Math.floor(Date.now() / 1000);
          const currentCycle = Math.floor((now - LAUNCH_TIME) / CYCLE);
          let sumPersonal = 0;
          let sumTeam = 0;
          let firstActiveEpoch: number | null = null;
          const breakdown: { month: number; start: string; end: string; personalBV: number; teamBV: number; totalBV: number }[] = [];
          for (let c = 0; c <= currentCycle; c++) {
            const cycleStart = LAUNCH_TIME + c * CYCLE;
            const cycleEnd = cycleStart + CYCLE;
            const startEpoch = Math.floor(cycleStart / CYCLE);
            const endEpoch = Math.floor((cycleEnd - 1) / CYCLE);
            let p = 0, t = 0;
            for (let m = startEpoch; m <= endEpoch; m++) {
              const vol = await contract.monthlyVolume.staticCall(address, m, READ_CALL_OPTS);
              const pv = Number(ethers.formatUnits(vol.personalBV, tokenDecimals));
              const tv = Number(ethers.formatUnits(vol.teamBV, tokenDecimals));
              p += pv;
              t += tv;
              if (firstActiveEpoch === null && (pv > 0 || tv > 0)) {
                firstActiveEpoch = m;
              }
            }
            sumPersonal += p;
            sumTeam += t;
            const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
            breakdown.push({
              month: c + 1,
              start: fmtDate(cycleStart),
              end: fmtDate(cycleEnd),
              personalBV: p,
              teamBV: t,
              totalBV: p + t,
            });
          }
          setAllTimePersonalBV(sumPersonal);
          setAllTimeTeamBV(sumTeam);
          setAllTimeTotalBV(sumPersonal + sumTeam);
          setMonthlyBreakdown(breakdown);
          // Show fallback date immediately from cycle data (already computed)
          if (firstActiveEpoch !== null) {
            const cycleIndex = Math.max(0, Math.floor((firstActiveEpoch * CYCLE - LAUNCH_TIME) / CYCLE));
            const cycleStartDate = new Date((LAUNCH_TIME + cycleIndex * CYCLE) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
            setJoinDate(`Cycle ${cycleIndex + 1} · ${cycleStartDate}`);
          }
          // Try fetching exact first transaction date from BscScan via API (overrides fallback)
          (async () => {
            try {
              const res = await fetch(`/api/user/join-date/${address}`);
              if (res.ok) {
                const data = await res.json();
                if (data.date) {
                  const d = new Date(data.date.replace(' ', 'T') + 'Z');
                  if (!isNaN(d.getTime())) {
                    setJoinDate(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }));
                  }
                }
              }
            } catch (_) { /* ignore */ }
          })();
        } catch (err2) {
          console.warn('All-time BV fetch failed:', err2);
        }
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
        setAllTimePersonalBV(null);
        setAllTimeTeamBV(null);
        setAllTimeTotalBV(null);
        setMonthlyBreakdown(null);
        setJoinDate(null);
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
      {countdown && (
        <div className="fx-cycle-countdown" style={{ background: '#141414', borderLeft: '3px solid #c9a84c', borderRadius: '10px', padding: '12px 20px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.85), 0 60px 120px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <div className="fx-cycle-countdown__label" style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fx-ink-label)', fontWeight: 500, lineHeight: 1.2 }}>BV CYCLE<br />RESETS IN</div>
          </div>
          <div className="fx-cycle-countdown__units" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {([
              { label: 'D', value: countdown.d },
              { label: 'H', value: countdown.h },
              { label: 'M', value: countdown.m },
              { label: 'S', value: countdown.s },
            ] as const).map((unit, i) => (
              <React.Fragment key={unit.label}>
                {i > 0 && <span className="fx-cycle-countdown__sep" style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.12)', fontWeight: 300, margin: '0 4px', marginTop: '-10px' }}>:</span>}
                <div className="fx-cycle-countdown__unit" style={{ textAlign: 'center', minWidth: '34px' }}>
                  <div className="fx-cycle-countdown__value" style={{ fontSize: '1.35rem', fontWeight: 600, color: '#c9a84c', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, letterSpacing: '-0.02em' }}>{String(unit.value).padStart(2, '0')}</div>
                  <div className="fx-cycle-countdown__unit-label" style={{ fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fx-ink-subtle)', fontWeight: 500, marginTop: '1px' }}>{unit.label}</div>
                </div>
              </React.Fragment>
            ))}
          </div>
          <div className="fx-cycle-countdown__ring" style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <svg width={40} height={40} viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
              <circle cx="20" cy="20" r="16" fill="none" stroke="#c9a84c" strokeWidth="3" strokeDasharray={100.531} strokeDashoffset={100.531 * (1 - countdown.progress / 100)} transform="rotate(-90 20 20)" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}
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

      <div className="fx-data-strip fx-data-strip--top mb-8 fx-reveal--slow" style={{ position: 'relative' }}>
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
        <div className="fx-data-strip__item fx-reveal" style={{ position: 'relative', transitionDelay: '120ms', background: '#111111', borderRadius: '12px' }}>
          <div className="fx-data-strip__label">Total Earned</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={totalEarned} duration={1500} startDelay={200} format={fmt} className="fx-data-strip__value fx-data-strip__value--gold" />}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="fx-data-strip fx-data-strip--status mb-6 fx-reveal--slow" style={{ position: 'relative', padding: 0 }}>
        <div className="fx-data-strip__item fx-reveal" style={{ padding: '16px 20px' }}>
          <div className="fx-data-strip__label">Status</div>
          {registered === null ? (
            <span style={{ fontSize: '0.85rem', color: 'var(--fx-ink-muted)', fontWeight: 400 }}>-</span>
          ) : registered ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'rgb(0,201,173)', boxShadow: '0 0 6px rgba(0,201,173,0.6)', animation: 'fxPulse 2s ease-in-out infinite' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgb(0,201,173)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Registered</span>
            </div>
          ) : (
            <span style={{ fontSize: '0.85rem', color: 'var(--fx-ink-muted)', fontWeight: 400 }}>Not Registered</span>
          )}
        </div>

        <div className="fx-data-strip__item fx-reveal fx-reveal--delay-1" style={{ padding: '16px 20px' }}>
          <div className="fx-data-strip__label">Joined</div>
          {loading ? <div className="fx-skeleton h-5 w-24" /> : <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>{joinDate || (registered ? '—' : '-')}</span>}
        </div>

        <div className="fx-data-strip__item fx-reveal fx-reveal--delay-2" style={{ padding: '16px 20px' }}>
          <div className="fx-data-strip__label">Withdrawn</div>
          {loading ? <div className="fx-skeleton h-6 w-20" /> : (
            <div style={{ marginTop: '4px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}><CountUp value={withdrawn} format={fmt} /></span>
              <div style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fx-ink-subtle)', marginTop: '1px' }}>JSAV</div>
            </div>
          )}
        </div>

        <div className="fx-data-strip__item fx-reveal fx-reveal--delay-3" style={{ padding: '16px 20px' }}>
          <div className="fx-data-strip__label">Directs</div>
          {loading ? <div className="fx-skeleton h-6 w-16" /> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fx-ink-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}><CountUp value={directCount} format={fmtInt} /></span>
            </div>
          )}
        </div>

        <div className="fx-data-strip__item fx-reveal fx-reveal--delay-4" style={{ padding: '16px 20px' }}>
          <div className="fx-data-strip__label">Cap Used</div>
          {loading ? <div className="fx-skeleton h-6 w-16" /> : (() => {
            if (capPercent === null) return <span style={{ fontSize: '0.85rem', color: 'var(--fx-ink-muted)', fontVariantNumeric: 'tabular-nums', fontWeight: 400 }}>-</span>;
            const c = capPercent <= 50 ? 'rgb(0,201,173)' : capPercent <= 80 ? '#c9a84c' : capPercent <= 95 ? '#f59e0b' : '#ef4444';
            return (
              <div style={{ marginTop: '4px', width: '100%' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: c, fontVariantNumeric: 'tabular-nums' }}>{capPercent.toFixed(2)}%</span>
                <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, capPercent)}%`, height: '100%', background: c, borderRadius: '2px' }} />
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Removed unused on-chain rank / legs buttons per request */}

      {/* Removed rank explanatory alert per request */}

      <div className="fx-data-strip mb-6 fx-reveal fx-reveal--offset-300">
        <div className="fx-data-strip__item fx-reveal">
          <div className="fx-data-strip__label">ROI Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={roiIncome} format={fmt} className="fx-data-strip__value fx-data-strip__value--gold" />}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
        <div className="fx-data-strip__item fx-reveal fx-reveal--delay-1">
          <div className="fx-data-strip__label">Direct Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={directIncome} format={fmt} className="fx-data-strip__value" />}
          <div className="fx-data-strip__unit">JSAV</div>
        </div>
        <div className="fx-data-strip__item fx-reveal fx-reveal--delay-2">
          <div className="fx-data-strip__label">Level Income</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={levelIncome} format={fmt} className="fx-data-strip__value" />}
          <div className="fx-data-strip__unit">JSAV</div>
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

      <div className="fx-data-strip mb-6 fx-reveal fx-reveal--delay-2">
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label">Personal BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={personalBV} format={fmt} className="fx-data-strip__value" />}
          <div className="fx-data-strip__unit">Volume</div>
        </div>
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label">Team BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={teamBV} format={fmt} className="fx-data-strip__value" />}
          <div className="fx-data-strip__unit">Volume</div>
        </div>
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label">Total BV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={totalBV} format={fmt} className="fx-data-strip__value fx-data-strip__value--gold" />}
          <div className="fx-data-strip__unit">Volume</div>
        </div>
      </div>

      <div className="fx-divider my-6" />

      <div className="fx-data-strip fx-data-strip--alltime mb-6 fx-reveal fx-reveal--delay-3">
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label fx-data-strip__label--alltime">
            <span className="fx-data-strip__label-line1">All-Time</span>
            <span className="fx-data-strip__label-line2">Personal BV</span>
          </div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={allTimePersonalBV} format={fmt} className="fx-data-strip__value" />}
          <div className="fx-data-strip__unit">Cumulative</div>
        </div>
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label fx-data-strip__label--alltime">
            <span className="fx-data-strip__label-line1">All-Time</span>
            <span className="fx-data-strip__label-line2">Team BV</span>
          </div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={allTimeTeamBV} format={fmt} className="fx-data-strip__value" />}
          <div className="fx-data-strip__unit">Cumulative</div>
        </div>
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label fx-data-strip__label--alltime">
            <span className="fx-data-strip__label-line1">All-Time</span>
            <span className="fx-data-strip__label-line2">Total BV</span>
          </div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={allTimeTotalBV} format={fmt} className="fx-data-strip__value fx-data-strip__value--gold" />}
          <div className="fx-data-strip__unit">Cumulative</div>
        </div>
      </div>

      {monthlyBreakdown && monthlyBreakdown.length > 0 && (
        <div className="mb-6 fx-reveal">
          <button
            onClick={() => setShowMonthlyBreakdown(!showMonthlyBreakdown)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              background: '#141414',
              border: 'none',
              borderLeft: '2px solid #c9a84c',
              borderRadius: '10px',
              cursor: 'pointer',
              boxShadow: '0 20px 40px rgba(0,0,0,0.85), 0 60px 120px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
            onMouseLeave={e => e.currentTarget.style.background = '#141414'}
          >
            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fx-ink-label)', fontWeight: 500 }}>Monthly BV Breakdown</span>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--fx-ink-subtle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', transform: showMonthlyBreakdown ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showMonthlyBreakdown && (
            <div className="fx-monthly-grid" style={{ marginTop: '8px', animation: 'fxFadeIn 0.4s ease' }}>
              {/* Desktop table */}
              <div className="fx-monthly-grid__desktop" style={{ background: '#0F0F0F', borderRadius: '8px', overflow: 'hidden' }}>
                <div className="fx-monthly-grid__row fx-monthly-grid__header" style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr', padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fx-ink-subtle)', fontWeight: 500 }}>#</span>
                  <span className="fx-cycle-header" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fx-ink-subtle)', fontWeight: 500 }}>Cycle</span>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fx-ink-subtle)', fontWeight: 500, textAlign: 'right' }}>Personal BV</span>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fx-ink-subtle)', fontWeight: 500, textAlign: 'right' }}>Team BV</span>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fx-ink-subtle)', fontWeight: 500, textAlign: 'right' }}>Total BV</span>
                </div>
                {monthlyBreakdown.map((row, i) => (
                  <div key={row.month} className="fx-monthly-grid__row" style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr', padding: '7px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.045)'} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent'}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--fx-ink-subtle)', fontVariantNumeric: 'tabular-nums' }}>{row.month}</span>
                    <span style={{ fontSize: '0.7rem', color: '#c9a84c', fontWeight: 500 }}>{row.start} → {row.end}</span>
                    <span style={{ fontSize: '0.7rem', color: '#ffffff', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{row.personalBV.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span style={{ fontSize: '0.7rem', color: '#ffffff', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{row.teamBV.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span style={{ fontSize: '0.7rem', color: '#c9a84c', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{row.totalBV.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
                <div className="fx-monthly-grid__row--total" style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr', padding: '7px 16px', borderTop: '1px solid rgba(201,168,76,0.25)', background: 'rgba(255,255,255,0.035)' }}>
                  <span />
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fx-ink-subtle)', fontWeight: 600 }}>Total</span>
                  <span style={{ fontSize: '0.7rem', color: '#c9a84c', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{monthlyBreakdown.reduce((s, r) => s + r.personalBV, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  <span style={{ fontSize: '0.7rem', color: '#c9a84c', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{monthlyBreakdown.reduce((s, r) => s + r.teamBV, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  <span style={{ fontSize: '0.7rem', color: '#c9a84c', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, textAlign: 'right' }}>{monthlyBreakdown.reduce((s, r) => s + r.totalBV, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="fx-monthly-grid__mobile">
                {monthlyBreakdown.map((row, i) => (
                  <div key={`m-${row.month}`} className="fx-monthly-card">
                    <div className="fx-monthly-card__top">
                      <span className="fx-monthly-card__badge">#{row.month}</span>
                      <span className="fx-monthly-card__cycle">{row.start} → {row.end}</span>
                    </div>
                    <div className="fx-monthly-card__labels">
                      <span>PERSONAL BV</span>
                      <span>TEAM BV</span>
                      <span>TOTAL BV</span>
                    </div>
                    <div className="fx-monthly-card__values">
                      <span className="fx-monthly-card__value">{row.personalBV.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                      <span className="fx-monthly-card__value">{row.teamBV.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                      <span className="fx-monthly-card__value fx-monthly-card__value--gold">{row.totalBV.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ))}
                <div className="fx-monthly-card fx-monthly-card--total">
                  <div className="fx-monthly-card__top">
                    <span className="fx-monthly-card__cycle" style={{ fontWeight: 600, letterSpacing: '0.08em' }}>TOTAL</span>
                  </div>
                  <div className="fx-monthly-card__labels">
                    <span>PERSONAL BV</span>
                    <span>TEAM BV</span>
                    <span>TOTAL BV</span>
                  </div>
                  <div className="fx-monthly-card__values">
                    <span className="fx-monthly-card__value">{monthlyBreakdown.reduce((s, r) => s + r.personalBV, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span className="fx-monthly-card__value">{monthlyBreakdown.reduce((s, r) => s + r.teamBV, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span className="fx-monthly-card__value fx-monthly-card__value--gold">{monthlyBreakdown.reduce((s, r) => s + r.totalBV, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="fx-divider my-6" />

      <div className="fx-data-strip fx-data-strip--contract mb-6 fx-reveal fx-reveal--delay-2">
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label">Contract JSAV</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={contractJSAV} format={fmt} className="fx-data-strip__value fx-data-strip__value--soft" />}
        </div>
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label">Contract USDT</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={contractUSDT} format={fmt} className="fx-data-strip__value fx-data-strip__value--soft" />}
        </div>
        <div className="fx-data-strip__item">
          <div className="fx-data-strip__label">Contract USDC</div>
          {loading ? <div className="fx-skeleton h-8 w-24" /> : <CountUp value={contractUSDC} format={fmt} className="fx-data-strip__value fx-data-strip__value--soft" />}
        </div>
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
            <div className="text-xs" style={{ color: 'var(--fx-ink-subtle)' }}>All-Time Capital Allocation</div>
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