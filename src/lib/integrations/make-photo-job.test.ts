import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";
import { receiveMakeContentResult } from "@/lib/integrations/make-content-result.server";
import { createPhotoGenerationJob, type PhotoJobNotice } from "@/lib/integrations/make-photo-job.server";
import { sha256Hex } from "@/lib/oauth/meta-guards";

const reference = "KV-PHOTO1";
const connectSecret = "client-connect-secret-1";
const clientId = "11111111-1111-4111-8111-111111111111";
const callbackSecret = "make-content-result-test-secret";
const imageUrl = "https://cdn.example.com/generated-photo.jpg";

function memorySql(db: PGlite): Sql {
  const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await db.query(text, params)).rows as T[];
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((queryText, part, index) => queryText + part + (index < values.length ? `$${index + 1}` : ""), "");
    return query<T>(text, values);
  }) as Sql;
  sql.query = query;
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

async function fixture(quota = 22): Promise<Sql> {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      approval_status text not null,
      connect_secret_hash text
    );
    create table subscription_plans (
      code text primary key,
      photo_posts integer not null
    );
    create table client_subscriptions (
      client_id text primary key,
      plan_code text not null,
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
    create table social_accounts (
      client_id text not null,
      platform text not null,
      status text not null
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
    create table onboarding_events (
      id text primary key,
      client_id text not null,
      step text not null,
      status text not null,
      detail text
    );
  `);
  const root = new URL("../../../migrations/", import.meta.url);
  await db.exec(readFileSync(new URL("1002_instagram_generation_results.sql", root), "utf8"));
  await db.exec(readFileSync(new URL("1003_photo_generation_jobs.sql", root), "utf8"));
  await db.query("insert into subscription_plans (code, photo_posts) values ('trial', 22)");
  await db.query(
    "insert into clients (id, reference_code, approval_status, connect_secret_hash) values ($1, $2, 'approved', $3)",
    [clientId, reference, sha256Hex(connectSecret)],
  );
  await db.query(
    "insert into client_subscriptions (client_id, plan_code, status, posts_used, posts_quota) values ($1, 'trial', 'trial', 0, $2)",
    [clientId, quota],
  );
  await db.query(
    "insert into social_accounts (client_id, platform, status) values ($1, 'instagram', 'connected')",
    [clientId],
  );
  return memorySql(db);
}

function dispatchRecorder() {
  const notices: PhotoJobNotice[] = [];
  return {
    notices,
    dispatch: async (notice: PhotoJobNotice) => {
      notices.push(notice);
      return { status: "sent" as const, httpStatus: 200, attempted: true };
    },
  };
}

function callback(jobId: string) {
  return new Request("https://klyvona.example/api/integrations/make/content-result", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${callbackSecret}`,
    },
    body: JSON.stringify({
      job_id: jobId,
      client_id: clientId,
      platform: "instagram",
      content_type: "photo",
      caption: "Example Instagram caption",
      image_url: imageUrl,
      status: "generated",
    }),
  });
}

