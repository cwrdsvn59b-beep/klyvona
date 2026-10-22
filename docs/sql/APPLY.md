# Pending SQL — not applied

The launch steps, support questions and rollback rule are in [docs/PRODUCTION-LAUNCH-RUNBOOK.md](../PRODUCTION-LAUNCH-RUNBOOK.md). Do not apply this directory before that runbook's identification step.

Do not copy these files into `migrations/`. `npm run build` runs `db:migrate`, which reads only that directory.

Production Neon is not identified until T-I7024 answers. Do not run this plan there.

## Apply order, after a backup and a schema check

1. Confirm migrations `0001` through `1004` are already recorded. Their production state is unknown. Do not re-run a migration that is already applied. Do not invent missing history.
2. `docs/sql/1005_subscription_periods.sql` creates the period ledger. It does not rewrite clients.
3. `docs/sql/1006_period_ownership_and_payments.sql` adds nullable period ids, dispatch state, manual payment rows, reconciliation rows, and same-client foreign keys.

`1005` and `1006` are written to be re-runnable (`if not exists`). Re-running them does not delete clients, jobs, or results.

## Legacy rows

Jobs and results from before `1006` keep `subscription_period_id` null. The application does not assign them to a new period, does not send them to Make again, and does not treat `posts_used` as a quota fallback. Classifying them needs a production snapshot and stays blocked.

## Rollback

The commented drops at the bottom of each file are only for an empty draft schema. Dropping `payment_confirmations` or `instagram_generation_results` after real rows exist destroys payment evidence or generated photos. That is not a safe production rollback. A safe rollback is restoring the backup taken before the apply.

Israeli public holidays are not part of this schema. Posting days remain Sunday–Thursday, Asia/Jerusalem.
