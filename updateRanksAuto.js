/**
 * Auto-Update Ranks Script (with Auto-Fetch)
 * 
 * This version automatically fetches users from your indexed data
 * and updates their ranks.
 * 
 * Usage:
 * PRIVATE_KEY=0x... node updateRanksAuto.js [--auto]
 */

const ethers = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';
const BATCH_SIZE = 10;
const GAS_LIMIT = 200000;

const ABI = [
  'function dashboardMegaView(address userAddr) public view returns (tuple(bool registered, uint256 directCount, uint8 rank, uint256 roi, uint256 direct, uint256 level, uint256 rankIncome, uint256 claimable, uint256 withdrawn, uint256 totalInvested, uint256 totalEarned, uint256 totalCap, uint256 capPercent, uint8 capType, uint256 directsNeeded, uint256 personalBV, uint256 teamBV, uint256 totalBV, uint256 contractJSAV, uint256 contractUSDT, uint256 contractUSDC, uint256 reserved, uint256 available, uint256 legsWithBV, uint256 legsWithStar, uint256 legsWithGold))',
  'function updateRank(address userAddr) public',
];

/**
 * Fetch users from indexed data file
 */
function getIndexedUsers() {
  try {
    const indexPath = path.join(__dirname, 'src/data/indexedUsers.json');
    if (fs.existsSync(indexPath)) {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      return data.users || [];
    }
  } catch (err) {
    console.warn('Failed to read indexed users:', err.message);
  }
  return [];
}

/**
 * Fetch users from API endpoint
 */
async function fetchUsersFromApi() {
  try {
    console.log('📡 Fetching users from API...');
    const response = await fetch('http://localhost:3000/api/stats/users');
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = await response.json();
    console.log(`✅ Fetched ${data.count} users from API`);
    return data.users || [];
  } catch (err) {
    console.warn('Failed to fetch from API:', err.message);
    return [];
  }
}

/**
 * Get users from best available source
 */
async function getUsers() {
  console.log('🔍 Looking for users...\n');
  
  // Try API first (live data)
  let users = await fetchUsersFromApi();
  if (users.length > 0) return users;
  
  // Fallback to indexed data
  console.log('📂 Falling back to indexed data...');
  users = getIndexedUsers();
  if (users.length > 0) {
    console.log(`✅ Loaded ${users.length} users from indexedUsers.json\n`);
    return users;
  }
  
  console.error('❌ No users found. Please ensure:');
  console.error('   1. API is running on http://localhost:3000');
  console.error('   2. OR indexedUsers.json exists in src/data/');
  return [];
}

async function getRankUpdatableCandidates(usersData) {
  console.log(`\n📋 Analyzing ${usersData.length} users for rank updates...`);
  
  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  
  const candidates = [];
  let processed = 0;
  
  for (const userAddress of usersData) {
    try {
      const dashboard = await contract.dashboardMegaView(userAddress);
      const onChainRank = Number(dashboard.rank);
      const directCount = Number(dashboard.directCount);
      const legsWithBV = Number(dashboard.legsWithBV);
      const legsWithStar = Number(dashboard.legsWithStar);
      const legsWithGold = Number(dashboard.legsWithGold);
      const totalBV = Number(ethers.formatUnits(dashboard.totalBV, 18));
      
      // Calculate inferred rank
      let inferredRank = onChainRank;
      
      if (onChainRank === 0 && directCount >= 4) {
        if (legsWithGold >= 4) {
          inferredRank = 3; // Diamond
        } else if (legsWithStar >= 4) {
          inferredRank = 2; // Gold
        } else if (legsWithBV >= 4 || totalBV >= 10000) {
          inferredRank = 1; // Star
        }
      }
      
      // If inferred rank > on-chain rank, user needs update
      if (inferredRank > onChainRank) {
        const rankNames = ['Not Ranked', 'Star', 'Gold', 'Diamond'];
        candidates.push({
          address: userAddress,
          onChainRank,
          inferredRank,
          onChainRankLabel: rankNames[onChainRank],
          inferredRankLabel: rankNames[inferredRank],
          directCount,
          legsWithBV,
          legsWithStar,
          legsWithGold,
          totalBV,
        });
        
        console.log(
          `  ✓ ${userAddress}: ${rankNames[onChainRank]} → ${rankNames[inferredRank]} ` +
          `(directs: ${directCount}, BV: ${totalBV.toFixed(0)})`
        );
      }
    } catch (err) {
      // Silent continue - user may not be registered
    }
    
    processed++;
    if (processed % 50 === 0) {
      console.log(`  ... processed ${processed}/${usersData.length}`);
    }
  }
  
  return candidates;
}

