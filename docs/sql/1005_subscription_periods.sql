-- Pending ledger. Do not move this file into migrations/ until T-I7024 is
-- resolved and application is explicitly authorized. scripts/migrate.mjs only
-- reads the top-level migrations directory, so a build will not apply this file.
-- It does not update existing clients, tokens, or onboarding deliveries.

create table if not exists subscription_periods (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  plan_code text not null check (plan_code in ('trial', 'monthly')),
  status text not null check (status in ('trial', 'active', 'awaiting_billing', 'past_due', 'cancelled')),
  period_start date not null,
  period_last date not null,
  posts_quota integer not null check (posts_quota > 0),
  daily_quota integer not null check (daily_quota > 0),
  payment_reference text,
  created_at timestamptz not null default now()
);

create unique index if not exists subscription_periods_one_open_idx
  on subscription_periods (client_id)
  where status in ('trial', 'active');
