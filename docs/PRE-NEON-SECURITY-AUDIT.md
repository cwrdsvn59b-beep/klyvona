# KLYVONA — pre-Neon hardening checklist (read-only source review)

Source baseline: `backup/grok-local-after-quota-integration` at commit `507d2689bc4f0b130ff6a7366571c107e3cb2467`.

This is a **static code review**, not proof of production behavior. Do not merge, deploy, build against production, run migrations, call Make, or spend money on external tests. Preserve backup branch and newer Grok source.

## P0 — payment proof is not authenticated by period-opening function
**Evidence:** `src/lib/integrations/quota-period.ts`, `openPaidPeriod`, checks `PAYMENT_REFERENCE.test(paymentReference)` then calls `paidPeriodAllowed`, which simply returns its boolean input. This checks string syntax, not settlement or authenticity. The function itself does not prove payment.

**Action:** enforce a trusted payment-verification boundary (verified provider event or independently reconciled admin attestation with authenticated admin actor, audit trail, idempotent payment reference and amount/currency check). The period-opening function must only accept verified evidence from trusted server-side code, not user-controlled strings. Block duplicate paid periods for same payment reference. Do not invent a provider integration before the billing provider is chosen.

**Offline acceptance:** fake syntactically valid reference cannot start paid period; duplicate event cannot open second period; wrong amount/currency rejected; valid verified evidence opens exactly one period.

## P0 — uncertain Make delivery must not release chargeable reservation
**Evidence:** `reconcileFailedReservation` keeps only delivery.status === 'sent'; otherwise it closes a queued reservation. A `failed` or `skipped` delivery can still represent an attempted network call with an unknown external outcome. `dispatchPhotoGeneration` returns attempted=true for HTTP errors/timeouts.

**Action:** distinguish `never_attempted`, `attempted_unknown`, `confirmed_not_started`, `confirmed_generated`. Release only with evidence no paid generation began; otherwise quarantine and require explicit audited reconciliation. Preserve at-most-once Make dispatch and callback idempotency. Do not re-run generation on retry.

**Offline acceptance:** network timeout + admin reconciliation cannot silently release or resend; pre-network invalid URL releases; duplicate job never dispatches again.

## P1 — results must belong to immutable subscription period
**Evidence:** `counts` associates jobs/results to a period using `created_at` calendar date, rather than a `period_id`. `acceptGeneratedPhoto` inserts result with `j.created_at`, and reads the currently active period, not the period that reserved the job. `openPaidPeriod` cancels old periods when starting a new one.

**Action:** add a job-to-period FK and result-to-job period ownership in a future **reviewed** SQL migration, not active `migrations/` yet. Count by period ID. Define behavior for callbacks after period rollover and for cancellation. Preserve historical generated results and avoid counting them in a later period. This change requires a schema review and later database backup.

**Offline acceptance:** late callback from prior period is attributed only to prior period; new paid quota is unaffected; duplicate callback remains idempotent; cancellation does not erase history.

## P1 — period and posting calendar
`postingWindow` counts Sunday–Thursday only. Israeli public holidays are not excluded. Confirm business policy before implementing holiday logic. The server must derive date from `Asia/Jerusalem`, not from caller-provided values in production.

## P1 — callback and status consistency
Ensure callbacks accepted after dispatch reconcile job state and reservations atomically. Never conflate webhook delivery status with proof of paid generation. Keep `/reviews` non-publishing.

## Safe sequence without Neon
1. Static audit and offline unit tests.
2. Local-only implementation against latest Grok source with no paid network calls.
3. Review pending SQL in `docs/sql` without applying.
4. Keep existing backup unchanged; create separate implementation branch and draft PR.
5. Wait for T-I7024 to identify production Neon and obtain backup **before** any migrations or deployment.

**No production changes authorized by this document.**
