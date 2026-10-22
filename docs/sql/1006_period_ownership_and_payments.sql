-- Pending. Apply only after docs/sql/1005_subscription_periods.sql and only after
-- T-I7024 identifies the production database and a backup exists.
-- Do not copy this file into migrations/. scripts/migrate.mjs will not read it.
-- Order: migrations 1002 and 1003, then 1005, then this file.
-- It does not update client rows, tokens, or onboarding deliveries.
-- Existing generated photos stay in place. New columns are nullable so old rows
-- are not rewritten; new jobs must set subscription_period_id in application code.

alter table publishing_jobs
  add column if not exists subscription_period_id text;

alter table instagram_generation_results
  add column if not exists subscription_period_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'publishing_jobs_subscription_period_fk'
  ) then
    alter table publishing_jobs
      add constraint publishing_jobs_subscription_period_fk
      foreign key (subscription_period_id) references subscription_periods (id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'instagram_generation_results_period_fk'
  ) then
    alter table instagram_generation_results
      add constraint instagram_generation_results_period_fk
      foreign key (subscription_period_id) references subscription_periods (id);
  end if;
end $$;

create index if not exists publishing_jobs_period_idx
  on publishing_jobs (subscription_period_id);

create index if not exists instagram_generation_results_period_idx
  on instagram_generation_results (subscription_period_id);

alter table webhook_deliveries
  add column if not exists dispatch_state text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'webhook_deliveries_dispatch_state_chk'
  ) then
    alter table webhook_deliveries
      add constraint webhook_deliveries_dispatch_state_chk
      check (
        dispatch_state is null
        or dispatch_state in (
          'never_attempted',
          'attempted_unknown',
          'confirmed_not_started',
          'confirmed_generated'
        )
      );
  end if;
end $$;

-- Manual attestation only. This is not a payment-provider integration.
create table if not exists payment_confirmations (
  id text primary key,
  payment_id text not null,
  client_id text not null references clients (id) on delete cascade,
  amount_ils integer not null,
  currency text not null,
  source text not null check (source = 'admin_attestation'),
  confirmed_by text not null,
  period_id text,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_confirmations_payment_id_idx
  on payment_confirmations (payment_id);

create table if not exists quota_reconciliations (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  job_id text not null,
  actor_id text not null,
  reason text not null,
  prior_state text not null,
  outcome text not null,
  spend_warning boolean not null,
  created_at timestamptz not null default now()
);

-- Rollback, run only when this draft schema must be removed and its rows may be dropped:
-- drop table if exists quota_reconciliations;
-- drop table if exists payment_confirmations;
-- alter table webhook_deliveries drop constraint if exists webhook_deliveries_dispatch_state_chk;
-- alter table webhook_deliveries drop column if exists dispatch_state;
-- alter table instagram_generation_results drop constraint if exists instagram_generation_results_period_fk;
-- alter table publishing_jobs drop constraint if exists publishing_jobs_subscription_period_fk;
-- drop index if exists instagram_generation_results_period_idx;
-- drop index if exists publishing_jobs_period_idx;
-- alter table instagram_generation_results drop column if exists subscription_period_id;
-- alter table publishing_jobs drop column if exists subscription_period_id;
