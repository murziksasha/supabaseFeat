-- Migration: Create clients and messages tables for durable chat state

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  external_user_id text unique not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  external_user_id text not null,
  direction text not null check (direction in ('client', 'bot')),
  body text not null,
  created_at timestamptz not null default now()
);

-- Performance indexes for sorting and foreign key lookup
create index if not exists idx_clients_last_message_at on clients(last_message_at desc);
create index if not exists idx_messages_created_at on messages(created_at desc);
create index if not exists idx_messages_client_id on messages(client_id);
create index if not exists idx_messages_external_user_id on messages(external_user_id);

