import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Contract, JsonRpcProvider, isAddress, verifyMessage } from 'ethers';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// File upload setup
const upload = multer({ dest: path.join(__dirname, 'uploads/') });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// In-memory chat history (for demo only)
const chatHistory = {};

const escrow = new Contract(
  process.env.P2P_ESCROW_CONTRACT_ADDRESS || '0x8578Aaf3bA423e62A5e6ea04b69fe91B8545c2C0',
  [
    'function getTrade(uint256 tradeId) view returns (uint256 adId, uint8 pairType, bool isFiat, address seller, address buyer, address cryptoToken, uint256 cryptoAmount, uint256 quoteAmount, uint8 status)',
  ],
  new JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'),
);
const transferChallenges = new Map();
const transferAuthMessage = (tradeId, nonce) =>
  `Gold4x P2P file transfer\nTrade #${tradeId}\nNonce: ${nonce}`;

async function emitTransferPresence(tradeId, seller, buyer) {
  const room = `file-transfer:${tradeId}`;
  const members = await io.in(room).fetchSockets();
  const onlineWallets = new Set(
    members
      .map((member) =>
        typeof member.data.transferWallet === 'string'
          ? member.data.transferWallet.toLowerCase()
          : null,
      )
      .filter(Boolean),
  );
  io.to(room).emit('file-transfer:presence', {
    tradeId,
    onlineCount: onlineWallets.size,
    bothOnline: onlineWallets.has(seller.toLowerCase()) && onlineWallets.has(buyer.toLowerCase()),
    seller: { wallet: seller, online: onlineWallets.has(seller.toLowerCase()) },
    buyer: { wallet: buyer, online: onlineWallets.has(buyer.toLowerCase()) },
  });
}

io.on('connection', (socket) => {
  socket.on('disconnect', () => {
    transferChallenges.delete(socket.id);
    const tradeId = socket.data.transferTradeId;
    const seller = socket.data.transferSeller;
    const buyer = socket.data.transferBuyer;
    if (
      Number.isSafeInteger(tradeId) &&
      typeof seller === 'string' &&
      typeof buyer === 'string'
    ) {
      void emitTransferPresence(tradeId, seller, buyer).catch((error) => {
        console.error('P2P presence update failed on disconnect:', error);
      });
    }
  });

  socket.on('joinOrder', (orderId) => {
    socket.join(orderId);
    if (chatHistory[orderId]) {
      socket.emit('chatHistory', chatHistory[orderId]);
    }
  });

  socket.on('chatMessage', ({ orderId, sender, text }) => {
    const msg = { sender, text, time: new Date().toISOString() };
    if (!chatHistory[orderId]) chatHistory[orderId] = [];
    chatHistory[orderId].push(msg);
    io.to(orderId).emit('chatMessage', msg);
  });

  socket.on('file-transfer:challenge', async ({ tradeId } = {}, acknowledge = () => {}) => {
    if (!Number.isSafeInteger(tradeId) || tradeId < 1) {
      acknowledge({ ok: false, error: 'Invalid trade.' });
      return;
    }
    const nonce = randomBytes(32).toString('hex');
    transferChallenges.set(socket.id, { tradeId, nonce, createdAt: Date.now() });
    acknowledge({ ok: true, nonce });
  });

  socket.on(
    'file-transfer:authorize',
    async ({ tradeId, nonce, signature } = {}, acknowledge = () => {}) => {
      const challenge = transferChallenges.get(socket.id);
      transferChallenges.delete(socket.id);
      if (
        !challenge ||
        challenge.tradeId !== tradeId ||
        challenge.nonce !== nonce ||
        Date.now() - challenge.createdAt > 2 * 60 * 1000 ||
        typeof signature !== 'string'
      ) {
        acknowledge({ ok: false, error: 'Authorization expired. Reopen the trade and try again.' });
        return;
      }

      try {
        const wallet = verifyMessage(transferAuthMessage(tradeId, nonce), signature);
        if (!isAddress(wallet)) throw new Error('Invalid wallet signature.');
        const trade = await escrow.getTrade(tradeId);
        const isParticipant =
          wallet.toLowerCase() === String(trade.seller).toLowerCase() ||
          wallet.toLowerCase() === String(trade.buyer).toLowerCase();
        if (!isParticipant || ![1n, 2n].includes(trade.status)) {
          acknowledge({ ok: false, error: 'Only the buyer or seller in an active trade can join.' });
          return;
        }

        const room = `file-transfer:${tradeId}`;
        const members = await io.in(room).fetchSockets();
        if (members.some((member) => member.data.transferWallet?.toLowerCase() === wallet.toLowerCase())) {
          acknowledge({ ok: false, error: 'This wallet is already connected to the trade.' });
          return;
        }
        if (members.length >= 2) {
          acknowledge({ ok: false, error: 'Both trade participants are already connected.' });
          return;
        }

        socket.data.transferTradeId = tradeId;
        socket.data.transferWallet = wallet;
        socket.data.transferSeller = String(trade.seller);
        socket.data.transferBuyer = String(trade.buyer);
        await socket.join(room);
        acknowledge({ ok: true });
        socket.to(room).emit('file-transfer:peer-joined');
        await emitTransferPresence(tradeId, String(trade.seller), String(trade.buyer));
      } catch (error) {
        console.error('P2P file transfer authorization failed:', error);
        acknowledge({ ok: false, error: 'Could not verify the trade on BNB Smart Chain.' });
      }
    },
  );

  socket.on('file-transfer:signal', (payload = {}) => {
    const { tradeId, type, sdp, candidate } = payload;
    if (
      socket.data.transferTradeId !== tradeId ||
      !['offer', 'answer', 'candidate'].includes(type)
    ) return;

    if (type === 'candidate') {
      if (!candidate || typeof candidate.candidate !== 'string') return;
      socket.to(`file-transfer:${tradeId}`).emit('file-transfer:signal', {
        tradeId,
        type,
        candidate,
      });
      return;
    }
    if (!sdp || typeof sdp.sdp !== 'string' || sdp.sdp.length > 200_000) return;
    socket.to(`file-transfer:${tradeId}`).emit('file-transfer:signal', { tradeId, type, sdp });
  });
});

app.post('/upload/:orderId', upload.array('files'), (req, res) => {
  const files = req.files.map(f => ({
    filename: f.filename,
    originalname: f.originalname,
    url: `/uploads/${f.filename}`
  }));
  res.json({ files });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
