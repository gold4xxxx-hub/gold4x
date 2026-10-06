import { ethers } from 'ethers';
import { P2P_STORAGE_CHAIN_ID, p2pStorageMessage, type P2PStorageAction } from '@/lib/p2pStorageProtocol';

const ESCROW_ADDRESS = '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0';
const BSC_RPC = 'https://bsc-rpc.publicnode.com';
const PRIVATE_BUCKET = 'p2p-private';
const MAX_SIGNATURE_AGE_SECONDS = 300;
const provider = new ethers.JsonRpcProvider(BSC_RPC, P2P_STORAGE_CHAIN_ID, { staticNetwork: true });
const escrow = new ethers.Contract(
  ESCROW_ADDRESS,
  ['function getTrade(uint256) view returns (uint256,uint8,bool,address,address,address,uint256,uint256,uint8)'],
  provider,
);
export class P2PStorageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'P2PStorageError';
  }
}

export type P2PAuthFields = {
  tradeId: number;
  wallet: string;
  action: P2PStorageAction;
  requestId: string;
  timestamp: number;
  payloadHash: string;
  signature: string;
};

type StorageConfig = { url: string; key: string };

export type StoredMessage = {
  id: string;
  sender_wallet: string;
  content: string;
  chain_block: number;
  created_at: string;
};

export type StoredFile = {
  id: string;
  uploaded_by: string;
  object_path: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

function config(): StorageConfig {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const missing = [
      !url && 'SUPABASE_URL',
      !key && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean).join(' and ');
    throw new P2PStorageError(
      `P2P storage needs ${missing}. Apply the Supabase migration, add these server environment variables, then restart or redeploy. Keep the service-role key server-only.`,
      503,
    );
  }
  return { url, key };
}

async function requestStorage<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new P2PStorageError('Could not reach the P2P storage service.', 502);
  }
  if (!response.ok) {
    throw new P2PStorageError('The P2P storage service rejected the request.', 502);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function authorizeP2PStorageRequest(fields: P2PAuthFields, write: boolean) {
  if (!Number.isSafeInteger(fields.tradeId) || fields.tradeId < 1 ||
      !Number.isSafeInteger(fields.timestamp) || !uuid(fields.requestId) ||
      !/^0x[a-fA-F0-9]{40}$/.test(fields.wallet) ||
      !/^0x[a-fA-F0-9]{64}$/.test(fields.payloadHash)) {
    throw new P2PStorageError('Invalid storage authorization request.', 400);
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - fields.timestamp) > MAX_SIGNATURE_AGE_SECONDS) {
    throw new P2PStorageError('Storage authorization expired. Please retry.', 401);
  }

  let wallet: string;
  try {
    wallet = ethers.getAddress(fields.wallet);
    const recovered = ethers.verifyMessage(p2pStorageMessage({ ...fields, wallet }), fields.signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) throw new Error('Signer mismatch');
  } catch {
    throw new P2PStorageError('Wallet signature is invalid. Please retry.', 401);
  }

  let trade;
  try {
    trade = await escrow.getTrade(fields.tradeId);
  } catch {
    throw new P2PStorageError('Could not verify this trade on BSC.', 502);
  }
  const seller = String(trade.seller ?? trade[3]).toLowerCase();
  const buyer = String(trade.buyer ?? trade[4]).toLowerCase();
  const status = Number(trade.status ?? trade[8]);
  if (status === 0) throw new P2PStorageError('Trade not found.', 404);
  if (wallet.toLowerCase() !== seller && wallet.toLowerCase() !== buyer) {
    throw new P2PStorageError('Only a buyer or seller in this trade can access its storage.', 403);
  }
  if (write && status !== 1 && status !== 2) {
    throw new P2PStorageError('Files and messages cannot be added after a trade closes.', 409);
  }
  return wallet.toLowerCase();
}

export function hashBytes(bytes: Uint8Array): string {
  return ethers.sha256(bytes);
}

export async function readTradeMessages(tradeId: number): Promise<StoredMessage[]> {
  const rows = await requestStorage<StoredMessage[]>(
    `/rest/v1/p2p_messages?select=id,sender_wallet,content,chain_block,created_at&trade_id=eq.${tradeId}&order=created_at.desc&limit=200`,
  );
  return rows.reverse();
}

