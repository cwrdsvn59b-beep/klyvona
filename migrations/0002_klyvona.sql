-- KLYVONA Connect schema.
-- Access control lives in server functions: public intake is insert-only and
-- returns a reference, never a client list. Admin reads require a matching
-- staff_members row for the authenticated user. Postgres RLS is not relied on
-- because the app connects as the database owner (RLS would be bypassed) and
-- pooled Neon connections do not keep session settings between statements.
-- OAuth tokens, if they are ever stored, belong only in token_ciphertext and
-- are written by server code. This migration never inserts a token.

create table if not exists staff_members (
  user_id text primary key,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

create table if not exists subscription_plans (
  code text primary key,
  name_he text not null,
  price_ils_incl_vat integer not null check (price_ils_incl_vat >= 0),
  photo_posts integer not null check (photo_posts > 0),
  business_days integer not null check (business_days > 0),
  includes_video boolean not null default false,
  description_he text not null
);

create table if not exists clients (
  id text primary key,
  reference_code text not null unique,
  contact_name text not null,
  email text not null,
  phone text not null,
  onboarding_status text not null default 'completed'
    check (onboarding_status in ('in_progress', 'completed')),
  publishing_status text not null default 'waiting_connection'
    check (publishing_status in ('waiting_connection', 'scheduled', 'publishing', 'paused', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_profiles (
  id text primary key,
  client_id text not null unique references clients (id) on delete cascade,
  business_name text not null,
  industry text not null,
  description text not null,
  target_audience text not null,
  brand_voice text not null,
  services text not null,
  visual_style text not null,
  created_at timestamptz not null default now()
);

create table if not exists social_accounts (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok')),
  status text not null default 'awaiting_setup'
    check (status in ('awaiting_setup', 'pending', 'connected', 'expired', 'error')),
  token_ciphertext text,
  token_expires_at timestamptz,
  last_error text,
  external_account_id text,
  connected_at timestamptz,
  unique (client_id, platform)
);

create table if not exists client_subscriptions (
  id text primary key,
  client_id text not null unique references clients (id) on delete cascade,
  plan_code text not null references subscription_plans (code),
  status text not null
    check (status in ('trial', 'awaiting_billing', 'active', 'past_due', 'cancelled')),
  posts_quota integer not null check (posts_quota > 0),
  posts_used integer not null default 0 check (posts_used >= 0),
  started_at timestamptz not null default now()
);

create table if not exists onboarding_events (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  step text not null,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists publishing_jobs (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  platform text,
  status text not null
    check (status in ('queued', 'scheduled', 'published', 'failed', 'blocked')),
  scheduled_for date,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id text primary key,
  client_id text not null references clients (id) on delete cascade,
  destination text not null,
  status text not null check (status in ('skipped', 'sent', 'failed')),
  http_status integer,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists clients_created_idx on clients (created_at desc);
create index if not exists clients_email_idx on clients (email);
create index if not exists onboarding_events_client_idx on onboarding_events (client_id, created_at);
create index if not exists publishing_jobs_client_idx on publishing_jobs (client_id, created_at);
create index if not exists webhook_deliveries_client_idx on webhook_deliveries (client_id, created_at);
create index if not exists social_accounts_status_idx on social_accounts (status);

insert into subscription_plans (
  code, name_he, price_ils_incl_vat, photo_posts, business_days, includes_video, description_he
) values
  (
    'trial',
    'ניסיון',
    0,
    22,
    22,
    false,
    '22 פוסטים עם תמונה לאורך 22 ימי עסקים, ללא עלות. הפקת וידאו אינה כלולה.'
  ),
  (
    'monthly',
    'חודשי',
    600,
    44,
    22,
    false,
    '44 פוסטים עם תמונה לאורך 22 ימי עסקים. 600 ₪ לחודש כולל מע״מ. הפקת וידאו אינה כלולה ומתומחרת בנפרד.'
  )
on conflict (code) do nothing;
