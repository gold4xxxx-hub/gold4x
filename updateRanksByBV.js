/**
 * Smart Rank Update by BV
 * 
 * Fetches users from API, checks their BV, and updates ranks
 * based on contract requirements.
 * 
 * Usage:
 * PRIVATE_KEY=0x... node updateRanksByBV.js [--auto]
 */

const ethers = require('ethers');
require('dotenv').config();

const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';
const API_URL = 'http://localhost:3000'; // Adjust if needed
const BATCH_SIZE = 10;
const GAS_LIMIT = 200000;

// Rank thresholds based on contract
const RANK_THRESHOLDS = {
  STAR_BV_REQUIRED: 10000,      // 10,000 BV minimum for Star
  GOLD_LEGS_REQUIRED: 4,         // 4 Star legs for Gold
  DIAMOND_LEGS_REQUIRED: 4,      // 4 Gold legs for Diamond
  MIN_DIRECTS: 4,                // 4 direct referrals minimum
};

const ABI = [
  'function dashboardMegaView(address userAddr) public view returns (tuple(bool registered, uint256 directCount, uint8 rank, uint256 roi, uint256 direct, uint256 level, uint256 rankIncome, uint256 claimable, uint256 withdrawn, uint256 totalInvested, uint256 totalEarned, uint256 totalCap, uint256 capPercent, uint8 capType, uint256 directsNeeded, uint256 personalBV, uint256 teamBV, uint256 totalBV, uint256 contractJSAV, uint256 contractUSDT, uint256 contractUSDC, uint256 reserved, uint256 available, uint256 legsWithBV, uint256 legsWithStar, uint256 legsWithGold))',
  'function updateRank(address userAddr) public',
];

/**
 * Fetch users from API
 */
async function fetchUsersFromAPI() {
  try {
    console.log('📡 Fetching users from API...');
    const response = await fetch(`${API_URL}/api/stats/users`);
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`✅ Fetched ${data.count} users\n`);
    return data.users || [];
  } catch (err) {
    console.error(`❌ Failed to fetch from API: ${err.message}`);
    console.log('   Make sure your backend is running on:', API_URL);
    return [];
  }
}

/**
 * Check rank qualification based on BV and structure
 */
function calculateQualifiedRank(dashboard, tokenDecimals = 18) {
  const onChainRank = Number(dashboard.rank);
  const directCount = Number(dashboard.directCount);
  const legsWithBV = Number(dashboard.legsWithBV);
  const legsWithStar = Number(dashboard.legsWithStar);
  const legsWithGold = Number(dashboard.legsWithGold);
  const totalBV = Number(ethers.formatUnits(dashboard.totalBV, tokenDecimals));
  const personalBV = Number(ethers.formatUnits(dashboard.personalBV, tokenDecimals));
  
  let qualifiedRank = onChainRank;
  
  // Must have minimum directs
  if (directCount < RANK_THRESHOLDS.MIN_DIRECTS) {
    return { qualifiedRank, qualified: false, reason: `Only ${directCount}/${RANK_THRESHOLDS.MIN_DIRECTS} directs` };
  }
  
  // Diamond: 4+ Gold legs
  if (legsWithGold >= RANK_THRESHOLDS.DIAMOND_LEGS_REQUIRED && onChainRank < 3) {
    return { qualifiedRank: 3, qualified: true, reason: `${legsWithGold} Gold legs (Diamond)` };
  }
  
  // Gold: 4+ Star legs
  if (legsWithStar >= RANK_THRESHOLDS.GOLD_LEGS_REQUIRED && onChainRank < 2) {
    return { qualifiedRank: 2, qualified: true, reason: `${legsWithStar} Star legs (Gold)` };
  }
  
  // Star: 4+ BV legs OR totalBV >= 10k OR personalBV >= 10k
  if (onChainRank < 1) {
    if (legsWithBV >= RANK_THRESHOLDS.MIN_DIRECTS) {
      return { qualifiedRank: 1, qualified: true, reason: `${legsWithBV} BV legs (Star)` };
    }
    if (totalBV >= RANK_THRESHOLDS.STAR_BV_REQUIRED) {
      return { qualifiedRank: 1, qualified: true, reason: `Total BV: ${totalBV.toFixed(0)}/${RANK_THRESHOLDS.STAR_BV_REQUIRED} (Star)` };
    }
    if (personalBV >= RANK_THRESHOLDS.STAR_BV_REQUIRED) {
      return { qualifiedRank: 1, qualified: true, reason: `Personal BV: ${personalBV.toFixed(0)}/${RANK_THRESHOLDS.STAR_BV_REQUIRED} (Star)` };
    }
  }
  
  return { qualifiedRank, qualified: false, reason: `Not enough BV or legs` };
}

/**
 * Analyze users and find rank update candidates
 */