describe("photo generation lifecycle", () => {
  it("queues one job, notifies Make once, then stores the callback for review", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("external call");
    }) as typeof fetch;
    try {
      const created = await createPhotoGenerationJob({
        sql,
        reference,
        connectSecret,
        contentType: "photo",
        dispatch: recorder.dispatch,
        today: "2026-10-22",
      });
      const createdBody = await created.json();
      assert.equal(created.status, 200);
      assert.equal(createdBody.duplicate, false);
      assert.equal(createdBody.status, "queued");
      assert.equal(createdBody.make, "sent");
      assert.equal(createdBody.published, false);
      const jobId = createdBody.job_id as string;

      const repeat = await createPhotoGenerationJob({
        sql,
        reference,
        connectSecret,
        contentType: "photo",
        dispatch: recorder.dispatch,
        today: "2026-10-22",
      });
      const repeatBody = await repeat.json();
      assert.equal(repeatBody.job_id, jobId);
      assert.equal(repeatBody.duplicate, true);
      assert.equal(repeatBody.make, "sent");
      assert.equal(recorder.notices.length, 1);
      assert.equal(recorder.notices[0]?.event, "content.generation_requested");
      assert.equal(recorder.notices[0]?.job_id, jobId);
      assert.equal(recorder.notices[0]?.client_id, clientId);
      assert.equal(JSON.stringify(recorder.notices[0]).includes(connectSecret), false);

      const saved = await receiveMakeContentResult(callback(jobId), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
      assert.deepEqual(await saved.json(), {
        ok: true,
        job_id: jobId,
        status: "generated",
        review: "ready",
        duplicate: false,
        published: false,
      });
      const job = await sql<{ status: string; awaiting_generation: boolean }>`
        select status, awaiting_generation from publishing_jobs where id = ${jobId}
      `;
      const result = await sql<{ caption: string }>`select caption from instagram_generation_results where job_id = ${jobId}`;
      const used = await sql<{ posts_used: number }>`select posts_used from client_subscriptions where client_id = ${clientId}`;
      assert.equal(job[0]?.status, "queued");
      assert.equal(job[0]?.awaiting_generation, false);
      assert.equal(result[0]?.caption, "Example Instagram caption");
      assert.equal(Number(used[0]?.posts_used), 0);
      assert.equal(recorder.notices.length, 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not open a second job once the photo quota is reserved", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const created = await createPhotoGenerationJob({
      sql,
      reference,
      connectSecret,
      contentType: "photo",
      today: "2026-10-22",
      dispatch: recorder.dispatch,
    });
    await sql`update subscription_periods set posts_quota = 1 where client_id = ${clientId}`;
    const jobId = (await created.json()).job_id as string;
    await receiveMakeContentResult(callback(jobId), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    const blocked = await createPhotoGenerationJob({
      sql,
      reference,
      connectSecret,
      contentType: "photo",
      today: "2026-10-25",
      dispatch: recorder.dispatch,
    });
    assert.equal((await blocked.json()).code, "quota");
    const jobs = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs`;
    const used = await sql<{ posts_used: number }>`select posts_used from client_subscriptions`;
    assert.equal(jobs[0]?.count, 1);
    assert.equal(Number(used[0]?.posts_used), 0);
    assert.equal(recorder.notices.length, 1);
  });

  it("rejects a video, a bad client secret, and leaves the onboarding webhook unchanged", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const video = await createPhotoGenerationJob({
      sql,
      reference,
      connectSecret,
      contentType: "video",
      dispatch: recorder.dispatch,
    });
    assert.equal((await video.json()).code, "invalid");
    const stranger = await createPhotoGenerationJob({
      sql,
      reference,
      connectSecret: "wrong-client-secret-000",
      contentType: "photo",
      dispatch: recorder.dispatch,
    });
    assert.equal(stranger.status, 401);
    const jobs = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs`;
    assert.equal(jobs[0]?.count, 0);
    assert.equal(recorder.notices.length, 0);
    const outbound = readFileSync(new URL("./make.server.ts", import.meta.url), "utf8");
    assert.match(outbound, /onboarding\.completed/);
    assert.doesNotMatch(outbound, /generation_requested|MAKE_CONTENT_WEBHOOK_URL/);
  });

  it("does not call Make again after a timeout and can close that slot without a new generation", async () => {
    const sql = await fixture();
    let calls = 0;
    const dispatch = async () => {
      calls += 1;
      return { status: "failed" as const, httpStatus: null, attempted: true };
    };
    const first = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch });
    const jobId = (await first.json()).job_id as string;
    const second = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch });
    assert.equal((await second.json()).job_id, jobId);
    assert.equal(calls, 1);
    const { reconcileFailedReservation } = await import("@/lib/integrations/quota-period");
    assert.equal(await reconcileFailedReservation(sql, clientId, jobId), "closed");
    const open = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where awaiting_generation is true`;
    assert.equal(open[0]?.count, 0);
    assert.equal(calls, 1);
  });

  it("blocks the second same-day trial photo, allows the next posting day, and keeps another client separate", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const first = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    const jobId = (await first.json()).job_id as string;
    await receiveMakeContentResult(callback(jobId), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    const sameDay = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    assert.equal((await sameDay.json()).code, "daily");
    const nextDay = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-25", dispatch: recorder.dispatch });
    assert.equal(nextDay.status, 200);
    const weekend = await createPhotoGenerationJob({
      sql: await fixture(),
      reference,
      connectSecret,
      contentType: "photo",
      today: "2026-10-23",
      dispatch: recorder.dispatch,
    });
    assert.equal((await weekend.json()).code, "weekend");
    const otherId = "22222222-2222-4222-8222-222222222222";
    await sql.query(
      "insert into clients (id, reference_code, approval_status, connect_secret_hash) values ($1, 'KV-OTHER1', 'approved', $2)",
      [otherId, sha256Hex("other-client-secret-0001")],
    );
    await sql.query(
      "insert into client_subscriptions (client_id, plan_code, status, posts_used, posts_quota) values ($1, 'trial', 'trial', 0, 22)",
      [otherId],
    );
    await sql.query("insert into social_accounts (client_id, platform, status) values ($1, 'instagram', 'connected')", [otherId]);
    const other = await createPhotoGenerationJob({
      sql,
      reference: "KV-OTHER1",
      connectSecret: "other-client-secret-0001",
      contentType: "photo",
      today: "2026-10-22",
      dispatch: recorder.dispatch,
    });
    assert.equal(other.status, 200);
    const own = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where client_id = ${clientId}`;
    const theirs = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where client_id = ${otherId}`;
    assert.equal(own[0]?.count, 2);
    assert.equal(theirs[0]?.count, 1);
  });

  it("runs two reservations as one job and opens a paid period only with a payment reference", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const [left, right] = await Promise.all([
      createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch }),
      createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch }),
    ]);
    const jobs = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs`;
    assert.equal(jobs[0]?.count, 1);
    assert.equal(recorder.notices.length, 1);
    assert.equal((await left.json()).ok && (await right.json()).ok, true);
    const { openPaidPeriod } = await import("@/lib/integrations/quota-period");
    assert.equal((await openPaidPeriod(sql, clientId, "nope", "2026-10-26")).ok, false);
    const paid = await openPaidPeriod(sql, clientId, "payment-ref-1", "2026-10-26");
    assert.equal(paid.ok, true);
    await sql`update publishing_jobs set awaiting_generation = false, status = 'failed' where client_id = ${clientId}`;
    await sql`delete from webhook_deliveries where client_id = ${clientId}`;
    const monthly = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-26", dispatch: recorder.dispatch });
    assert.equal(monthly.status, 200);
    const plan = await sql<{ plan_code: string; posts_quota: number }>`select plan_code, posts_quota::int as posts_quota from client_subscriptions where client_id = ${clientId}`;
    assert.equal(plan[0]?.plan_code, "monthly");
    assert.equal(Number(plan[0]?.posts_quota), 44);
  });

  it("refuses a request after the last posting day", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    await sql`update publishing_jobs set awaiting_generation = false, status = 'failed' where client_id = ${clientId}`;
    await sql`delete from webhook_deliveries`;
    const expired = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-11-23", dispatch: recorder.dispatch });
    assert.equal((await expired.json()).code, "expired");
  });

  it("does not open a new photo after the subscription is cancelled", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const first = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    const jobId = (await first.json()).job_id as string;
    await receiveMakeContentResult(callback(jobId), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    await sql`update client_subscriptions set status = 'cancelled' where client_id = ${clientId}`;
    const blocked = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-25", dispatch: recorder.dispatch });
    assert.equal((await blocked.json()).code, "not_entitled");
    const jobs = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs`;
    assert.equal(jobs[0]?.count, 1);
    assert.equal(recorder.notices.length, 1);
  });
});
