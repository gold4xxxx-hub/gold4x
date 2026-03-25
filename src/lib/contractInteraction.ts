import { ethers } from 'ethers';
import { BrowserProvider } from 'ethers';

/**
 * Contract interaction utilities for BSC smart contracts
 */

export interface ContractConfig {
  address: string;
  abi: any[];
}

export class ContractInteraction {
  private provider: BrowserProvider;
  private signer: any;

  constructor(provider: any) {
    this.provider = new BrowserProvider(provider);
  }

  /**
   * Initialize signer from provider
   */
  async initializeSigner() {
    this.signer = await this.provider.getSigner();
    return this.signer;
  }

  /**
   * Read-only contract call (view/pure functions)
   */
  async readContract(config: ContractConfig, methodName: string, args: any[] = []) {
    try {
      const contract = new ethers.Contract(config.address, config.abi, this.provider);
      const result = await contract[methodName](...args);
      return { success: true, data: result };
    } catch (error) {
      console.error(`Error reading contract method ${methodName}:`, error);
      return { success: false, error };
    }
  }

  /**
   * Write contract call (state-modifying functions)
   */
  async writeContract(
    config: ContractConfig,
    methodName: string,
    args: any[] = [],
    options: any = {}
  ) {
    try {
      if (!this.signer) {
        await this.initializeSigner();
      }

      const contract = new ethers.Contract(config.address, config.abi, this.signer);
      const tx = await contract[methodName](...args, options);
      const receipt = await tx.wait();

      return { success: true, transactionHash: receipt.transactionHash, receipt };
    } catch (error) {
      console.error(`Error writing to contract method ${methodName}:`, error);
      return { success: false, error };
    }
  }

  /**
   * Get transaction details
   */
  async getTransactionDetails(txHash: string) {
    try {
      const tx = await this.provider.getTransaction(txHash);
      const receipt = await this.provider.getTransactionReceipt(txHash);
      return { success: true, transaction: tx, receipt };
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      return { success: false, error };
    }
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(config: ContractConfig, methodName: string, args: any[] = []) {
    try {
      const contract = new ethers.Contract(config.address, config.abi, this.provider);
      const gasEstimate = await contract[methodName].estimateGas(...args);
      return { success: true, gasEstimate };
    } catch (error) {
      console.error('Error estimating gas:', error);
      return { success: false, error };
    }
  }

  /**
   * Get current gas prices
   */
  async getGasPrices() {
    try {
      const feeData = await this.provider.getFeeData();
      return {
        success: true,
        gasPrice: feeData.gasPrice,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      };
    } catch (error) {
      console.error('Error fetching gas prices:', error);
      return { success: false, error };
    }
  }
}

/**
 * Helper to format contract response
 */
export const formatContractResponse = (data: any): any => {
  if (typeof data === 'bigint') {
    return data.toString();
  }
  if (Array.isArray(data)) {
    return data.map(formatContractResponse);
  }
  if (typeof data === 'object' && data !== null) {
    const formatted: any = {};
    for (const key in data) {
      formatted[key] = formatContractResponse(data[key]);
    }
    return formatted;
  }
  return data;
};

/**
 * Convert Wei to Ether
 */
export const weiToEther = (wei: bigint | string, decimals: number = 18): string => {
  return ethers.formatUnits(wei, decimals);
};

/**
 * Convert Ether to Wei
 */
export const etherToWei = (ether: string, decimals: number = 18): bigint => {
  return ethers.parseUnits(ether, decimals);
};
