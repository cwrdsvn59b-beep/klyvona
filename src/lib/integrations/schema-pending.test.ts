import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

function migrationPrefix(name: string): number {
  const match = /^(\d+)/.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

describe("pending subscription SQL on a local PGLite copy", () => {
  it("applies migrations, 1005, and 1006 twice without deleting rows or crossing clients", async () => {
    const db = new PGlite();
    const root = new URL("../../../migrations/", import.meta.url);
    const names = readdirSync(root)
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => migrationPrefix(left) - migrationPrefix(right) || left.localeCompare(right));
    for (const name of names) await db.exec(readFileSync(new URL(name, root), "utf8"));
    const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query(
      "insert into clients (id, reference_code, contact_name, email, phone) values ($1, 'KV-OLDAA', 'Old', 'old@example.com', '0500000000'), ($2, 'KV-OLDBB', 'Other', 'other@example.com', '0500000001')",
      [clientId, otherId],
    );
    await db.query(
      "insert into client_subscriptions (id, client_id, plan_code, status, posts_quota) values ($1, $2, 'trial', 'trial', 22)",
      [`sub-${clientId}`, clientId],
    );
    const legacyJob = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query(
      "insert into publishing_jobs (id, client_id, status) values ($1, $2, 'queued')",
      [legacyJob, clientId],
    );
    await db.query(
      "insert into instagram_generation_results (job_id, client_id, platform, content_type, caption, image_url, status) values ($1, $2, 'instagram', 'photo', 'Kept caption', 'https://cdn.example.com/old.jpg', 'generated')",
      [legacyJob, clientId],
    );
    const before = await db.query<{ clients: number; results: number }>(
      "select (select count(*)::int from clients) as clients, (select count(*)::int from instagram_generation_results) as results",
    );
    const pending = new URL("../../../docs/sql/", import.meta.url);
    await db.exec(readFileSync(new URL("1005_subscription_periods.sql", pending), "utf8"));
    await db.exec(readFileSync(new URL("1006_period_ownership_and_payments.sql", pending), "utf8"));
    await db.exec(readFileSync(new URL("1005_subscription_periods.sql", pending), "utf8"));
    await db.exec(readFileSync(new URL("1006_period_ownership_and_payments.sql", pending), "utf8"));
    const after = await db.query<{ clients: number; results: number; period_id: string | null }>(
      "select (select count(*)::int from clients) as clients, (select count(*)::int from instagram_generation_results) as results, (select subscription_period_id from publishing_jobs where id = $1) as period_id",
      [legacyJob],
    );
    assert.equal(after.rows[0]?.clients, before.rows[0]?.clients);
    assert.equal(after.rows[0]?.results, before.rows[0]?.results);
    assert.equal(after.rows[0]?.period_id, null);
    const kept = await db.query<{ caption: string }>("select caption from instagram_generation_results where job_id = $1", [legacyJob]);
    assert.equal(kept.rows[0]?.caption, "Kept caption");
    await db.query(
      "insert into subscription_periods (id, client_id, plan_code, status, period_start, period_last, posts_quota, daily_quota) values ('period-a', $1, 'trial', 'cancelled', '2026-10-18', '2026-11-17', 22, 1)",
      [clientId],
    );
    await assert.rejects(db.query(
      "insert into publishing_jobs (id, client_id, platform, status, subscription_period_id) values ($1, $2, 'instagram', 'queued', 'period-a')",
      ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", otherId],
    ));
    await db.query(
      "insert into payment_confirmations (id, payment_id, client_id, amount_ils, currency, source, confirmed_by, period_id) values ('pay-1', 'bank-ref-001', $1, 600, 'ILS', 'admin_attestation', 'admin-user', null)",
      [clientId],
    );
    const visible = await db.query<{ id: string; dispatch_state: string | null; has_result: boolean }>(`
      select j.id, d.dispatch_state,
        exists (select 1 from instagram_generation_results r where r.job_id = j.id and r.client_id = j.client_id) as has_result
      from publishing_jobs j
      left join webhook_deliveries d
        on d.client_id = j.client_id and d.destination = 'make-content' and d.detail = ('job:' || j.id)
      where j.client_id = $1
    `, [clientId]);
    assert.equal(visible.rows[0]?.id, legacyJob);
    assert.equal(visible.rows[0]?.dispatch_state, null);
    assert.equal(visible.rows[0]?.has_result, true);
    await assert.rejects(db.query(
      "insert into payment_confirmations (id, payment_id, client_id, amount_ils, currency, source, confirmed_by) values ('pay-2', 'bank-ref-001', $1, 600, 'ILS', 'admin_attestation', 'admin-user')",
      [otherId],
    ));
    const ownedJob = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await db.query(
      "insert into publishing_jobs (id, client_id, platform, status, subscription_period_id) values ($1, $2, 'instagram', 'failed', 'period-a')",
      [ownedJob, clientId],
    );
    await assert.rejects(db.query(
      "insert into instagram_generation_results (job_id, client_id, platform, content_type, caption, image_url, status, subscription_period_id) values ($1, $2, 'instagram', 'photo', 'Foreign', 'https://cdn.example.com/x.jpg', 'generated', 'period-a')",
      [ownedJob, otherId],
    ));
  });
});
