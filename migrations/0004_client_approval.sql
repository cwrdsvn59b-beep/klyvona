-- Administrator approval gate.
-- This migration does not approve any client, including accounts that already
-- connected Instagram. There is no earlier approval record to preserve.
-- It does not delete clients, subscriptions, tokens, or webhook history.

alter table clients add column if not exists approval_status text;

update clients
set approval_status = 'pending_approval'
where approval_status is null
   or approval_status not in ('pending_approval', 'approved', 'rejected', 'suspended');

alter table clients alter column approval_status set default 'pending_approval';

alter table clients drop constraint if exists clients_approval_status_check;
alter table clients
  add constraint clients_approval_status_check
  check (approval_status in ('pending_approval', 'approved', 'rejected', 'suspended'));

alter table clients alter column approval_status set not null;

create table if not exists client_approval_events (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  admin_user_id text not null,
  reason text,
  created_at timestamptz not null default now(),
  check (previous_status in ('pending_approval', 'approved', 'rejected', 'suspended')),
  check (new_status in ('pending_approval', 'approved', 'rejected', 'suspended')),
  check (previous_status <> new_status)
);

create index if not exists client_approval_events_client_idx
  on client_approval_events (client_id, created_at desc);

alter table social_accounts add column if not exists publish_permission text;
update social_accounts set publish_permission = 'unknown' where publish_permission is null;
alter table social_accounts alter column publish_permission set default 'unknown';
alter table social_accounts drop constraint if exists social_accounts_publish_permission_check;
alter table social_accounts
  add constraint social_accounts_publish_permission_check
  check (publish_permission in ('unknown', 'confirmed', 'missing'));
alter table social_accounts alter column publish_permission set not null;
alter table social_accounts add column if not exists publish_permission_token_hash text;
alter table social_accounts add column if not exists publish_permission_at timestamptz;

-- A client who is not approved cannot keep a live publishing flag or queued work.
-- This does not delete the client, the token, or the job history.
update clients
set publishing_status = 'paused', updated_at = now()
where approval_status <> 'approved'
  and publishing_status in ('scheduled', 'publishing');

update publishing_jobs
set status = 'blocked', error_message = 'approval_revoked'
where status in ('queued', 'scheduled')
  and client_id in (select id from clients where approval_status <> 'approved');

