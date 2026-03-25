/**
 * Example: USDT Token Integration
 * 
 * This file shows how to integrate a real BSC token (USDT) into your app
 * Copy this pattern for any ERC20 token or custom contract
 */

import { BrowserProvider, Contract } from 'ethers';

// USDT Contract Address on BSC
export const USDT_ADDRESS = '0x55d398326f99059fF775485246999027BF4Ef3C';

// Standard ERC20 ABI (most tokens use this)
export const ERC20_ABI = [
  // Read-only functions (view)
  {
    name: 'name',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'symbol',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'decimals',
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'totalSupply',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  
  // State-modifying functions (write)
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

/**
 * Example React Component for USDT Interactions
 * 
 * Usage in your app:
 * <USDTBalance address="0x..." />
 * <USDTTransfer />
 */

export function getUSDTExample() {
  return `
import { ContractMethod } from '@/components/ContractMethod';
import { ERC20_ABI, USDT_ADDRESS } from '@/lib/examples/USDTExample';

export function USDTInteractions() {
  return (
    <div className="space-y-6">
      {/* Check USDT Balance */}
      <ContractMethod
        contractAddress={USDT_ADDRESS}
        contractABI={ERC20_ABI}
        methodName="balanceOf"
        isWriteMethod={false}
        parameters={[
          {
            name: 'account',
            type: 'address',
            placeholder: '0x1234567890123456789012345678901234567890'
          }
        ]}
      />

      {/* Transfer USDT to Another Address */}
      <ContractMethod
        contractAddress={USDT_ADDRESS}
        contractABI={ERC20_ABI}
        methodName="transfer"
        isWriteMethod={true}
        parameters={[
          {
            name: 'to',
            type: 'address',
            placeholder: '0xRecipientAddress'
          },
          {
            name: 'amount',
            type: 'uint256',
            placeholder: '1.0 USDT'
          }
        ]}
      />

      {/* Approve USDT for Spending */}
      <ContractMethod
        contractAddress={USDT_ADDRESS}
        contractABI={ERC20_ABI}
        methodName="approve"
        isWriteMethod={true}
        parameters={[
          {
            name: 'spender',
            type: 'address',
            placeholder: 'Contract to approve'
          },
          {
            name: 'amount',
            type: 'uint256',
            placeholder: 'Approval amount'
          }
        ]}
      />
    </div>
  );
}
  `;
}

/**
 * How to find a contract's ABI:
 * 1. Go to https://bscscan.com
 * 2. Search for the contract address
 * 3. Click "Contract" tab
 * 4. Scroll to "Contract ABI" section
 * 5. Click "Copy ABI button"
 * 
 * Then paste it into your web3Config.ts or a new file
 */

/**
 * Common BSC Contracts:
 * 
 * USDT:  0x55d398326f99059fF775485246999027BF4Ef3C
 * BUSD:  0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56
 * USDC:  0x8AC76a51cc950d9822D68b83FE1Ad97B32Cd580d
 * WBNB:  0xbb4CdB9CBd36B01bD1cbaAFc2341c55da1D64d5b
 * ETH:   0x2170Ed0880ac9A755fd29B2688956BD959f933F8
 * BTC:   0x7130d2A12B9BCbFdD356A0b522bD4Ef8602F4761
 */
