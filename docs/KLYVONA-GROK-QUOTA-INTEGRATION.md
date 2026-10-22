# KLYVONA — Grok integration package (not deployed)

**Do not merge or deploy automatically.** Grok's current local source is newer than GitHub main. The newer `photo-job`, `content-result`, review handlers and migrations 1002–1004 are absent from GitHub main. This branch supplies a pure quota module, no-cost unit tests and precise integration requirements, NOT a falsely claimed full server integration.

## Safety / cost
- **NO Publish, Deploy, production build, production Neon queries, migration execution, Make calls, Instagram publishing, or paid image/video tests.**
- Grok support ticket **T-I7024** must resolve identity and backup of the actual Grok-managed production Neon before any migration.
- In GitHub main `npm run build` calls `db:migrate`. A connected build can write to the database.
- Preserve working onboarding, Make photo chain and Instagram-only scope. Facebook/TikTok stay disabled.
- Existing production migration status 1002–1004 is UNKNOWN.

## Commercial policy
- Trial: 22 photos across 22 posting days, max 1 per eligible day, 0 ₪.
- Monthly: 44 photos across 22 posting days, max 2 per eligible day, 600 ₪ VAT included.
- Video excluded. Generated-but-rejected photos count toward quota (paid generation occurred). No unlimited free re-generation.
- Default posting days Sunday–Thursday, server timezone Asia/Jerusalem. **Israeli public holidays are not modeled** in the pure module; explicitly decide calendar policy before launch.
- 22 eligible days and the payment/billing month are separate concepts. Never auto-renew or start a paid period without verified payment.
- Trial should begin on first eligible approved and connected day, not silently at initial signup. Preserve history and disallow multiple free trials.

## Implement in Grok-local current source, not old GitHub handlers
1. Define immutable subscription periods with plan, start, last posting day, daily/total quota and verified payment reference (trial exempt). Paid conversion updates plan_code and quota 44 atomically with a new period. Renewal starts only after payment confirmation. Cancellation/unpaid states block new jobs.
2. Enforce `checkQuota` server-side **inside a database transaction with row lock** on period/client, counting current-period generated results PLUS reserved in-flight jobs, including today's count. Insert reservation/job in the SAME transaction. Pure helper alone is not concurrency-safe.
3. Use one authoritative count for admin UI, client UI, photo-job and callback. `posts_used` currently stale; remove its use or synchronize it atomically. Display consumed, reserved, available, period dates and status.
4. Unique job_id/idempotency key, unique generated result per job, unique pending job per client where appropriate. Repeated identical callback returns success without additional rows/quota. Validate job_id belongs to client_id and period; callback cannot bypass quota via stale posts_used.
5. **At-most-once chargeable dispatch:** repeated photo-job with same job_id MUST NOT re-call Make. Atomic dispatch claim, durable dispatch state, finite retry budget. Timeout/unknown outcome requires reconciliation; do not blindly retry chargeable generation. Pass job_id to Make for deduplication before its paid image-generation step.
6. Stale job recovery: bounded timeout, admin reconciliation, no indefinite blocked slot. Never automatically free a reservation and regenerate when an external paid generation might still complete.
7. Failed-before-generation job may release reservation; generated/rejected image still consumes quota. Optional admin-authorized replacement must be limited and audited.
8. Do not auto-publish approved /reviews photos. Keep manual admin JPEG publication separate and clearly labeled. Respect existing Meta approval checks for eventual publishing.
9. Protect cross-client isolation; all queries must scope client_id. Reconcile migration 1003 unique indexes rather than create duplicates. Never place unreviewed migration in active migrations directory.

## API contract to preserve
`POST /api/integrations/make/photo-job`: client secret, approval, subscription, quota -> queued job -> outbound `MAKE_CONTENT_WEBHOOK_URL`.
`POST /api/integrations/make/content-result`: Bearer `MAKE_CONTENT_RESULT_SECRET`, job_id, client_id, platform instagram, content_type photo, caption, image_url, status generated. Idempotent callback.
`/reviews`: client-owned photo and approval/rejection. This flow does not publish to Instagram.

## Tests before launch
No-cost pure tests for 22/44, 1/2 daily, Fri/Sat, expiry, unpaid, rejected consumption; disposable-local DB tests for two concurrent jobs, duplicate callback, timeout/retry, expired job, paid transition and isolation. No production DB or Make testing until separately approved.

## Single Grok handoff instruction
Read this document and `src/lib/subscription-policy.ts`. Integrate into your NEWER local code without overwriting it with old GitHub files. Perform one coherent local-only implementation; no Publish, Deploy, production build, migrations, production DB access, Make or Instagram calls. Return one consolidated diff/file list and unresolved items. Do not claim code integrated until current handlers actually call the policy and DB transactions enforce it.

## Local integration note
The period ledger SQL lives in `docs/sql/1005_subscription_periods.sql`, outside `migrations/`, so `npm run build` cannot apply it. Handlers call `checkQuota` inside `sql.transaction` with `FOR UPDATE`. A chargeable Make dispatch is attempted at most once per `job_id`.
