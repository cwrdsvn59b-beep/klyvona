# Pending SQL — not applied

Do not copy these files into `migrations/`. `npm run build` runs `db:migrate`, which reads only that directory.

1. `migrations/1002_instagram_generation_results.sql` and `migrations/1003_photo_generation_jobs.sql` must already be on the database. Their application state in production is unknown until T-I7024.
2. `docs/sql/1005_subscription_periods.sql` creates the period ledger.
3. `docs/sql/1006_period_ownership_and_payments.sql` binds jobs and results to a period, records dispatch state, and stores manual payment attestations.

Each file ends with a commented rollback. Roll back in reverse order. Do not run either file against production Neon until the database is identified and backed up.

Israeli public holidays are not part of this schema. Posting days remain Sunday–Thursday, Asia/Jerusalem.
