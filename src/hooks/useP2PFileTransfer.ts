'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Signer } from 'ethers';
import { io } from 'socket.io-client';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 16 * 1024;
const SIGNALING_URL = process.env.NEXT_PUBLIC_P2P_SIGNALING_URL;

type ReceivedFile = {
  name: string;
  url: string;
  size: number;
};

type PendingReceipt = {
  transferId: string;
  complete: () => void;
  fail: (error: Error) => void;
};

type SignalPayload = {
  tradeId: number;
  type: 'offer' | 'answer' | 'candidate';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type PresenceState = {
  tradeId: number;
  onlineCount: number;
  bothOnline: boolean;
  buyer: { wallet: string; online: boolean };
  seller: { wallet: string; online: boolean };
};

function authMessage(tradeId: number, nonce: string): string {
  return `Gold4x P2P file transfer\nTrade #${tradeId}\nNonce: ${nonce}`;
}

export function useP2PFileTransfer({
  tradeId,
  walletAddress,
  signer,
  enabled,
}: {
  tradeId: number | null;
  walletAddress: string | null;
  signer: Signer | null;
  enabled: boolean;
}) {
  const [status, setStatus] = useState('Waiting for an active trade.');
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [receiving, setReceiving] = useState(false);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null);
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const receivedUrlRef = useRef<string | null>(null);
  const pendingReceiptRef = useRef<PendingReceipt | null>(null);

  useEffect(() => {
    if (!tradeId || !enabled) {
      setConnected(false);
      setPresence(null);
      setStatus('File transfer is available during an active trade.');
      return;
    }
    if (!walletAddress || !signer) {
      setConnected(false);
      setPresence(null);
      setStatus('Connect your buyer or seller wallet to enable file transfer.');
      return;
    }
    if (!SIGNALING_URL) {
      setConnected(false);
      setPresence(null);
      setStatus('File transfer is not configured. Set NEXT_PUBLIC_P2P_SIGNALING_URL.');
      return;
    }

    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    let remoteDescriptionSet = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];
    let incoming:
      | { transferId: string; name: string; mime: string; size: number; received: number; chunks: Blob[] }
      | null = null;
    const socket = io(SIGNALING_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });

    const updateStatus = (value: string) => {
      if (!disposed) setStatus(value);
    };

    const attachChannel = (dataChannel: RTCDataChannel) => {
      channel = dataChannel;
      channelRef.current = dataChannel;
      dataChannel.binaryType = 'arraybuffer';
      dataChannel.bufferedAmountLowThreshold = 256 * 1024;
      dataChannel.onopen = () => {
        if (disposed) return;
        setConnected(true);
        setStatus('Counterparty connected. Files transfer directly between browsers.');
      };
      dataChannel.onclose = () => {
        if (disposed) return;
        pendingReceiptRef.current?.fail(new Error('Peer connection closed before delivery was confirmed.'));
        setConnected(false);
        setStatus('Peer connection closed.');
      };
      dataChannel.onerror = () => updateStatus('File transfer connection error.');
      dataChannel.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === 'string') {
          let message: {
            type?: string;
            transferId?: string;
            name?: string;
            mime?: string;
            size?: number;
          };
          try {
            message = JSON.parse(event.data) as typeof message;
          } catch {
            updateStatus('Received an invalid file transfer message.');
            return;
          }
          if (message.type === 'file-received' && typeof message.transferId === 'string') {
            const pending = pendingReceiptRef.current;
            if (pending?.transferId === message.transferId) pending.complete();
            return;
          }
          if (
            message.type === 'file-start' &&
            typeof message.transferId === 'string' &&
            message.name &&
            Number.isFinite(message.size)
          ) {
            if ((message.size ?? 0) > MAX_FILE_BYTES || (message.size ?? 0) < 0) {
              incoming = null;
              setReceiving(false);
              updateStatus('The incoming file is over the 10 MB limit.');
              return;
            }
            incoming = {
              transferId: message.transferId,
              name: message.name,
              mime: message.mime || 'application/octet-stream',
              size: message.size ?? 0,
              received: 0,
              chunks: [],
            };
            setReceiving(true);
            setReceiveProgress(0);
            updateStatus(`Receiving ${message.name}… 0%`);
            return;
          }
          if (
            message.type === 'file-end' &&
            incoming &&
            message.transferId === incoming.transferId
          ) {
            const file = incoming;
            incoming = null;
            setReceiving(false);
            if (file.received !== file.size) {
              updateStatus('File transfer was incomplete. Ask the counterparty to resend it.');
              return;
            }
            if (receivedUrlRef.current) URL.revokeObjectURL(receivedUrlRef.current);
            const url = URL.createObjectURL(
              new Blob(file.chunks, { type: file.mime }),
            );
            receivedUrlRef.current = url;
            setReceivedFile({ name: file.name, size: file.size, url });
            setReceiveProgress(100);
            channel?.send(JSON.stringify({
              type: 'file-received',
              transferId: file.transferId,
            }));
            setStatus(`${file.name} received. Download it before leaving this trade.`);
          }
          return;
        }

        if (!incoming) return;
        const chunk = new Blob([event.data]);
        incoming.chunks.push(chunk);
        incoming.received += chunk.size;
        const percent = incoming.size
          ? Math.min(100, Math.floor((incoming.received / incoming.size) * 100))
          : 100;
        setReceiveProgress(percent);
        updateStatus(`Receiving ${incoming.name}… ${percent}%`);
      };
    };

    const getPeer = () => {
      if (peer) return peer;
      peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerRef.current = peer;
      peer.onicecandidate = (event) => {
        if (!event.candidate || disposed) return;
        socket.emit('file-transfer:signal', {
          tradeId,
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        } satisfies SignalPayload);
      };
      peer.onconnectionstatechange = () => {
        if (disposed || !peer) return;
        if (peer.connectionState === 'failed') {
          setConnected(false);
          setStatus('Could not connect to the counterparty. Try again on a different network.');
        } else if (peer.connectionState === 'disconnected') {
          setConnected(false);
          setStatus('Peer connection interrupted.');
        }
      };
      peer.ondatachannel = (event) => attachChannel(event.channel);
      return peer;
    };

    const signIn = async () => {
      try {
        const challenge = await new Promise<{ ok: boolean; error?: string; nonce?: string }>(
          (resolve) => {
            socket.emit(
              'file-transfer:challenge',
              { tradeId },
              (result: { ok: boolean; error?: string; nonce?: string }) => resolve(result),
            );
          },
        );
        if (!challenge.ok || !challenge.nonce) {
          throw new Error(challenge.error || 'Could not verify trade participation.');
        }
        const signature = await signer.signMessage(authMessage(tradeId, challenge.nonce));
        const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          socket.emit(
            'file-transfer:authorize',
            { tradeId, nonce: challenge.nonce, signature },
            (response: { ok: boolean; error?: string }) => resolve(response),
          );
        });
        if (!result.ok) throw new Error(result.error || 'Wallet authorization failed.');
        if (!disposed) updateStatus('Waiting for the counterparty to join this trade.');
      } catch (error) {
        if (disposed) return;
        socket.disconnect();
        setStatus(error instanceof Error ? error.message : 'Wallet authorization failed.');
      }
    };

    socket.on('connect', () => {
      updateStatus('Authorizing this wallet for the trade…');
      void signIn();
    });
    socket.on('connect_error', () => {
      updateStatus('Could not connect to the file transfer service.');
    });
    socket.on('file-transfer:presence', (snapshot: PresenceState) => {
      if (snapshot.tradeId !== tradeId) return;
      setPresence(snapshot);
      if (snapshot.onlineCount === 1) {
        updateStatus('You are online. Waiting for the counterparty to come online.');
      } else if (snapshot.bothOnline && channelRef.current?.readyState !== 'open') {
        updateStatus('Both participants are online. Connecting securely…');
      }
    });
    socket.on('file-transfer:peer-joined', async () => {
      try {
        const connection = getPeer();
        if (!channel) {
          attachChannel(connection.createDataChannel('p2p-files'));
        }
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit('file-transfer:signal', {
          tradeId,
          type: 'offer',
          sdp: offer,
        } satisfies SignalPayload);
        updateStatus('Connecting securely to the counterparty…');
      } catch {
        updateStatus('Could not start the peer connection.');
      }
    });
    socket.on('file-transfer:signal', async (signal: SignalPayload) => {
      try {
        if (signal.tradeId !== tradeId) return;
        const connection = getPeer();
        if (signal.type === 'offer' && signal.sdp) {
          await connection.setRemoteDescription(signal.sdp);
          remoteDescriptionSet = true;
          for (const candidate of pendingCandidates.splice(0)) {
            await connection.addIceCandidate(candidate);
          }
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          socket.emit('file-transfer:signal', {
            tradeId,
            type: 'answer',
            sdp: answer,
          } satisfies SignalPayload);
        } else if (signal.type === 'answer' && signal.sdp) {
          await connection.setRemoteDescription(signal.sdp);
          remoteDescriptionSet = true;
          for (const candidate of pendingCandidates.splice(0)) {
            await connection.addIceCandidate(candidate);
          }
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (remoteDescriptionSet) await connection.addIceCandidate(signal.candidate);
          else pendingCandidates.push(signal.candidate);
        }
      } catch {
        updateStatus('Could not negotiate a peer connection. Refresh the trade and retry.');
      }
    });

    updateStatus('Connecting to the file transfer service…');
    socket.connect();

    return () => {
      disposed = true;
      socket.disconnect();
      pendingReceiptRef.current?.fail(new Error('Trade view closed before delivery was confirmed.'));
      channel?.close();
      peer?.close();
      peerRef.current = null;
      channelRef.current = null;
      if (receivedUrlRef.current) URL.revokeObjectURL(receivedUrlRef.current);
      receivedUrlRef.current = null;
      setReceivedFile(null);
      setConnected(false);
      setSending(false);
      setProgress(0);
      setReceiving(false);
      setReceiveProgress(0);
      setPresence(null);
    };
  }, [tradeId, walletAddress, signer, enabled]);

  const sendFile = useCallback(async (file: File) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== 'open') {
      setStatus('The counterparty is not connected yet.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus('Files must be 10 MB or smaller.');
      return;
    }
    if (sending) return;

    setSending(true);
    setProgress(0);
    setStatus(`Sending ${file.name}… 0%`);
    const transferId = crypto.randomUUID();
    try {
      channel.send(JSON.stringify({
        type: 'file-start',
        transferId,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      }));
      for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
        if (channel.readyState !== 'open') throw new Error('Peer connection closed.');
        while (channel.bufferedAmount > 512 * 1024) {
          await new Promise<void>((resolve, reject) => {
            const onLow = () => {
              channel.removeEventListener('close', onClose);
              resolve();
            };
            const onClose = () => {
              channel.removeEventListener('bufferedamountlow', onLow);
              reject(new Error('Peer connection closed.'));
            };
            channel.addEventListener('bufferedamountlow', onLow, { once: true });
            channel.addEventListener('close', onClose, { once: true });
            if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
              onLow();
            }
          });
        }
        const end = Math.min(offset + CHUNK_BYTES, file.size);
        channel.send(file.slice(offset, end));
        const percent = Math.floor((end / file.size) * 100);
        setProgress(percent);
        setStatus(`Sending ${file.name}… ${percent}%`);
      }
      const receipt = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          if (pendingReceiptRef.current?.transferId === transferId) {
            pendingReceiptRef.current = null;
          }
          reject(new Error('File was sent, but delivery could not be confirmed.'));
        }, 120_000);
        pendingReceiptRef.current = {
          transferId,
          complete: () => {
            window.clearTimeout(timeout);
            pendingReceiptRef.current = null;
            resolve();
          },
          fail: (error) => {
            window.clearTimeout(timeout);
            pendingReceiptRef.current = null;
            reject(error);
          },
        };
      });
      void receipt.catch(() => undefined);
      channel.send(JSON.stringify({ type: 'file-end', transferId }));
      await receipt;
      setStatus(`${file.name} delivered directly to the counterparty.`);
    } catch (error) {
      if (pendingReceiptRef.current?.transferId === transferId) {
        pendingReceiptRef.current.fail(
          error instanceof Error ? error : new Error('File transfer failed.'),
        );
      }
      setStatus(error instanceof Error ? error.message : 'File transfer failed.');
    } finally {
      setSending(false);
    }
  }, [sending]);

  return {
    status,
    connected,
    sending,
    progress,
    receiving,
    receiveProgress,
    presence,
    receivedFile,
    sendFile,
  };
}
