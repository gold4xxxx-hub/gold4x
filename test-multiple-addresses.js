// Test script to check multiple addresses for rank inference
const { ethers } = require('ethers');
const jsaviorAbi = require('./src/config/jsaviorAbi.json');

const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

// Test addresses - add more as needed
const TEST_ADDRESSES = [
  '0xf9D3a64e5C40129e5E2cC0C6693D574961B7b0fd',
  // Add more addresses here to test
];

async function testMultipleAddresses() {
  try {
    console.log('🔍 Testing Multiple Addresses for Rank Inference...');
    console.log(`Contract: ${CONTRACT_ADDRESS}`);
    console.log('');

    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, jsaviorAbi, provider);

    for (const address of TEST_ADDRESSES) {
      console.log(`\n📋 Address: ${address}`);
      
      try {
        const dashboard = await contract.dashboardMegaView(address);
        const currentRank = await contract.currentRank(address);
        
        const directCount = Number(dashboard.directCount);
        const legsWithBV = Number(dashboard.legsWithBV);
        const legsWithStar = Number(dashboard.legsWithStar);
        const legsWithGold = Number(dashboard.legsWithGold);
        const totalBV = Number(ethers.formatUnits(dashboard.totalBV, 18));
        
        console.log(`  On-chain rank: ${currentRank}`);
        console.log(`  Direct count: ${directCount}`);
        console.log(`  Legs with BV: ${legsWithBV}`);
        console.log(`  Legs with Star: ${legsWithStar}`);
        console.log(`  Legs with Gold: ${legsWithGold}`);
        console.log(`  Total BV: ${totalBV}`);
        
        // Calculate inferred rank
        let inferredRank = Number(currentRank);
        if (inferredRank === 0 && directCount >= 4) {
          if (legsWithGold >= 4) {
            inferredRank = 3;
          } else if (legsWithStar >= 4) {
            inferredRank = 2;
          } else if (legsWithBV >= 4 || totalBV >= 10000) {
            inferredRank = 1;
          }
        }
        
        const rankNames = ['Not Ranked', 'Star', 'Gold', 'Diamond'];
        console.log(`  Inferred rank: ${rankNames[inferredRank]} (${inferredRank})`);
        console.log(`  Should show Star: ${inferredRank === 1 ? 'YES' : 'NO'}`);
        
      } catch (err) {
        console.log(`  ❌ Error: ${err.message}`);
      }
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

testMultipleAddresses();
