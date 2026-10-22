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
  await db.exec(readFileSync(new URL("../../../docs/sql/1006_period_ownership_and_payments.sql", import.meta.url), "utf8"));
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

const adminId = "admin-user-1";

function hideDispatchColumn(inner: Sql): Sql {
  const wrap = (sql: Sql): Sql => {
    const tagged = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("").includes("dispatch_state")) {
        throw Object.assign(new Error("undefined_column"), { code: "42703" });
      }
      return sql(strings, ...values);
    }) as Sql;
    tagged.query = sql.query.bind(sql);
    tagged.transaction = (run) => sql.transaction((tx) => run(wrap(tx)));
    return tagged;
  };
  return wrap(inner);
}

function payment(paymentId = "payment-ref-1", amountIls = 600, currency = "ILS") {
  return {
    paymentId,
    amountIls,
    currency,
    source: "admin_attestation" as const,
    confirmedBy: adminId,
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
    const blocked = await reconcileFailedReservation(sql, clientId, jobId, {
      actorId: adminId,
      reason: "timeout may have spent",
      acknowledgeSpendRisk: false,
    });
    assert.equal(blocked.outcome, "spend_unknown");
    assert.equal(blocked.spendWarning, true);
    const closed = await reconcileFailedReservation(sql, clientId, jobId, {
      actorId: adminId,
      reason: "operator accepts the spend risk",
      acknowledgeSpendRisk: true,
    });
    assert.equal(closed.outcome, "pending_decision");
    assert.equal(closed.spendWarning, true);
    const again = await reconcileFailedReservation(sql, clientId, jobId, {
      actorId: adminId,
      reason: "operator accepts the spend risk",
      acknowledgeSpendRisk: true,
    });
    assert.equal(again.outcome, "pending_decision");
    const audit = await sql<{ prior_state: string; actor_id: string; spend_warning: boolean; outcome: string }>`
      select prior_state, actor_id, spend_warning, outcome from quota_reconciliations where job_id = ${jobId}
    `;
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.prior_state, "attempted_unknown");
    assert.equal(audit[0]?.actor_id, adminId);
    assert.equal(audit[0]?.spend_warning, true);
    assert.equal(audit[0]?.outcome, "pending_decision");
    const open = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where awaiting_generation is true`;
    assert.equal(open[0]?.count, 1);
    const third = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch });
    assert.equal((await third.json()).job_id, jobId);
    const late = await receiveMakeContentResult(callback(jobId), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    assert.equal(late.status, 200);
    const stored = await sql<{ subscription_period_id: string | null }>`select subscription_period_id from instagram_generation_results where job_id = ${jobId}`;
    assert.ok(stored[0]?.subscription_period_id);
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
    assert.equal((await openPaidPeriod(sql, clientId, payment("nope"), "2026-10-26")).ok, false);
    assert.equal((await openPaidPeriod(sql, clientId, payment("payment-ref-1", 100), "2026-10-26")).ok, false);
    assert.equal((await openPaidPeriod(sql, clientId, payment("payment-ref-1", 600, "USD"), "2026-10-26")).ok, false);
    assert.equal((await openPaidPeriod(sql, clientId, { ...payment(), confirmedBy: "" }, "2026-10-26")).ok, false);
    const paid = await openPaidPeriod(sql, clientId, payment(), "2026-10-26");
    assert.equal(paid.ok, true);
    const again = await openPaidPeriod(sql, clientId, payment(), "2026-10-27");
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.duplicate, true);
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

  it("releases a slot when Make is not contacted and does not retry after a crash", async () => {
    const sql = await fixture();
    const previous = process.env.MAKE_CONTENT_WEBHOOK_URL;
    delete process.env.MAKE_CONTENT_WEBHOOK_URL;
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("external call");
    }) as typeof fetch;
    try {
      const skipped = await createPhotoGenerationJob({
        sql,
        reference,
        connectSecret,
        contentType: "photo",
        today: "2026-10-22",
      });
      assert.equal((await skipped.json()).dispatch_state, "never_attempted");
      assert.equal(fetches, 0);
      const waiting = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where awaiting_generation is true`;
      assert.equal(waiting[0]?.count, 0);
    } finally {
      globalThis.fetch = original;
      if (previous === undefined) delete process.env.MAKE_CONTENT_WEBHOOK_URL;
      else process.env.MAKE_CONTENT_WEBHOOK_URL = previous;
    }
    let calls = 0;
    const dispatch = async () => {
      calls += 1;
      throw new Error("worker died after the claim");
    };
    const first = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-25", dispatch });
    assert.equal((await first.json()).dispatch_state, "attempted_unknown");
    const second = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-25", dispatch });
    assert.equal((await second.json()).duplicate, true);
    assert.equal(calls, 1);
    const open = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where awaiting_generation is true`;
    assert.equal(open[0]?.count, 1);
  });

  it("blocks the 23rd trial photo, a second free period, and keeps a late callback on the old period", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const { openPaidPeriod, readQuotaView } = await import("@/lib/integrations/quota-period");
    const created = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    const jobId = (await created.json()).job_id as string;
    const trial = (await sql<{ id: string }>`select id from subscription_periods where client_id = ${clientId} and plan_code = 'trial'`)[0];
    assert.ok(trial);
    const paid = await openPaidPeriod(sql, clientId, payment("payment-ref-9"), "2026-11-02");
    assert.equal(paid.ok, true);
    const late = await receiveMakeContentResult(callback(jobId), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    assert.equal(late.status, 200);
    const owned = await sql<{ subscription_period_id: string }>`select subscription_period_id from instagram_generation_results where job_id = ${jobId}`;
    assert.equal(owned[0]?.subscription_period_id, trial.id);
    const reserved = await sql<{ count: number }>`
      select count(*)::int as count from publishing_jobs
      where subscription_period_id = ${trial.id} and awaiting_generation is true
    `;
    assert.equal(Number(reserved[0]?.count), 0);
    const fresh = await sql<{ id: string }>`select id from subscription_periods where client_id = ${clientId} and plan_code = 'monthly'`;
    const newRows = await sql<{ count: number }>`select count(*)::int as count from instagram_generation_results where subscription_period_id = ${fresh[0]?.id ?? ""}`;
    assert.equal(Number(newRows[0]?.count), 0);
    const view = await readQuotaView(sql, clientId, "2026-11-02");
    assert.equal(view.consumed, 0);
    assert.equal(view.reserved, 0);
    for (let index = 0; index < 21; index += 1) {
      const id = crypto.randomUUID();
      await sql.query(
        "insert into publishing_jobs (id, client_id, platform, status, awaiting_generation, created_at, subscription_period_id) values ($1, $2, 'instagram', 'failed', false, '2026-10-22T12:00:00Z', $3)",
        [id, clientId, trial.id],
      );
      await sql.query(
        "insert into instagram_generation_results (job_id, client_id, platform, content_type, caption, image_url, status, created_at, subscription_period_id) values ($1, $2, 'instagram', 'photo', $3, 'https://cdn.example.com/p.jpg', 'generated', '2026-10-22T12:00:00Z', $4)",
        [id, clientId, `Stored caption ${index}`, trial.id],
      );
    }
    const trialRows = await sql<{ count: number }>`select count(*)::int as count from instagram_generation_results where subscription_period_id = ${trial.id}`;
    assert.equal(Number(trialRows[0]?.count), 22);
    await sql`update client_subscriptions set plan_code = 'trial', status = 'trial', posts_quota = 22 where client_id = ${clientId}`;
    await sql`update subscription_periods set status = 'cancelled' where client_id = ${clientId} and plan_code = 'monthly'`;
    const secondTrial = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-11-03", dispatch: recorder.dispatch });
    assert.equal((await secondTrial.json()).code, "expired");
    const history = await sql<{ status: string }>`select status from subscription_periods where id = ${trial.id}`;
    assert.equal(history[0]?.status, "cancelled");
    const still = await sql<{ count: number }>`select count(*)::int as count from instagram_generation_results where client_id = ${clientId}`;
    assert.equal(Number(still[0]?.count), 22);
  });

  it("blocks the 23rd free photo", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const created = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    assert.equal(created.status, 200);
    const trial = (await sql<{ id: string }>`select id from subscription_periods where client_id = ${clientId}`)[0];
    await sql`update publishing_jobs set awaiting_generation = false, status = 'failed' where client_id = ${clientId}`;
    await sql`delete from webhook_deliveries where client_id = ${clientId}`;
    for (let index = 0; index < 22; index += 1) {
      const id = crypto.randomUUID();
      await sql.query(
        "insert into publishing_jobs (id, client_id, platform, status, awaiting_generation, created_at, subscription_period_id) values ($1, $2, 'instagram', 'failed', false, '2026-10-22T12:00:00Z', $3)",
        [id, clientId, trial?.id],
      );
      await sql.query(
        "insert into instagram_generation_results (job_id, client_id, platform, content_type, caption, image_url, status, created_at, subscription_period_id) values ($1, $2, 'instagram', 'photo', $3, 'https://cdn.example.com/p.jpg', 'generated', '2026-10-22T12:00:00Z', $4)",
        [id, clientId, `Free caption ${index}`, trial?.id],
      );
    }
    const blocked = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-26", dispatch: recorder.dispatch });
    assert.equal((await blocked.json()).code, "quota");
    assert.equal(recorder.notices.length, 1);
  });

  it("blocks the third paid photo in one day and the 45th paid photo", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const { openPaidPeriod } = await import("@/lib/integrations/quota-period");
    const paid = await openPaidPeriod(sql, clientId, payment("payment-ref-8"), "2026-10-26");
    assert.equal(paid.ok, true);
    if (!paid.ok) return;
    const first = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-26", dispatch: recorder.dispatch });
    await receiveMakeContentResult(callback((await first.json()).job_id), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    const second = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-26", dispatch: recorder.dispatch });
    await receiveMakeContentResult(callback((await second.json()).job_id), sql, { MAKE_CONTENT_RESULT_SECRET: callbackSecret });
    const third = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-26", dispatch: recorder.dispatch });
    assert.equal((await third.json()).code, "daily");
    for (let index = 0; index < 42; index += 1) {
      const id = crypto.randomUUID();
      await sql.query(
        "insert into publishing_jobs (id, client_id, platform, status, awaiting_generation, created_at, subscription_period_id) values ($1, $2, 'instagram', 'failed', false, '2026-10-27T12:00:00Z', $3)",
        [id, clientId, paid.periodId],
      );
      await sql.query(
        "insert into instagram_generation_results (job_id, client_id, platform, content_type, caption, image_url, status, created_at, subscription_period_id) values ($1, $2, 'instagram', 'photo', $3, 'https://cdn.example.com/p.jpg', 'generated', '2026-10-27T12:00:00Z', $4)",
        [id, clientId, `Paid caption ${index}`, paid.periodId],
      );
    }
    const fortyFifth = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-27", dispatch: recorder.dispatch });
    assert.equal((await fortyFifth.json()).code, "quota");
    assert.equal(recorder.notices.length, 2);
  });

  it("does not let a client field or a status edit prove payment, and reviews do not publish", async () => {
    const admin = readFileSync(new URL("../admin.functions.ts", import.meta.url), "utf8");
    const paidFn = admin.slice(admin.indexOf("export const confirmPaidPeriod"), admin.indexOf("export const reconcilePhotoReservation"));
    const ops = admin.slice(admin.indexOf("async function socialsFor"), admin.indexOf("export const confirmPaidPeriod"));
    assert.match(paidFn, /requireAdmin\(context\.userId\)/);
    assert.match(paidFn, /confirmedBy: context\.userId/);
    assert.doesNotMatch(paidFn, /body\.confirmedBy|confirmedBy: data/);
    assert.doesNotMatch(ops, /openPaidPeriod|payment_confirmations|subscription_periods/);
    const reviews = readFileSync(new URL("./photo-review.server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(reviews, /media_publish|graph\.facebook|MAKE_CONTENT_WEBHOOK_URL/);
    const sql = await fixture();
    await sql`update client_subscriptions set status = 'active' where client_id = ${clientId}`;
    const periods = await sql<{ count: number }>`select count(*)::int as count from subscription_periods where plan_code = 'monthly'`;
    assert.equal(Number(periods[0]?.count), 0);
    const recorder = dispatchRecorder();
    const blocked = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    assert.equal((await blocked.json()).code, "not_entitled");
    assert.equal(recorder.notices.length, 0);
  });

  it("keeps a second payment without replacing the open paid period", async () => {
    const sql = await fixture();
    const { openPaidPeriod } = await import("@/lib/integrations/quota-period");
    const { jerusalemToday } = await import("@/lib/integrations/quota-period");
    const winter = jerusalemToday(new Date("2026-01-15T22:30:00Z"));
    const summer = jerusalemToday(new Date("2026-07-15T21:30:00Z"));
    assert.equal(winter, "2026-01-16");
    assert.equal(summer, "2026-07-16");
    const first = await openPaidPeriod(sql, clientId, payment("payment-ref-paid-1"), "2026-10-26");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await openPaidPeriod(sql, clientId, payment("payment-ref-paid-2"), "2026-10-27");
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "renewal_blocked");
    const repeat = await openPaidPeriod(sql, clientId, payment("payment-ref-paid-2"), "2026-10-28");
    assert.equal(repeat.ok, false);
    if (repeat.ok) return;
    assert.equal(repeat.code, "renewal_blocked");
    const periods = await sql<{ id: string; status: string; period_last: string }>`
      select id, status, period_last::text as period_last from subscription_periods where client_id = ${clientId} and plan_code = 'monthly'
    `;
    assert.equal(periods.length, 1);
    assert.equal(periods[0]?.id, first.periodId);
    assert.equal(periods[0]?.status, "active");
    const payments = await sql<{ payment_id: string; period_id: string | null }>`
      select payment_id, period_id from payment_confirmations where client_id = ${clientId} order by payment_id
    `;
    assert.equal(payments.length, 2);
    assert.equal(payments.find((row) => row.payment_id === "payment-ref-paid-2")?.period_id, null);
    const otherId = "22222222-2222-4222-8222-222222222222";
    await sql.query(
      "insert into clients (id, reference_code, approval_status, connect_secret_hash) values ($1, 'KV-PAYER', 'approved', $2)",
      [otherId, sha256Hex("other-client-secret-0001")],
    );
    await sql.query(
      "insert into client_subscriptions (client_id, plan_code, status, posts_used, posts_quota) values ($1, 'trial', 'trial', 0, 22)",
      [otherId],
    );
    const other = await openPaidPeriod(sql, otherId, payment("payment-ref-paid-1"), "2026-10-26");
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.code, "conflict");
    const stolen = await sql<{ count: number }>`select count(*)::int as count from subscription_periods where client_id = ${otherId}`;
    assert.equal(Number(stolen[0]?.count), 0);
  });

  it("does not resend a legacy job and does not release its quota", async () => {
    const sql = await fixture();
    const recorder = dispatchRecorder();
    const legacyId = "33333333-3333-4333-8333-333333333333";
    await sql.query(
      "insert into publishing_jobs (id, client_id, platform, status, awaiting_generation, created_at, subscription_period_id) values ($1, $2, 'instagram', 'queued', true, '2026-10-22T12:00:00Z', null)",
      [legacyId, clientId],
    );
    const held = await createPhotoGenerationJob({ sql, reference, connectSecret, contentType: "photo", today: "2026-10-22", dispatch: recorder.dispatch });
    const heldBody = await held.json();
    assert.equal(heldBody.job_id, legacyId);
    assert.equal(heldBody.dispatch_state, null);
    assert.equal(recorder.notices.length, 0);
    const { reconcileFailedReservation } = await import("@/lib/integrations/quota-period");
    const legacy = await reconcileFailedReservation(sql, clientId, legacyId, {
      actorId: adminId,
      reason: "old row without a period",
      acknowledgeSpendRisk: true,
    });
    assert.equal(legacy.outcome, "legacy_unclassified");
    const still = await sql<{ awaiting_generation: boolean }>`select awaiting_generation from publishing_jobs where id = ${legacyId}`;
    assert.equal(still[0]?.awaiting_generation, true);
    const friday = await fixture();
    const fridayCall = await createPhotoGenerationJob({
      sql: friday,
      reference,
      connectSecret,
      contentType: "photo",
      today: "2026-10-23",
      dispatch: recorder.dispatch,
    });
    assert.equal((await fridayCall.json()).code, "weekend");
    const opened = await friday<{ count: number }>`select count(*)::int as count from subscription_periods`;
    assert.equal(Number(opened[0]?.count), 0);
  });

  it("drops an unsent reservation when the dispatch column is missing and does not call Make", async () => {
    const sql = await fixture();
    const wrapped = hideDispatchColumn(sql);
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("external call");
    }) as typeof fetch;
    try {
      const response = await createPhotoGenerationJob({
        sql: wrapped,
        reference,
        connectSecret,
        contentType: "photo",
        today: "2026-10-22",
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "schema_unavailable");
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = original;
    }
    const waiting = await sql<{ count: number }>`select count(*)::int as count from publishing_jobs where awaiting_generation is true`;
    assert.equal(Number(waiting[0]?.count), 0);
    const deliveries = await sql<{ count: number }>`select count(*)::int as count from webhook_deliveries`;
    assert.equal(Number(deliveries[0]?.count), 0);
  });
});