async function updateRanksForCandidates(candidates, signer) {
  console.log(`\n🚀 Updating ranks for ${candidates.length} users...\n`);
  
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
  const updates = {
    success: 0,
    failed: 0,
    failedUsers: [],
  };
  
  // Process in batches
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    
    console.log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: Processing ${batch.length} users...`);
    
    for (const candidate of batch) {
      try {
        console.log(`  ⏳ ${candidate.address} (${candidate.inferredRankLabel})...`);
        
        const tx = await contract.updateRank(candidate.address, {
          gasLimit: GAS_LIMIT,
        });
        
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
          console.log(`    ✅ Block ${receipt.blockNumber}`);
          updates.success++;
        } else {
          console.log(`    ❌ Reverted`);
          updates.failed++;
          updates.failedUsers.push(candidate.address);
        }
      } catch (err) {
        console.log(`    ❌ ${err.message}`);
        updates.failed++;
        updates.failedUsers.push(candidate.address);
      }
    }
    
    if (i + BATCH_SIZE < candidates.length) {
      console.log('  ⏸ Waiting...\n');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  return updates;
}

async function main() {
  console.log('🤖 JSAVIOR Auto-Rank-Update (Auto-Fetch)');
  console.log('=========================================\n');
  
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY not set');
    console.error('Usage: PRIVATE_KEY=0x... node updateRanksAuto.js [--auto]');
    process.exit(1);
  }
  
  try {
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const signer = new ethers.Wallet(privateKey, provider);
    
    console.log(`👤 Signer: ${signer.address}`);
    
    const balance = await provider.getBalance(signer.address);
    const balanceEth = ethers.formatEther(balance);
    console.log(`💰 Balance: ${balanceEth} BNB`);
    
    if (balance === BigInt(0)) {
      console.error('❌ No BNB for gas');
      process.exit(1);
    }
    
    // Fetch users
    let usersData = await getUsers();
    
    if (usersData.length === 0) {
      console.error('\n❌ No users found');
      process.exit(1);
    }
    
    // Find candidates
    const candidates = await getRankUpdatableCandidates(usersData);
    
    if (candidates.length === 0) {
      console.log('\n✅ All users have current ranks!');
      return;
    }
    
    // Confirm
    console.log(`\n⚠️  Ready to update ${candidates.length} users`);
    console.log(`   Add --auto flag to proceed\n`);
    
    if (!process.argv.includes('--auto')) {
      console.log('Usage: PRIVATE_KEY=0x... node updateRanksAuto.js --auto');
      return;
    }
    
    // Execute
    const results = await updateRanksForCandidates(candidates, signer);
    
    // Summary
    console.log('\n📊 Summary');
    console.log('==========');
    console.log(`✅ Success: ${results.success}`);
    console.log(`❌ Failed: ${results.failed}`);
    
    if (results.failedUsers.length > 0) {
      console.log('\nFailed:');
      results.failedUsers.slice(0, 5).forEach(a => console.log(`  - ${a}`));
      if (results.failedUsers.length > 5) {
        console.log(`  ... and ${results.failedUsers.length - 5} more`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
