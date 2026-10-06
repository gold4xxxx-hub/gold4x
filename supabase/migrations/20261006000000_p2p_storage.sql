create extension if not exists pgcrypto;

create table if not exists public.p2p_messages (
  id uuid primary key default gen_random_uuid(),
  trade_id bigint not null check (trade_id > 0),
  sender_wallet text not null check (sender_wallet ~ '^0x[a-f0-9]{40}$'),
  request_id uuid not null,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  chain_block bigint not null check (chain_block > 0),
  created_at timestamptz not null default now(),
  unique (trade_id, sender_wallet, request_id)
);

create index if not exists p2p_messages_trade_created_idx
  on public.p2p_messages (trade_id, created_at, id);

alter table public.p2p_messages enable row level security;
revoke all on public.p2p_messages from anon, authenticated;
grant select, insert on public.p2p_messages to service_role;

create table if not exists public.p2p_files (
  id uuid primary key default gen_random_uuid(),
  trade_id bigint not null check (trade_id > 0),
  uploaded_by text not null check (uploaded_by ~ '^0x[a-f0-9]{40}$'),
  request_id uuid not null,
  object_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (trade_id, uploaded_by, request_id)
);

create index if not exists p2p_files_trade_created_idx
  on public.p2p_files (trade_id, created_at desc, id);

alter table public.p2p_files enable row level security;
revoke all on public.p2p_files from anon, authenticated;
grant select, insert, delete on public.p2p_files to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'p2p-private',
  'p2p-private',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;