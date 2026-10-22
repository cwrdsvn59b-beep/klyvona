-- Pending. Do not apply to the production Neon database until explicitly authorized.
-- Adds a nullable flag and two indexes. It does not update, delete, or rewrite
-- existing publishing_jobs rows, clients, subscriptions, or onboarding deliveries.
alter table publishing_jobs add column if not exists awaiting_generation boolean;

-- One Instagram photo request may wait on Make per client. A saved result
-- clears the flag, so the next entitled photo can be requested later.
create unique index if not exists publishing_jobs_one_awaiting_photo_idx
  on publishing_jobs (client_id)
  where awaiting_generation is true
    and platform = 'instagram'
    and status = 'queued';

-- One outbound content request per job. This does not affect destination 'make'.
create unique index if not exists webhook_deliveries_make_content_job_idx
  on webhook_deliveries (detail)
  where destination = 'make-content';
