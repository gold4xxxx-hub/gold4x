export const P2P_STORAGE_CHAIN_ID = 56;

export type P2PStorageAction =
  | 'chat.read'
  | 'chat.send'
  | 'file.list'
  | 'file.upload';

export type KycDocumentAction = 'kyc.upload' | 'kyc.read';

export function kycDocumentMessage(input: {
  wallet: string;
  action: KycDocumentAction;
  documentSide: 'front' | 'back';
  requestId: string;
  timestamp: number;
  payloadHash: string;
}): string {
  return [
    'Gold4X private KYC document authorization v1',
    `Chain ID: ${P2P_STORAGE_CHAIN_ID}`,
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Action: ${input.action}`,
    `Document side: ${input.documentSide}`,
    `Request ID: ${input.requestId.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Payload SHA256: ${input.payloadHash.toLowerCase()}`,
  ].join('\n');
}

export function p2pStorageMessage(input: {
  tradeId: number;
  wallet: string;
  action: P2PStorageAction;
  requestId: string;
  timestamp: number;
  payloadHash: string;
}): string {
  return [
    'Gold4X P2P storage authorization v1',
    `Chain ID: ${P2P_STORAGE_CHAIN_ID}`,
    `Trade ID: ${input.tradeId}`,
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Action: ${input.action}`,
    `Request ID: ${input.requestId.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Payload SHA256: ${input.payloadHash.toLowerCase()}`,
  ].join('\n');
}