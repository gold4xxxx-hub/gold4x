# Auto-Update Ranks Script

This script automatically calls `updateRank()` for JSAVIOR users who have met rank requirements but haven't had their rank stored on-chain.

## Setup

### 1. Install Dependencies
```bash
npm install ethers dotenv
```

### 2. Create `.env` file
```
PRIVATE_KEY=0x... (your funded wallet private key)
```

⚠️ **Security**: Never commit `.env` file to git. The wallet should have BNB for gas fees.

### 3. Get User Addresses

The script needs a list of user addresses. Get them from:

**Option A: From indexed data**
```bash
# Fetch from your API
curl https://gold4x.in/api/stats/users | jq -r '.users[]'
```

**Option B: From your database**
Query users table and export addresses

**Option C: Scan contract events**
Use BSCScan API to get all users who registered

### 4. Update usersData in Script

Edit `updateRanks.js` line ~120:
```javascript
const usersData = [
  '0x1234567890123456789012345678901234567890',
  '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  // ... more addresses
];
```

## Usage

### Dry Run (Analyze only)
```bash
node updateRanks.js
```
Shows which users qualify for rank updates without making transactions.

### Execute Updates
```bash
node updateRanks.js auto
```
Automatically calls `updateRank()` for all qualifying users.

## How It Works

1. **Fetches user data** using `dashboardMegaView()` for each address
2. **Calculates inferred rank** based on:
   - 4+ directs with qualifying BV/Star/Gold legs
   - OR totalBV >= 10,000
3. **Identifies candidates** where inferred rank > on-chain rank
4. **Calls updateRank()** for each candidate
5. **Reports results** (success/failed count)

## Example Output

```
🤖 JSAVIOR Auto-Rank-Update Bot
=================================

👤 Signer Address: 0x...
💰 Balance: 5.234 BNB

📋 Analyzing 1542 users for rank updates...
  ✓ 0x123...: Not Ranked → Star (directs: 5, BV: 15000)
  ✓ 0x456...: Star → Gold (directs: 6, BV: 45000)
  ... processed 50/1542
  ... processed 100/1542

🚀 Updating ranks for 287 users...

📦 Batch 1: Processing 10 users...
  ⏳ Updating 0x123... (Star)...
    ✅ TX: 0xabc...
    ✓ Confirmed in block 101290000

📊 Update Summary
=================
✅ Successful: 287
❌ Failed: 0
```

## Advanced: Auto-Fetching Users

To automatically fetch users from your API, replace the usersData section:

```javascript
async function getUsers() {
  try {
    const response = await fetch('https://gold4x.in/api/stats/users');
    const data = await response.json();
    return data.users; // Assuming API returns { users: ['0x...', ...] }
  } catch (err) {
    console.error('Failed to fetch users:', err);
    return [];
  }
}

// In main():
const usersData = await getUsers();
```

## Gas Costs

- **Per user update**: ~200,000 gas (~0.0001-0.0002 BNB at 5 gwei)
- **100 users**: ~0.01-0.02 BNB
- **1000 users**: ~0.1-0.2 BNB

Total cost depends on current gas prices and batch size.

## Troubleshooting

**"PRIVATE_KEY environment variable not set"**
```bash
export PRIVATE_KEY="0x..."
node updateRanks.js
```

**"Wallet has 0 BNB"**
Send BNB to your wallet address for gas fees.

**"TX failed (reverted)"**
Check if user is registered and meets rank requirements. Contract may revert if conditions aren't met.

**"Failed to analyze user"**
User may not be registered or there's an RPC issue. Script continues with next user.

## Manual Single User Update

To update a single user:
```bash
node -e "
const ethers = require('ethers');
const pk = process.env.PRIVATE_KEY;
const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/'));
const contract = new ethers.Contract('0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD', ['function updateRank(address) public'], wallet);
contract.updateRank('0x...').then(tx => console.log(tx.hash));
"
```

## Support

For issues or questions, check:
- BSCScan: https://bscscan.com/address/0x418B7e6BBc48Ca93126c22A1e83b6420A4E0C6fD
- ethers.js docs: https://docs.ethers.org/v6/
