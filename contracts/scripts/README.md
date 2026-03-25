\# JMFEscrow Contract Deployment



\## Prerequisites

\- Node.js \& npm

\- Hardhat (`npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers`)



\## Setup

1\. Install dependencies:



```bash

cd contracts

npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers

```



2\. Set environment variables:

\- `DEPLOYER\_PRIVATE\_KEY` (your wallet private key)

\- `JMF\_TOKEN\_ADDRESS` (deployed JMF token address)



\## Deploy Locally

```bash

npx hardhat run scripts/deploy.js --network hardhat

```



\## Deploy to BSC Testnet

```bash

npx hardhat run scripts/deploy.js --network bscTestnet

```



\## Output

\- Contract address will be printed after deployment.



---



For production, use BSC mainnet and secure your keys.



