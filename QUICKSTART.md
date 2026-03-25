\# Quick Start Guide - BSC Web3



\## 🚀 Getting Started in 5 Minutes



\### Step 1: Verify Installation

```bash

npm install

```



\### Step 2: Start Development Server

```bash

npm run dev

```



Your app will be available at `http://localhost:3000`



\### Step 3: Connect Your Wallet

1\. Click "Connect Wallet" button

2\. Select MetaMask or your preferred Web3 wallet

3\. Authorize the connection

4\. Switch to Binance Smart Chain network (if not automatically)



\### Step 4: Test Contract Interaction



The home page includes example components for:

\- \*\*Reading contract data\*\* (balance queries - no gas)

\- \*\*Writing to contracts\*\* (transfers - requires gas)



\#### Replace with Your Contract:

1\. Open `src/config/web3Config.ts`

2\. Add your contract's ABI

3\. Update contract address in `src/app/page.tsx`



```typescript

<ContractMethod

&nbsp; contractAddress="0xYOUR\_CONTRACT\_ADDRESS"

&nbsp; contractABI={YOUR\_CONTRACT\_ABI}

&nbsp; methodName="yourMethodName"

&nbsp; isWriteMethod={false}  // true for state-modifying functions

&nbsp; parameters={\[...]}

/>

```



\## 📁 File Structure



```

src/

├── app/page.tsx              ← Main UI starts here

├── config/web3Config.ts      ← Network \& contract settings

├── components/               ← Reusable UI components

│   ├── WalletConnect.tsx     ← Wallet button

│   └── ContractMethod.tsx    ← Generic contract executor

├── hooks/                    ← React hooks for Web3

└── providers/                ← Web3 provider setup

```



\## 🔑 Key Features



✅ Wallet connection with RainbowKit

✅ Contract read/write capabilities

✅ TypeScript support

✅ Tailwind CSS UI

✅ Gas estimation

✅ Error handling



\## 📝 Common Tasks



\### Add a New Contract Method



```typescript

<ContractMethod

&nbsp; contractAddress="0x..."

&nbsp; contractABI={ABI}

&nbsp; methodName="myFunction"

&nbsp; isWriteMethod={false}

&nbsp; parameters={\[

&nbsp;   { name: 'param1', type: 'address', placeholder: '0x...' },

&nbsp;   { name: 'param2', type: 'uint256', placeholder: '100' }

&nbsp; ]}

&nbsp; onSuccess={(result) => console.log(result)}

/>

```



\### Handle Wallet Connection



```typescript

import { useWalletConnection } from '@/hooks/useWalletConnection';



export function MyComponent() {

&nbsp; const { address, isConnected, balance } = useWalletConnection();

&nbsp; 

&nbsp; return isConnected ? (

&nbsp;   <p>Connected to {address}</p>

&nbsp; ) : (

&nbsp;   <p>Please connect wallet</p>

&nbsp; );

}

```



\## 🔗 Useful Links



\- \*\*Next.js\*\*: https://nextjs.org/docs

\- \*\*ethers.js\*\*: https://docs.ethers.org

\- \*\*wagmi Hooks\*\*: https://wagmi.sh

\- \*\*RainbowKit\*\*: https://www.rainbowkit.com

\- \*\*Solidity ABI\*\*: https://docs.ethers.org/v6/api/abi/



\## 🐛 Troubleshooting



\*\*Wallet won't connect?\*\*

\- Refresh browser

\- Check MetaMask is enabled

\- Ensure you're on a supported network



\*\*Transaction fails?\*\*

\- Verify contract address is correct

\- Check you have enough gas (BNB)

\- Ensure contract function parameters are correct

\- Check contract ABI matches actual contract



\*\*Port 3000 already in use?\*\*

```bash

npm run dev -- -p 3001

```



\## ✅ Next Steps



1\. ✅ Add your smart contract ABI

2\. ✅ Update contract addresses

3\. ✅ Customize UI components

4\. ✅ Test on BSC testnet first

5\. ✅ Deploy to production



---



Happy coding! 🚀



