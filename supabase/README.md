# P2P storage setup

This migration adds persistent trade messages and a private file bucket. Message text and file metadata are kept in Postgres; file bytes are stored in the private `p2p-private` bucket. Neither is written to the escrow contract.

## Apply the migration

Create a Supabase project, then run `migrations/20261006000000_p2p_storage.sql` in the Supabase SQL editor or apply it with the Supabase CLI.

Set these variables in the server environment (local `.env.local` and the hosting provider):

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Never use a `NEXT_PUBLIC_` prefix for the service-role key. The API routes use it server-side only and independently verify a wallet signature and the trade participants before reading or writing.

The browser signs per-request messages; no user signature or private key is stored. File reads use short-lived signed URLs. The old on-chain chat and public payment-proof CID remain unchanged during migration.