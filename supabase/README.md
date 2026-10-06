# P2P storage setup

This migration adds persistent trade messages and private trade file storage. Message text and file metadata are kept in Postgres; trade file bytes are stored in the private `p2p-private` bucket. Neither is written to the escrow contract.

## Scope

Supabase covers **P2P trade chat and trade attachments only**.

**KYC Aadhaar images are not stored here.** They are pinned to IPFS via Pinata, and only the CID reaches the contract. This is a deliberate product decision, so Aadhaar uploads need `PINATA_JWT` and nothing from Supabase.

## Apply the migration

Create a Supabase project, then run the SQL file in `migrations/` in the Supabase SQL editor or apply it with the Supabase CLI.

Set these variables in the server environment (local `.env.local` and the hosting provider):

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Never use a `NEXT_PUBLIC_` prefix for the service-role key. The API routes use it server-side only and independently verify a wallet signature and the trade participants before reading or writing.

The browser signs per-request messages; no user signature or private key is stored. Trade file reads use short-lived signed URLs restricted to trade parties. Legacy on-chain chat remains readable on BSC alongside the stored history.

## If you previously applied the Aadhaar migration

An earlier revision added a second migration, `20261006000001_kyc_private_documents.sql`, for private Aadhaar storage. That has been removed and Aadhaar uploads no longer use Supabase. If you already ran it, the `kyc_documents` table and the `kyc/` object prefix are now unused and can be dropped:

```sql
drop table if exists public.kyc_documents;
```

Deleting rows from the storage bucket is separate and optional; no code reads them any more.