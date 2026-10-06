import { NextResponse } from 'next/server';
import {
  authorizeP2PStorageRequest,
  hashBytes,
  insertTradeMessage,
  P2PStorageError,
  readTradeMessages,
  type P2PAuthFields,
} from '@/lib/p2pStorageServer';
import type { P2PStorageAction } from '@/lib/p2pStorageProtocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatRequest = P2PAuthFields & {
  action: P2PStorageAction;
  content?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId: rawTradeId } = await context.params;
    const tradeId = Number(rawTradeId);
    const body = await request.json() as ChatRequest;
    if (body.action !== 'chat.read' && body.action !== 'chat.send') {
      throw new P2PStorageError('Unknown chat action.', 400);
    }
    const content = body.action === 'chat.send' ? body.content?.trim() ?? '' : '';
    if (body.action === 'chat.send' && (content.length < 1 || content.length > 2000)) {
      throw new P2PStorageError('Message must be between 1 and 2,000 characters.', 400);
    }
    const contentHash = hashBytes(new TextEncoder().encode(content));
    if (contentHash.toLowerCase() !== body.payloadHash.toLowerCase()) {
      throw new P2PStorageError('Message changed after wallet signature. Please retry.', 400);
    }
    const wallet = await authorizeP2PStorageRequest({
      ...body,
      tradeId,
      payloadHash: body.payloadHash,
    }, body.action === 'chat.send');

    if (body.action === 'chat.read') {
      return NextResponse.json({ messages: await readTradeMessages(tradeId) });
    }

    const message = await insertTradeMessage({
      tradeId,
      wallet,
      requestId: body.requestId,
      content,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof P2PStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not process stored chat.' }, { status: 500 });
  }
}