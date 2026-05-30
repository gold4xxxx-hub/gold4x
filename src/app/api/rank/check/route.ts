import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

// Minimal ABI for dashboardMegaView and currentRank
const ABI = [
  'function dashboardMegaView(address userAddr) public view returns (tuple(bool registered, uint256 directCount, uint8 rank, uint256 roi, uint256 direct, uint256 level, uint256 rankIncome, uint256 claimable, uint256 withdrawn, uint256 totalInvested, uint256 totalEarned, uint256 totalCap, uint256 capPercent, uint8 capType, uint256 directsNeeded, uint256 personalBV, uint256 teamBV, uint256 totalBV, uint256 contractJSAV, uint256 contractUSDT, uint256 contractUSDC, uint256 reserved, uint256 available, uint256 legsWithBV, uint256 legsWithStar, uint256 legsWithGold))',
  'function currentRank(address user) public view returns (uint8)',
  'function decimals() public view returns (uint8)',
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get('address');

    if (!userAddress || !ethers.isAddress(userAddress)) {
      return NextResponse.json(
        { error: 'Invalid user address' },
        { status: 400 }
      );
    }

    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

    const [dashboard, currentRankOnChain, decimals] = await Promise.all([
      contract.dashboardMegaView(userAddress),
      contract.currentRank(userAddress),
      contract.decimals(),
    ]);

    const tokenDecimals = Number(decimals);

    // Calculate inferred rank based on achievements
    const directCount = Number(dashboard.directCount);
    const legsWithBV = Number(dashboard.legsWithBV);
    const legsWithStar = Number(dashboard.legsWithStar);
    const legsWithGold = Number(dashboard.legsWithGold);
    const totalBV = Number(ethers.formatUnits(dashboard.totalBV, tokenDecimals));
    const teamBV = Number(ethers.formatUnits(dashboard.teamBV, tokenDecimals));

    let inferredRank = Number(currentRankOnChain);

    if (inferredRank === 0 && directCount >= 4) {
      if (legsWithGold >= 4) {
        inferredRank = 3;
      } else if (legsWithStar >= 4) {
        inferredRank = 2;
      } else if (legsWithBV >= 4 || totalBV >= 10000) {
        inferredRank = 1;
      }
    }

    const rankMap: Record<number, string> = {
      0: 'Not Ranked',
      1: 'Star',
      2: 'Gold',
      3: 'Diamond',
    };

    return NextResponse.json({
      address: userAddress,
      registered: dashboard.registered,
      onChainRank: Number(currentRankOnChain),
      onChainRankLabel: rankMap[Number(currentRankOnChain)] || 'Unknown',
      inferredRank,
      inferredRankLabel: rankMap[inferredRank] || 'Unknown',
      needsUpdate: inferredRank > Number(currentRankOnChain),
      metrics: {
        directCount,
        legsWithBV,
        legsWithStar,
        legsWithGold,
        totalBV,
        teamBV,
      },
      message:
        inferredRank > Number(currentRankOnChain)
          ? `User qualifies for ${rankMap[inferredRank]} rank. Call updateRank() to persist on-chain.`
          : 'User rank is up to date.',
    });
  } catch (error: any) {
    console.error('Rank check error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to check rank' },
      { status: 500 }
    );
  }
}
