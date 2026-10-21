-- Manual Instagram photo posts confirmed by an administrator.
-- This file only creates a new table. It does not update, delete, or rewrite
-- instagram_test_publications, instagram_test_publication_attempts, or publishing_jobs.
create table if not exists instagram_manual_publications (
  id text primary key,
  idempotency_key text not null unique,
  client_id text not null references clients (id) on delete cascade,
  admin_user_id text not null,
  instagram_account_id text not null,
  token_hash text not null,
  image_url text not null,
  caption text not null,
  status text not null check (status in (
    'reserved',
    'container_requested',
    'container_created',
    'publish_requested',
    'published',
    'uncertain',
    'failed_before_request'
  )),
  container_id text unique,
  media_id text,
  permalink text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open or uncertain attempt per professional account. A published post
-- and a failure that never called media_publish do not block the next
-- explicit confirmation. An uncertain media_publish result does.
create unique index if not exists instagram_manual_publications_one_open_idx
  on instagram_manual_publications (instagram_account_id)
  where status in (
    'reserved',
    'container_requested',
    'container_created',
    'publish_requested',
    'uncertain'
  );

create index if not exists instagram_manual_publications_client_idx
  on instagram_manual_publications (client_id, created_at desc);
