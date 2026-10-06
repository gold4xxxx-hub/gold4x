create table if not exists public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  wallet text not null check (wallet ~ '^0x[a-f0-9]{40}$'),
  document_side text not null check (document_side in ('front', 'back')),
  request_id uuid not null,
  object_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (wallet, document_side, request_id)
);

create index if not exists kyc_documents_wallet_side_created_idx
  on public.kyc_documents (wallet, document_side, created_at desc);

alter table public.kyc_documents enable row level security;
revoke all on public.kyc_documents from anon, authenticated;
grant select, insert, delete on public.kyc_documents to service_role;