\# Gold4x P2P Backend Server



This is a simple Node.js + Socket.io backend for real-time chat and file uploads for the Gold4x P2P trading app.



\## Features

\- Real-time chat per order (Socket.io)

\- File upload and sharing per order (Express + Multer)

\- In-memory chat history (for demo)



\## Setup



1\. Install dependencies:



```bash

cd server

npm install

```



2\. Start the server:



```bash

npm start

```



\- The server will run on port 4000 by default.

\- File uploads are stored in `server/uploads/` and served at `/uploads/<filename>`.



\## Endpoints



\- `POST /upload/:orderId` — Upload files for a specific order (form field: `files\[]`)

\- `GET /uploads/<filename>` — Download uploaded files



\## Socket.io Events

\- `joinOrder` (orderId) — Join a chat room for an order

\- `chatMessage` ({ orderId, sender, text }) — Send a message

\- `chatHistory` (\[messages]) — Receive chat history on join



---



For production, use a persistent database and secure file storage.



