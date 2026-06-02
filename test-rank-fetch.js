// Test script to diagnose rank fetching issue
const { ethers } = require('ethers');
const jsaviorAbi = require('./src/config/jsaviorAbi.json');

const CONTRACT_ADDRESS = '0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

// Test address - replace with actual user address
const TEST_ADDRESS = '0xf9D3a64e5C40129e5E2cC0C6693D574961B7b0fd';

async function testRankFetch() {
  try {
    console.log('🔍 Testing JSAVIOR Contract Rank Fetch...');
    console.log(`Contract: ${CONTRACT_ADDRESS}`);
    console.log(`Test Address: ${TEST_ADDRESS}`);
    console.log('');

    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, jsaviorAbi, provider);

    // Test 1: Get current rank
    console.log('📋 Test 1: Fetching currentRank...');
    try {
      const rank = await contract.currentRank(TEST_ADDRESS);
      console.log(`✅ currentRank: ${rank}`);
    } catch (err) {
      console.log(`❌ currentRank failed: ${err.message}`);
    }

    // Test 2: Get dashboard mega view
    console.log('\n📋 Test 2: Fetching dashboardMegaView...');
    try {
      const dashboard = await contract.dashboardMegaView(TEST_ADDRESS);
      console.log(`✅ dashboardMegaView returned`);
      console.log(`  - registered: ${dashboard.registered}`);
      console.log(`  - rank: ${dashboard.rank}`);
      console.log(`  - directCount: ${dashboard.directCount}`);
      console.log(`  - legsWithBV: ${dashboard.legsWithBV}`);
      console.log(`  - legsWithStar: ${dashboard.legsWithStar}`);
      console.log(`  - legsWithGold: ${dashboard.legsWithGold}`);
      console.log(`  - totalBV: ${dashboard.totalBV}`);
    } catch (err) {
      console.log(`❌ dashboardMegaView failed: ${err.message}`);
    }

    // Test 3: Check RPC connectivity
    console.log('\n📋 Test 3: Testing RPC connectivity...');
    try {
      const blockNumber = await provider.getBlockNumber();
      console.log(`✅ RPC Working - Current block: ${blockNumber}`);
    } catch (err) {
      console.log(`❌ RPC failed: ${err.message}`);
    }

    // Test 4: Check contract code exists
    console.log('\n📋 Test 4: Checking contract code...');
    try {
      const code = await provider.getCode(CONTRACT_ADDRESS);
      if (code === '0x') {
        console.log(`❌ No contract code at address (contract not deployed)`);
      } else {
        console.log(`✅ Contract code found (${code.length} bytes)`);
      }
    } catch (err) {
      console.log(`❌ Code check failed: ${err.message}`);
    }

  } catch (error) {
    console.error('Fatal error:', error);
  }
}

testRankFetch();
