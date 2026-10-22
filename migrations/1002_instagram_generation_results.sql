-- Pending. Do not apply to the production Neon database until explicitly authorized.
-- This file only creates a new table. It does not update publishing_jobs,
-- clients, subscriptions, or the onboarding webhook history.
create table if not exists instagram_generation_results (
  job_id text primary key references publishing_jobs (id) on delete cascade,
  client_id text not null references clients (id) on delete cascade,
  platform text not null check (platform = 'instagram'),
  content_type text not null check (content_type = 'photo'),
  caption text not null check (char_length(caption) between 1 and 2200),
  image_url text not null check (char_length(image_url) between 12 and 2000),
  status text not null check (status = 'generated'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_generation_results_client_idx
  on instagram_generation_results (client_id, created_at desc);
