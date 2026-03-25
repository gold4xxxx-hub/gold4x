import React, { useEffect, useState } from 'react';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import ProgressBar from './ProgressBar';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
import { ethers } from 'ethers';

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

  useEffect(() => {
    const fetchData = async () => {
      if (!isConnected || !address || !(window as any).ethereum) return;
      setLoading(true);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI, provider);

        const [dashboard, tokenDecimalsRaw] = await Promise.all([
          contract.dashboardMegaView(address),
          contract.decimals(),
        ]);

        const tokenDecimals = Number(tokenDecimalsRaw);
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
        setRank(Number(dashboard.rank));
        setCapType(Number(dashboard.capType));
        setRegistered(Boolean(dashboard.registered));
        setCapPercent(Number(dashboard.capPercent) / 100);
        setPersonalBV(fromUnits(dashboard.personalBV, tokenDecimals));
        setTeamBV(fromUnits(dashboard.teamBV, tokenDecimals));
        setTotalBV(fromUnits(dashboard.totalBV, tokenDecimals));
        setLegsWithBV(Number(dashboard.legsWithBV));
        setLegsWithStar(Number(dashboard.legsWithStar));
        setLegsWithGold(Number(dashboard.legsWithGold));
        setContractJSAV(fromUnits(dashboard.contractJSAV, tokenDecimals));
        setContractUSDT(fromUnits(dashboard.contractUSDT, 18));
        setContractUSDC(fromUnits(dashboard.contractUSDC, 18));
      } catch {
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
      setLoading(false);
    };

    fetchData();
  }, [isConnected, address]);

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