async function analyzeUsersForRankUpdates(usersData) {
  console.log(`\n📊 Analyzing ${usersData.length} users by BV...\n`);
  
  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  
  const candidates = [];
  const stats = {
    total: usersData.length,
    notRegistered: 0,
    upToDate: 0,
    needsUpdate: 0,
  };
  
  const rankNames = ['Not Ranked', 'Star ⭐', 'Gold 🏆', 'Diamond 💎'];
  
  for (let i = 0; i < usersData.length; i++) {
    const userAddress = usersData[i];
    
    try {
      const dashboard = await contract.dashboardMegaView(userAddress);
      
      if (!dashboard.registered) {
        stats.notRegistered++;
        continue;
      }
      
      const { qualifiedRank, qualified, reason } = calculateQualifiedRank(dashboard);
      const currentRank = Number(dashboard.rank);
      
      if (qualified && qualifiedRank > currentRank) {
        candidates.push({
          address: userAddress,
          currentRank,
          qualifiedRank,
          currentRankLabel: rankNames[currentRank],
          qualifiedRankLabel: rankNames[qualifiedRank],
          reason,
          directCount: Number(dashboard.directCount),
          totalBV: Number(ethers.formatUnits(dashboard.totalBV, 18)),
        });
        
        console.log(
          `✅ ${userAddress}:`
        );
        console.log(
          `   ${rankNames[currentRank]} → ${rankNames[qualifiedRank]} | ${reason}`
        );
        
        stats.needsUpdate++;
      } else {
        stats.upToDate++;
      }
      
    } catch (err) {
      // User analysis failed - likely not registered or RPC issue
    }
    
    // Progress indicator
    if ((i + 1) % 50 === 0) {
      console.log(`   ... analyzed ${i + 1}/${usersData.length}`);
    }
  }
  
  return { candidates, stats };
}

/**
 * Execute rank updates
 */
async function updateRanks(candidates, signer) {
  console.log(`\n🚀 Updating ${candidates.length} user ranks...\n`);
  
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
  const results = {
    success: 0,
    failed: 0,
    failedUsers: [],
  };
  
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    console.log(`📦 Batch ${batchNum}: Updating ${batch.length} users...`);
    
    for (const candidate of batch) {
      try {
        console.log(
          `  ⏳ ${candidate.address.slice(0, 10)}... ` +
          `${candidate.currentRankLabel} → ${candidate.qualifiedRankLabel}`
        );
        
        const tx = await contract.updateRank(candidate.address, {
          gasLimit: GAS_LIMIT,
        });
        
        console.log(`     📝 TX: ${tx.hash.slice(0, 20)}...`);
        
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
          console.log(`     ✅ Confirmed`);
          results.success++;
        } else {
          console.log(`     ❌ Reverted`);
          results.failed++;
          results.failedUsers.push(candidate.address);
        }
      } catch (err) {
        console.log(`     ❌ ${err.message.slice(0, 50)}`);
        results.failed++;
        results.failedUsers.push(candidate.address);
      }
    }
    
    // Wait between batches
    if (i + BATCH_SIZE < candidates.length) {
      console.log(`   ⏸ Waiting before next batch...\n`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  return results;
}

/**
 * Main function
 */
async function main() {
  console.log('========================================');
  console.log('🤖 Smart Rank Update by BV');
  console.log('========================================');
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`API: ${API_URL}\n`);
  
  // Validate environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY not set');
    console.error('Usage: PRIVATE_KEY=0x... node updateRanksByBV.js [--auto]');
    process.exit(1);
  }
  
  try {
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const signer = new ethers.Wallet(privateKey, provider);
    
    console.log(`👤 Signer: ${signer.address}`);
    
    // Check balance
    const balance = await provider.getBalance(signer.address);
    const balanceBNB = ethers.formatEther(balance);
    console.log(`💰 Balance: ${balanceBNB} BNB`);
    
    if (balance === BigInt(0)) {
      console.error('❌ No BNB balance - cannot pay gas fees');
      process.exit(1);
    }
    
    // Fetch users from API
    const usersData = await fetchUsersFromAPI();
    if (usersData.length === 0) {
      console.error('❌ No users found');
      process.exit(1);
    }
    
    // Analyze users
    const { candidates, stats } = await analyzeUsersForRankUpdates(usersData);
    
    // Print analysis summary
    console.log(`\n📈 Analysis Summary`);
    console.log(`==================`);
    console.log(`Total users: ${stats.total}`);
    console.log(`Registered: ${stats.total - stats.notRegistered}`);
    console.log(`Up to date: ${stats.upToDate}`);
    console.log(`Need update: ${stats.needsUpdate}`);
    console.log(`Candidates: ${candidates.length}`);
    
    if (candidates.length === 0) {
      console.log('\n✅ All users have current ranks!');
      return;
    }
    
    // Confirm before updating
    console.log(`\n⚠️  Ready to update ${candidates.length} ranks`);
    console.log(`   Add --auto flag to proceed\n`);
    
    if (!process.argv.includes('--auto')) {
      console.log('Usage: PRIVATE_KEY=0x... node updateRanksByBV.js --auto');
      return;
    }
    
    // Execute updates
    const results = await updateRanks(candidates, signer);
    
    // Final summary
    console.log(`\n✅ Update Complete`);
    console.log(`==================`);
    console.log(`Success: ${results.success}`);
    console.log(`Failed: ${results.failed}`);
    
    if (results.failedUsers.length > 0 && results.failedUsers.length <= 5) {
      console.log(`\nFailed users:`);
      results.failedUsers.forEach(addr => console.log(`  - ${addr}`));
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
