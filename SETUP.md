\#!/bin/bash



\# BSC Web3 Setup Guide

\# This file documents common setup steps and configurations



\## Environment Setup



\# 1. Install Node.js 18+ from https://nodejs.org/



\# 2. Create .env.local file

cat > .env.local << 'EOF'

\# WalletConnect Project ID

NEXT\_PUBLIC\_WALLETCONNECT\_PROJECT\_ID=your\_project\_id\_here

EOF



\## Common Smart Contract ABIs



\# ERC20 Token ABI

export ERC20\_ABI='\[

&nbsp; {

&nbsp;   "constant": true,

&nbsp;   "inputs": \[{"name": "\_owner", "type": "address"}],

&nbsp;   "name": "balanceOf",

&nbsp;   "outputs": \[{"name": "balance", "type": "uint256"}],

&nbsp;   "type": "function"

&nbsp; },

&nbsp; {

&nbsp;   "constant": false,

&nbsp;   "inputs": \[{"name": "\_to", "type": "address"}, {"name": "\_value", "type": "uint256"}],

&nbsp;   "name": "transfer",

&nbsp;   "outputs": \[{"name": "", "type": "bool"}],

&nbsp;   "type": "function"

&nbsp; }

]'



\# Common BSC Contract Addresses

export USDT\_BSC="0x55d398326f99059fF775485246999027BF4Ef3C"

export BUSD\_BSC="0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"

export USDC\_BSC="0x8AC76a51cc950d9822D68b83FE1Ad97B32Cd580d"

export BNB\_BSC="0xbb4CdB9CBd36B01bD1cbaAFc2341c55da1D64d5b"



\## Development Commands



\# Install dependencies with legacy peer deps support

npm install --legacy-peer-deps



\# Start development server

npm run dev



\# Build for production

npm run build

npm start



\# Type checking

npx tsc --noEmit



\# Linting

npm run lint



echo "Setup complete! Configure your .env.local file and start developing."



