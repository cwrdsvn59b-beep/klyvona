-- Second independent Instagram test for the same real client.
-- This file only creates a new table. It does not update, delete, or rewrite
-- instagram_test_publications, so the original uncertain row stays as it is.
create table if not exists instagram_test_publication_attempts (
  id text primary key,
  client_id text not null unique references clients(id) on delete cascade,
  admin_user_id text not null,
  instagram_account_id text not null unique,
  token_hash text not null,
  status text not null check (status in ('reserved','container_requested','container_created','publish_requested','published','uncertain','failed_before_request')),
  container_id text unique,
  media_id text,
  permalink text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function reject_reused_instagram_test_container()
returns trigger
language plpgsql
as $$
begin
  if new.container_id is not null and exists (
    select 1 from instagram_test_publications
    where container_id = new.container_id
  ) then
    raise exception 'reused_instagram_test_container';
  end if;
  return new;
end;
$$;

drop trigger if exists instagram_test_attempts_no_reused_container on instagram_test_publication_attempts;
create trigger instagram_test_attempts_no_reused_container
before insert or update of container_id on instagram_test_publication_attempts
for each row execute function reject_reused_instagram_test_container();
