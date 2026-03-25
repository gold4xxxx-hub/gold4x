'use client';

import { useState } from 'react';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { formatContractResponse, etherToWei } from '@/lib/contractInteraction';
import { BrowserProvider, Contract } from 'ethers';

interface ContractMethodProps {
  contractAddress: string;
  contractABI: any[];
  methodName: string;
  isWriteMethod: boolean;
  parameters: Array<{
    name: string;
    type: string;
    placeholder?: string;
  }>;
  onSuccess?: (result: any) => void;
}

export function ContractMethod({
  contractAddress,
  contractABI,
  methodName,
  isWriteMethod,
  parameters,
  onSuccess,
}: ContractMethodProps) {
  const { isConnected } = useWalletConnection();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (paramName: string, value: string) => {
    setInputs((prev) => ({
      ...prev,
      [paramName]: value,
    }));
  };

  const handleExecute = async () => {
    if (!isConnected) {
      setError('Wallet not connected');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (!window.ethereum) {
        throw new Error('MetaMask not found');
      }

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractAddress, contractABI, signer);

      const args = parameters.map((param) => {
        const value = inputs[param.name];
        if (param.type === 'uint256' || param.type.startsWith('uint')) {
          return etherToWei(value);
        }
        return value;
      });

      let txResult;
      if (isWriteMethod) {
        const tx = await contract[methodName](...args);
        const receipt = await tx.wait();
        txResult = {
          success: true,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
        };
      } else {
        const data = await contract[methodName](...args);
        txResult = {
          success: true,
          data: formatContractResponse(data),
        };
      }

      setResult(txResult.data || { transactionHash: txResult.transactionHash });
      onSuccess?.(txResult);
    } catch (err: any) {
      const errorMessage = err?.message || err?.reason || 'Unknown error occurred';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fx-card p-4">
      <h4 className="font-semibold mb-4 flex items-center gap-3">
        <span className="text-base">{methodName}</span>
        <span className={`fx-chip ${isWriteMethod ? 'fx-chip--write' : 'fx-chip--read'}`}>
          {isWriteMethod ? 'Write' : 'Read'}
        </span>
      </h4>

      <div className="space-y-3 mb-4">
        {parameters.map((param) => (
          <div key={param.name}>
            <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">
              {param.name} ({param.type})
            </label>
            <input
              type="text"
              value={inputs[param.name] || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              placeholder={param.placeholder || `Enter ${param.name}`}
              className="fx-input"
              disabled={loading}
            />
          </div>
        ))}
      </div>

      <button
        onClick={handleExecute}
        disabled={!isConnected || loading}
        className="w-full fx-button disabled:cursor-not-allowed font-medium"
      >
        {loading ? 'Executing...' : 'Execute'}
      </button>

      {error && (
        <div className="mt-3 fx-alert fx-alert--error text-sm">
          Error: {error}
        </div>
      )}

      {result && (
        <div className="mt-3 fx-alert fx-alert--success text-sm">
          <p className="font-medium mb-2">Result:</p>
          <pre className="bg-[rgba(15,20,34,0.85)] border border-[rgba(255,255,255,0.08)] p-2 rounded text-xs overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
