-- Meta OAuth state and one-time customer connect secret.
-- Tokens stay in social_accounts.token_ciphertext. This file never inserts a token.

alter table clients add column if not exists connect_secret_hash text;

create table if not exists oauth_states (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  nonce_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_states_client_idx on oauth_states (client_id, created_at desc);

create table if not exists oauth_pending_accounts (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  state_id text not null references oauth_states (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  external_account_id text not null,
  display_name text not null,
  eligible boolean not null,
  ineligible_reason text,
  token_ciphertext text,
  token_expires_at timestamptz,
  parent_external_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_pending_client_idx on oauth_pending_accounts (client_id, expires_at);
