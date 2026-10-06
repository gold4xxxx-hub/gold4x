'use client';

import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { p2pStorageMessage, type P2PStorageAction } from '@/lib/p2pStorageProtocol';

export type P2PStoredMessage = {
  id: string;
  sender_wallet: string;
  content: string;
  chain_block: number;
  created_at: string;
};

export type P2PStoredFile = {
  id: string;
  uploadedBy: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url?: string;
};

type SignedFields = {
  tradeId: number;
  wallet: string;
  action: P2PStorageAction;
  requestId: string;
  timestamp: number;
  payloadHash: string;
  signature: string;
};

async function signedFields(
  signer: Signer,
  tradeId: number,
  action: P2PStorageAction,
  payloadHash: string,
): Promise<SignedFields> {
  const wallet = await signer.getAddress();
  const fields = {
    tradeId,
    wallet: ethers.getAddress(wallet),
    action,
    requestId: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
    payloadHash,
  };
  const signature = await signer.signMessage(p2pStorageMessage(fields));
  return { ...fields, signature };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'P2P storage request failed.');
  return payload;
}

const emptyHash = () => ethers.sha256(new Uint8Array());

export async function loadP2PStoredMessages(
  signer: Signer,
  tradeId: number,
): Promise<P2PStoredMessage[]> {
  const auth = await signedFields(signer, tradeId, 'chat.read', emptyHash());
  const response = await fetch(`/api/p2p/storage/chat/${tradeId}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
    cache: 'no-store',
  });
  const result = await readJson<{ messages: P2PStoredMessage[] }>(response);
  return result.messages;
}

export async function sendP2PStoredMessage(
  signer: Signer,
  tradeId: number,
  content: string,
): Promise<P2PStoredMessage> {
  const text = content.trim();
  const payloadHash = ethers.sha256(ethers.toUtf8Bytes(text));
  const auth = await signedFields(signer, tradeId, 'chat.send', payloadHash);
  const response = await fetch(`/api/p2p/storage/chat/${tradeId}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, content: text }),
    cache: 'no-store',
  });
  const result = await readJson<{ message: P2PStoredMessage }>(response);
  return result.message;
}

export async function loadP2PStoredFiles(
  signer: Signer,
  tradeId: number,
): Promise<P2PStoredFile[]> {
  const auth = await signedFields(signer, tradeId, 'file.list', emptyHash());
  const response = await fetch(`/api/p2p/storage/files/${tradeId}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
    cache: 'no-store',
  });
  const result = await readJson<{ files: P2PStoredFile[] }>(response);
  return result.files;
}

export async function uploadP2PStoredFile(
  signer: Signer,
  tradeId: number,
  file: File,
): Promise<P2PStoredFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const payloadHash = ethers.sha256(bytes);
  const auth = await signedFields(signer, tradeId, 'file.upload', payloadHash);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: file.type }), 'trade-attachment');
  form.append('wallet', auth.wallet);
  form.append('requestId', auth.requestId);
  form.append('timestamp', String(auth.timestamp));
  form.append('payloadHash', payloadHash);
  form.append('signature', auth.signature);

  const response = await fetch(`/api/p2p/storage/files/${tradeId}/`, {
    method: 'PUT',
    body: form,
    cache: 'no-store',
  });
  const result = await readJson<{ file: P2PStoredFile }>(response);
  return result.file;
}