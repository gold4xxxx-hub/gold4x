/**
 * Auto-Update Ranks Script
 * 
 * This script scans JSAVIOR users and automatically calls updateRank()
 * for users who have met rank requirements but haven't had their rank
 * stored on-chain yet.
 * 
 * Usage:
 * node updateRanks.js
 * 
 * Requires:
 * - PRIVATE_KEY env variable (wallet with BNB to pay gas)
 * - Users data from /api/stats/users or indexed data
 */

const ethers = require('ethers');
require('dotenv').config();

const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';
const BATCH_SIZE = 10; // Process users in batches to manage gas
const GAS_LIMIT = 200000; // Estimated gas for updateRank()

const ABI = [
  'function dashboardMegaView(address userAddr) public view returns (tuple(bool registered, uint256 directCount, uint8 rank, uint256 roi, uint256 direct, uint256 level, uint256 rankIncome, uint256 claimable, uint256 withdrawn, uint256 totalInvested, uint256 totalEarned, uint256 totalCap, uint256 capPercent, uint8 capType, uint256 directsNeeded, uint256 personalBV, uint256 teamBV, uint256 totalBV, uint256 contractJSAV, uint256 contractUSDT, uint256 contractUSDC, uint256 reserved, uint256 available, uint256 legsWithBV, uint256 legsWithStar, uint256 legsWithGold))',
  'function updateRank(address userAddr) public',
  'function currentRank(address user) public view returns (uint8)',
];

async function getRankUpdatableCandidates(usersData) {
  console.log(`\n📋 Analyzing ${usersData.length} users for rank updates...`);
  
  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  
  const candidates = [];
  
  for (let i = 0; i < usersData.length; i++) {
    const userAddress = usersData[i];
    
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
      console.warn(`  ⚠ Failed to analyze ${userAddress}: ${err.message}`);
    }
    
    // Show progress every 50 users
    if ((i + 1) % 50 === 0) {
      console.log(`  ... processed ${i + 1}/${usersData.length}`);
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
        console.log(`  ⏳ Updating ${candidate.address} (${candidate.inferredRankLabel})...`);
        
        const tx = await contract.updateRank(candidate.address, {
          gasLimit: GAS_LIMIT,
        });
        
        console.log(`    ✅ TX: ${tx.hash}`);
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
          console.log(`    ✓ Confirmed in block ${receipt.blockNumber}`);
          updates.success++;
        } else {
          console.log(`    ❌ TX failed (reverted)`);
          updates.failed++;
          updates.failedUsers.push(candidate.address);
        }
      } catch (err) {
        console.log(`    ❌ Error: ${err.message}`);
        updates.failed++;
        updates.failedUsers.push(candidate.address);
      }
    }
    
    // Wait 2 seconds between batches to avoid RPC rate limiting
    if (i + BATCH_SIZE < candidates.length) {
      console.log('  ⏸ Waiting before next batch...\n');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  return updates;
}

async function main() {
  console.log('🤖 JSAVIOR Auto-Rank-Update Bot');
  console.log('=================================\n');
  
  // Check for private key
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable not set');
    console.error('   Export PRIVATE_KEY="0x..." before running this script');
    process.exit(1);
  }
  
  try {
    // Initialize signer
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const signer = new ethers.Wallet(privateKey, provider);
    
    console.log(`👤 Signer Address: ${signer.address}`);
    
    // Check balance
    const balance = await provider.getBalance(signer.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} BNB`);
    
    if (balance === BigInt(0)) {
      console.error('❌ Wallet has 0 BNB - cannot pay gas fees');
      process.exit(1);
    }
    
    // TODO: Get users list from indexed data or API
    // This is a placeholder - in production, fetch from:
    // 1. /api/stats/users endpoint
    // 2. Indexed users data
    // 3. Or scan contract events
    
    const usersData = [
      // Replace with actual user addresses
      // '0x1234567890123456789012345678901234567890',
      // '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ];
    
    if (usersData.length === 0) {
      console.log('⚠️  No users to process. Update usersData array with addresses.');
      console.log('\n📝 To fetch users automatically, integrate with:');
      console.log('   - GET /api/stats/users (for indexed users)');
      console.log('   - BSCScan API (to scan contract events)');
      console.log('   - Your database');
      return;
    }
    
    // Find candidates
    const candidates = await getRankUpdatableCandidates(usersData);
    
    if (candidates.length === 0) {
      console.log('\n✅ All users have current ranks!');
      return;
    }
    
    // Confirm before updating
    console.log(`\n⚠️  About to update ${candidates.length} users`);
    console.log(`   Estimated gas cost: ~${candidates.length * GAS_LIMIT} gas`);
    console.log(`   (Run with: node updateRanks.js auto)\n`);
    
    if (process.argv[2] !== 'auto') {
      console.log('Add "auto" argument to proceed: node updateRanks.js auto');
      return;
    }
    
    // Execute updates
    const results = await updateRanksForCandidates(candidates, signer);
    
    // Summary
    console.log('\n\n📊 Update Summary');
    console.log('=================');
    console.log(`✅ Successful: ${results.success}`);
    console.log(`❌ Failed: ${results.failed}`);
    
    if (results.failedUsers.length > 0) {
      console.log('\nFailed users:');
      results.failedUsers.forEach(addr => console.log(`  - ${addr}`));
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
