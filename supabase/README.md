# P2P storage setup

These migrations add persistent trade messages and private file storage. Message text and file metadata are kept in Postgres; file bytes are stored in the private `p2p-private` bucket. Neither is written to the escrow contract.

## Apply the migration

Create a Supabase project, then run both SQL files in `migrations/` in the Supabase SQL editor or apply them with the Supabase CLI, in timestamp order.

Set these variables in the server environment (local `.env.local` and the hosting provider):

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Never use a `NEXT_PUBLIC_` prefix for the service-role key. The API routes use it server-side only and independently verify a wallet signature and the trade participants before reading or writing.

The browser signs per-request messages; no user signature or private key is stored. Trade file reads use short-lived signed URLs restricted to trade parties. New KYC document bytes are private and can only be opened through an owner-signed, short-lived review link. Legacy on-chain chat, IPFS screenshots, and any Aadhaar images already pinned to IPFS remain public during migration.