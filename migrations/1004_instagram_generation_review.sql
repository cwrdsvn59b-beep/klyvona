-- Pending. Do not apply to the production Neon database until explicitly authorized.
-- Adds the review state for an already stored generated photo.
-- It does not change publishing_jobs, clients, subscriptions, or onboarding.
alter table instagram_generation_results
  add column if not exists review_status text not null default 'pending';

alter table instagram_generation_results
  drop constraint if exists instagram_generation_results_review_status_check;

alter table instagram_generation_results
  add constraint instagram_generation_results_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));
