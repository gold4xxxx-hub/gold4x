'use client';

import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { kycDocumentMessage } from '@/lib/p2pStorageProtocol';

export type KycDocumentSide = 'front' | 'back';

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Private Aadhaar storage request failed.');
  return body;
}

export async function uploadPrivateKycDocument(
  signer: Signer,
  side: KycDocumentSide,
  file: File,
): Promise<string> {
  const wallet = ethers.getAddress(await signer.getAddress());
  const requestId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadHash = ethers.sha256(new Uint8Array(await file.arrayBuffer()));
  const signature = await signer.signMessage(kycDocumentMessage({
    wallet,
    action: 'kyc.upload',
    documentSide: side,
    requestId,
    timestamp,
    payloadHash,
  }));

  const form = new FormData();
  form.append('file', file, 'aadhaar-document');
  form.append('wallet', wallet);
  form.append('side', side);
  form.append('requestId', requestId);
  form.append('timestamp', String(timestamp));
  form.append('payloadHash', payloadHash);
  form.append('signature', signature);

  const result = await responseJson<{ reference: string }>(
    await fetch('/api/kyc/document/', { method: 'POST', body: form, cache: 'no-store' }),
  );
  return result.reference;
}

export async function getPrivateKycDocumentUrl(signer: Signer, reference: string): Promise<string> {
  const match = reference.match(/^private-kyc:\/\/(0x[a-f0-9]{40})\/(front|back)\/([0-9a-f-]{36})$/i);
  if (!match) throw new Error('This is a legacy public document reference.');
  const [, , side, requestId] = match;
  const wallet = ethers.getAddress(await signer.getAddress());
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadHash = ethers.sha256(ethers.toUtf8Bytes(reference));
  const signature = await signer.signMessage(kycDocumentMessage({
    wallet,
    action: 'kyc.read',
    documentSide: side as KycDocumentSide,
    requestId,
    timestamp,
    payloadHash,
  }));

  const result = await responseJson<{ url: string }>(
    await fetch('/api/kyc/document/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, reference, requestId, timestamp, payloadHash, signature }),
      cache: 'no-store',
    }),
  );
  return result.url;
}