import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";
import { SAMPLE_MAKE_CLIENT_ID, SAMPLE_MAKE_JOB_ID } from "@/lib/integrations/make-content-result";
import { receiveMakeContentResult } from "@/lib/integrations/make-content-result.server";

const secret = "make-content-result-test-secret";
const configured = { MAKE_CONTENT_RESULT_SECRET: secret } as NodeJS.ProcessEnv;
const unconfigured = {} as NodeJS.ProcessEnv;
const clientId = "11111111-1111-4111-8111-111111111111";
const otherId = "33333333-3333-4333-8333-333333333333";
const jobId = "22222222-2222-4222-8222-222222222222";
const imageUrl = "https://cdn.example.com/generated-photo.jpg";

function memorySql(db: PGlite): Sql & { texts: string[] } {
  const texts: string[] = [];
  const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
    texts.push(text);
    return (await db.query(text, params)).rows as T[];
  };
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((queryText, part, index) => queryText + part + (index < values.length ? `$${index + 1}` : ""), "");
    return query<T>(text, values);
  }) as Sql & { texts: string[] };
  sql.query = query;
  sql.texts = texts;
  let tail = Promise.resolve();
  sql.transaction = (run) => {
    const next = tail.then(async () => {
      await db.exec("BEGIN");
      try {
        const result = await run(sql);
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    });
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
  return sql;
}

function request(body: unknown, header = `Bearer ${secret}`): Request {
  return new Request("https://klyvona.example/api/integrations/make/content-result", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: header,
    },
    body: JSON.stringify(body),
  });
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    job_id: jobId,
    client_id: clientId,
    platform: "instagram",
    content_type: "photo",
    caption: "Example Instagram caption",
    image_url: imageUrl,
    status: "generated",
    ...overrides,
  };
}

