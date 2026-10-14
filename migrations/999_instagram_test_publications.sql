-- Single, admin-confirmed Instagram test for the dedicated KLYVONA test client.
-- The unique client key deliberately forbids retrying after an ambiguous outcome.
create table if not exists instagram_test_publications (
  client_id text primary key references clients(id) on delete cascade,
  id text not null unique,
  admin_user_id text not null,
  instagram_account_id text not null,
  token_hash text not null,
  status text not null check (status in ('reserved','container_requested','container_created','publish_requested','published','uncertain','failed_before_request')),
  container_id text,
  media_id text,
  permalink text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
