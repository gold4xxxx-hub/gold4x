# Gold4x P2P Backend Server

This Node.js + Socket.IO service supports trade signaling for WebRTC file
transfers, plus the demo chat and upload endpoints.

## Setup

```powershell
cd server
npm install
npm start
```

The server listens on port 4000 by default. Configure `P2P_ESCROW_CONTRACT_ADDRESS`
for a different escrow deployment and `BSC_RPC_URL` if the default BNB Smart Chain
RPC is unsuitable.

Set `NEXT_PUBLIC_P2P_SIGNALING_URL` in the frontend build environment to the
public origin of this service (for example `https://p2p-signal.example.com`).
Production deployments must serve it over HTTPS/WSS.

## WebRTC file transfer

Socket.IO is used only for WebRTC signaling. The service issues a one-time
challenge, verifies the wallet signature, and checks on-chain that the wallet
belongs to the buyer or seller of an OPEN or PAID trade before admitting it to
the trade's signaling room. The file data travels directly between browsers and
is not stored by this service. Wallet verification is a free signature request;
it does not submit a blockchain transaction.

After a participant joins or leaves, the service emits a presence snapshot for
that trade so both sides can see whether buyer/seller are currently active.

Transfers are limited to 10 MB and both participants must be online. A received
file is temporary in the page and should be downloaded before closing the trade.
WebRTC data channels are encrypted in transit, but this does not make the files
trusted; participants should only open files they expect. The client currently
uses a public STUN server; users behind restrictive NATs or firewalls may need a
TURN relay, which must be configured as part of the deployment for reliable
connectivity.

## Existing demo endpoints

- `POST /upload/:orderId` — Upload files for an order (form field: `files[]`)
- `GET /uploads/<filename>` — Download an uploaded file
- `joinOrder`, `chatMessage`, and `chatHistory` — Demo Socket.IO chat events

Chat history remains in-memory for demo purposes. Configure origin restrictions,
rate limiting, and persistent storage before exposing chat or uploads publicly.