async function fixture(): Promise<{ db: PGlite; sql: Sql & { texts: string[] } }> {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      approval_status text not null
    );
    create table client_subscriptions (
      client_id text primary key,
      status text not null,
      posts_used integer not null,
      posts_quota integer not null
    );
    create table publishing_jobs (
      id text primary key,
      client_id text not null,
      platform text,
      status text not null,
      error_message text,
      awaiting_generation boolean,
      created_at timestamptz not null default now()
    );
    create table webhook_deliveries (
      id text primary key,
      client_id text not null,
      destination text not null,
      status text not null,
      http_status integer,
      detail text
    );
    create table subscription_periods (
      id text primary key,
      client_id text not null,
      plan_code text not null,
      status text not null,
      period_start date not null,
      period_last date not null,
      posts_quota integer not null,
      daily_quota integer not null,
      payment_reference text
    );
  `);
  await db.exec(readFileSync(new URL("../../../migrations/1002_instagram_generation_results.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../../../docs/sql/1006_period_ownership_and_payments.sql", import.meta.url), "utf8"));
  await db.query(
    "insert into clients (id, reference_code, approval_status) values ($1, 'KV-REAL1', 'approved'), ($2, 'KV-OTHER', 'approved')",
    [clientId, otherId],
  );
  await db.query(
    "insert into client_subscriptions (client_id, status, posts_used, posts_quota) values ($1, 'trial', 0, 22), ($2, 'active', 1, 44)",
    [clientId, otherId],
  );
  await db.query(
    "insert into subscription_periods (id, client_id, plan_code, status, period_start, period_last, posts_quota, daily_quota) values ('period-a', $1, 'trial', 'trial', '2020-01-05', '2099-01-01', 22, 1), ('period-b', $2, 'monthly', 'active', '2020-01-05', '2099-01-01', 44, 2)",
    [clientId, otherId],
  );
  await db.query(
    "insert into publishing_jobs (id, client_id, platform, status, awaiting_generation, subscription_period_id) values ($1, $2, null, 'queued', true, 'period-a')",
    [jobId, clientId],
  );
  return { db, sql: memorySql(db) };
}

describe("Make content result", () => {
  it("rejects the documented sample client and does not store it", async () => {
    const { sql } = await fixture();
    const response = await receiveMakeContentResult(request({
      job_id: SAMPLE_MAKE_JOB_ID,
      client_id: SAMPLE_MAKE_CLIENT_ID,
      platform: "instagram",
      content_type: "photo",
      caption: "Example Instagram caption",
      image_url: "https://example.com/generated-photo.jpg",
      status: "generated",
    }), sql, configured);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, code: "test_fixture_rejected" });
    const rows = await sql<{ count: number }>`select count(*)::int as count from instagram_generation_results`;
    assert.equal(rows[0]?.count, 0);
  });

  it("stores one queued photo and treats the same callback as a duplicate", async () => {
    const fetchCalls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      fetchCalls.push(String(input));
      throw new Error("external call");
    }) as typeof fetch;
    try {
      const { sql } = await fixture();
      const first = await receiveMakeContentResult(request(payload()), sql, configured);
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), {
        ok: true,
        job_id: jobId,
        status: "generated",
        review: "ready",
        duplicate: false,
        published: false,
      });
      const second = await receiveMakeContentResult(request(payload()), sql, configured);
      assert.deepEqual(await second.json(), {
        ok: true,
        job_id: jobId,
        status: "generated",
        review: "ready",
        duplicate: true,
        published: false,
      });
      const rows = await sql<{ caption: string }>`select caption from instagram_generation_results`;
      const job = await sql<{ status: string }>`select status from publishing_jobs where id = ${jobId}`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.caption, "Example Instagram caption");
      assert.equal(job[0]?.status, "queued");
      assert.equal(fetchCalls.length, 0);
      assert.equal(sql.texts.some((text) => /status\s*=\s*'published'|media_publish/i.test(text)), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects a different repeat, another client, and a client without entitlement", async () => {
    const { db, sql } = await fixture();
    assert.equal((await receiveMakeContentResult(request(payload()), sql, configured)).status, 200);
    const conflict = await receiveMakeContentResult(request(payload({ caption: "Different caption" })), sql, configured);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "conflict");
    const kept = await sql<{ caption: string }>`select caption from instagram_generation_results`;
    assert.equal(kept[0]?.caption, "Example Instagram caption");

    const otherJob = "44444444-4444-4444-8444-444444444444";
    await db.query(
      "insert into publishing_jobs (id, client_id, platform, status) values ($1, $2, 'instagram', 'queued')",
      [otherJob, otherId],
    );
    const mismatch = await receiveMakeContentResult(request(payload({ job_id: otherJob })), sql, configured);
    assert.equal((await mismatch.json()).code, "mismatch");

    const blocked = "55555555-5555-4555-8555-555555555555";
    await db.query("update clients set approval_status = 'pending_approval' where id = $1", [clientId]);
    await db.query(
      "insert into publishing_jobs (id, client_id, platform, status) values ($1, $2, 'instagram', 'queued')",
      [blocked, clientId],
    );
    const denied = await receiveMakeContentResult(request(payload({ job_id: blocked })), sql, configured);
    assert.equal((await denied.json()).code, "not_entitled");
    const count = await sql<{ count: number }>`select count(*)::int as count from instagram_generation_results`;
    assert.equal(count[0]?.count, 1);
  });

  it("does not accept a missing secret, a published job, or the onboarding webhook", async () => {
    const { sql } = await fixture();
    const missing = await receiveMakeContentResult(request(payload(), "Bearer anything-at-least-24-chars"), sql, unconfigured);
    assert.equal((await missing.json()).code, "integration_not_configured");
    const unauthorized = await receiveMakeContentResult(request(payload(), "Bearer wrong-secret-value-000000"), sql, configured);
    assert.equal(unauthorized.status, 401);
    await sql`update publishing_jobs set status = 'published' where id = ${jobId}`;
    const late = await receiveMakeContentResult(request(payload()), sql, configured);
    assert.equal((await late.json()).code, "not_awaiting");
    const outbound = readFileSync(new URL("./make.server.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../routes/api/integrations/make/content-result.ts", import.meta.url), "utf8");
    assert.match(outbound, /onboarding\.completed/);
    assert.doesNotMatch(outbound, /content-result|MAKE_CONTENT_RESULT_SECRET/);
    assert.doesNotMatch(route, /notifyMake|media_publish|MAKE_WEBHOOK_URL|MAKE_CONTENT_RESULT_SECRET/);
  });
});
