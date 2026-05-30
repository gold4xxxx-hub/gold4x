import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

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

io.on('connection', (socket) => {
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
