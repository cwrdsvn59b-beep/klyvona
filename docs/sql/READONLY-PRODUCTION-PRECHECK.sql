-- Read-only checks for the production database AFTER T-I7024 identifies it.
-- Do not run this file until that database is confirmed.
-- Do not run it against an unknown host. Do not paste the output if it contains a secret.
-- This file is not a migration. scripts/migrate.mjs does not read docs/sql/.

-- 1. Identity. Compare host, database and role with the published app. Do not print the password.
select current_database() as database_name,
       current_user as role_name,
       inet_server_addr() as server_addr,
       inet_server_port() as server_port,
       current_setting('server_version') as server_version;

-- 2. Migrations already recorded by scripts/migrate.mjs. Expected product names:
--    0001_auth.sql, 0002_klyvona.sql, 0003_meta_oauth.sql, 0004_client_approval.sql,
--    999_instagram_test_publications.sql, 1000_instagram_test_publication_attempts.sql,
--    1001_instagram_manual_publications.sql, 1002_instagram_generation_results.sql,
--    1003_photo_generation_jobs.sql, 1004_instagram_generation_review.sql.
--    1005 and 1006 must be absent from this list before they are applied by hand.
select name, applied_at
from _migrations
order by name;

-- 3. Whether the pending ledger objects already exist.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'subscription_periods',
    'payment_confirmations',
    'quota_reconciliations',
    'publishing_jobs',
    'instagram_generation_results',
    'webhook_deliveries',
    'clients'
  )
order by table_name;

select table_name, column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'publishing_jobs' and column_name = 'subscription_period_id')
    or (table_name = 'instagram_generation_results' and column_name = 'subscription_period_id')
    or (table_name = 'webhook_deliveries' and column_name = 'dispatch_state')
    or (table_name = 'subscription_periods' and column_name in ('id', 'client_id', 'status', 'payment_reference'))
    or (table_name = 'payment_confirmations' and column_name in ('payment_id', 'amount_ils', 'currency', 'period_id', 'source'))
  )
order by table_name, column_name;

-- 4. Counts only. No captions, image URLs, tokens, hashes or client secrets.
select
  (select count(*) from clients) as clients,
  (select count(*) from publishing_jobs) as jobs,
  (select count(*) from instagram_generation_results) as results,
  (select count(*) from webhook_deliveries) as deliveries;

-- 5. Legacy rows. Run only after the nullable column exists.
--    Before 1006 these queries fail with undefined_column; that is expected.
select count(*) as jobs_without_period
from publishing_jobs
where subscription_period_id is null;

select status, count(*) as jobs
from publishing_jobs
where subscription_period_id is null
group by status
order by status;

select count(*) as results_without_period
from instagram_generation_results
where subscription_period_id is null;

select coalesce(dispatch_state, '<null>') as dispatch_state, count(*) as deliveries
from webhook_deliveries
where destination = 'make-content'
group by dispatch_state
order by dispatch_state;

-- 6. After 1006, confirm the safety constraints exist. Names only.
select conname, contype
from pg_constraint
where conname in (
  'payment_confirmations_amount_chk',
  'publishing_jobs_period_client_fk',
  'instagram_generation_results_period_client_fk',
  'instagram_generation_results_job_client_fk',
  'payment_confirmations_period_client_fk'
)
order by conname;

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'subscription_periods_one_open_idx',
    'subscription_periods_id_client_idx',
    'publishing_jobs_id_client_idx',
    'publishing_jobs_one_awaiting_photo_idx',
    'webhook_deliveries_make_content_job_idx',
    'payment_confirmations_payment_id_idx',
    'payment_confirmations_one_period_idx'
  )
order by indexname;
