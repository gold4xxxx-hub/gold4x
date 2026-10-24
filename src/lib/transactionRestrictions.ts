const RESTRICTED_TRANSACTION_WALLETS = new Set([
  '0x5dc142befb8cd74ec2810fcf2b1650faf7878140',
  '0xc6f70b2a08ce597cb7a1374121affb251e19d2bc',
]);

export const RESTRICTED_WALLET_MESSAGE =
  'This wallet is restricted from accessing the application or performing transactions.';

export function isRestrictedWallet(address?: string): boolean {
  return address !== undefined && RESTRICTED_TRANSACTION_WALLETS.has(address.toLowerCase());
}