export async function insertTradeMessage(input: {
  tradeId: number;
  wallet: string;
  requestId: string;
  content: string;
}): Promise<StoredMessage> {
  let chainBlock: number;
  try {
    chainBlock = await provider.getBlockNumber();
  } catch {
    throw new P2PStorageError('Could not read the BSC block for this message.', 502);
  }
  try {
    const rows = await requestStorage<StoredMessage[]>('/rest/v1/p2p_messages', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        trade_id: input.tradeId,
        sender_wallet: input.wallet,
        request_id: input.requestId,
        content: input.content,
        chain_block: chainBlock,
      }]),
    });
    if (!rows[0]) throw new P2PStorageError('Message was not saved.', 502);
    return rows[0];
  } catch (error) {
    if (error instanceof P2PStorageError && error.status === 502) {
      const existing = await requestStorage<StoredMessage[]>(
        `/rest/v1/p2p_messages?select=id,sender_wallet,content,chain_block,created_at&trade_id=eq.${input.tradeId}&sender_wallet=eq.${input.wallet}&request_id=eq.${input.requestId}&limit=1`,
      ).catch(() => []);
      if (existing[0]) return existing[0];
    }
    throw error;
  }
}

export async function listTradeFiles(tradeId: number): Promise<StoredFile[]> {
  return await requestStorage<StoredFile[]>(
    `/rest/v1/p2p_files?select=id,uploaded_by,object_path,content_type,size_bytes,created_at&trade_id=eq.${tradeId}&order=created_at.desc&limit=50`,
  );
}

function objectPathForUrl(objectPath: string): string {
  return objectPath.split('/').map(encodeURIComponent).join('/');
}

async function uploadPrivateObject(objectPath: string, contentType: string, bytes: Uint8Array) {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(
      `${url}/storage/v1/object/${PRIVATE_BUCKET}/${objectPathForUrl(objectPath)}`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': contentType,
          'x-upsert': 'false',
        },
        body: Buffer.from(bytes),
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new P2PStorageError('Could not reach private file storage.', 502);
  }
  if (!response.ok) throw new P2PStorageError('Private file upload failed.', 502);
}

async function deletePrivateObject(objectPath: string) {
  const { url, key } = config();
  await fetch(`${url}/storage/v1/object/${PRIVATE_BUCKET}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [objectPath] }),
  }).catch(() => undefined);
}

export async function uploadPrivateTradeFile(input: {
  tradeId: number;
  wallet: string;
  requestId: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
}): Promise<StoredFile> {
  const extension: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };
  const ext = extension[input.contentType];
  if (!ext || input.bytes.byteLength === 0 || input.bytes.byteLength > 10 * 1024 * 1024) {
    throw new P2PStorageError('Choose a JPG, PNG, WEBP or PDF file up to 10 MB.', 400);
  }
  const objectPath = `${input.tradeId}/${input.requestId}.${ext}`;
  try {
    await uploadPrivateObject(objectPath, input.contentType, input.bytes);
  } catch (error) {
    if (error instanceof P2PStorageError) throw error;
    throw new P2PStorageError('Could not reach private file storage.', 502);
  }

  try {
    const rows = await requestStorage<StoredFile[]>('/rest/v1/p2p_files', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        trade_id: input.tradeId,
        uploaded_by: input.wallet,
        request_id: input.requestId,
        object_path: objectPath,
        content_type: input.contentType,
        size_bytes: input.bytes.byteLength,
        sha256: input.sha256.replace(/^0x/, '').toLowerCase(),
      }]),
    });
    if (!rows[0]) throw new Error('Missing stored file row');
    return rows[0];
  } catch {
    await deletePrivateObject(objectPath);
    throw new P2PStorageError('File uploaded but its metadata could not be saved.', 502);
  }
}

export async function createPrivateFileUrl(objectPath: string): Promise<string> {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(
      `${url}/storage/v1/object/sign/${PRIVATE_BUCKET}/${objectPathForUrl(objectPath)}`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 300 }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new P2PStorageError('Could not create a private file link.', 502);
  }
  if (!response.ok) throw new P2PStorageError('Could not create a private file link.', 502);
  const result = await response.json() as { signedURL?: string };
  if (!result.signedURL) throw new P2PStorageError('Private file link was not returned.', 502);
  if (/^https?:\/\//i.test(result.signedURL)) return result.signedURL;
  if (result.signedURL.startsWith('/storage/v1/')) return `${url}${result.signedURL}`;
  return `${url}/storage/v1${result.signedURL.startsWith('/') ? '' : '/'}${result.signedURL}`;
}