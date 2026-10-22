import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";
import {
  authorizeConnectClient,
  decidePhotoReview,
  listPhotoReviews,
  reviewForActor,
  savePhotoCaption,
} from "@/lib/integrations/photo-review.server";
import { sha256Hex } from "@/lib/oauth/meta-guards";

const clientA = "11111111-1111-4111-8111-111111111111";
const clientB = "33333333-3333-4333-8333-333333333333";
const jobA = "22222222-2222-4222-8222-222222222222";
const jobB = "44444444-4444-4444-8444-444444444444";
const secretA = "client-connect-secret-aaaa";
const image = "https://cdn.example.com/generated-photo.jpg";

function memorySql(db: PGlite): Sql {
  const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await db.query(text, params)).rows as T[];
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((queryText, part, index) => queryText + part + (index < values.length ? `$${index + 1}` : ""), "");
    return query<T>(text, values);
  }) as Sql;
  sql.query = query;
  return sql;
}

async function fixture(): Promise<Sql> {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      connect_secret_hash text
    );
    create table publishing_jobs (
      id text primary key,
      client_id text not null,
      status text not null
    );
  `);
  const root = new URL("../../../migrations/", import.meta.url);
  await db.exec(readFileSync(new URL("1002_instagram_generation_results.sql", root), "utf8"));
  await db.exec(readFileSync(new URL("1004_instagram_generation_review.sql", root), "utf8"));
  await db.query(
    "insert into clients (id, reference_code, connect_secret_hash) values ($1, 'KV-PHOTO1', $2), ($3, 'KV-OTHER1', $4)",
    [clientA, sha256Hex(secretA), clientB, sha256Hex("other-client-secret-0000")],
  );
  await db.query(
    "insert into publishing_jobs (id, client_id, status) values ($1, $2, 'queued'), ($3, $4, 'queued')",
    [jobA, clientA, jobB, clientB],
  );
  await db.query(
    `insert into instagram_generation_results
      (job_id, client_id, platform, content_type, caption, image_url, status, review_status, created_at)
     values ($1, $2, 'instagram', 'photo', 'Original caption', $3, 'generated', 'pending', '2026-10-21T12:00:00Z'),
            ($4, $5, 'instagram', 'photo', 'Other caption', $3, 'generated', 'pending', '2026-10-21T12:05:00Z')`,
    [jobA, clientA, image, jobB, clientB],
  );
  return memorySql(db);
}

describe("photo review", () => {
  it("lets a client edit and approve only their own photo, without publishing", async () => {
    const sql = await fixture();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("external call");
    }) as typeof fetch;
    try {
      const client = await authorizeConnectClient(sql, "KV-PHOTO1", secretA);
      assert.equal(client?.id, clientA);
      assert.equal(await authorizeConnectClient(sql, "KV-PHOTO1", "wrong-client-secret-000"), null);
      const listed = await listPhotoReviews(sql, clientA);
      assert.ok(Array.isArray(listed));
      if (!Array.isArray(listed)) return;
      assert.deepEqual(listed.map((item) => item.jobId), [jobA]);
      assert.equal(listed[0]?.reviewStatus, "pending");
      assert.equal(listed[0]?.generationStatus, "generated");
      assert.equal(listed[0]?.imageUrl, image);
      assert.match(listed[0]?.createdAt ?? "", /2026-10-21/);

      const edited = await savePhotoCaption(sql, clientA, jobA, "Updated caption");
      assert.equal(edited.ok && edited.item.caption, "Updated caption");
      const stranger = await savePhotoCaption(sql, clientA, jobB, "Stolen caption");
      assert.equal(stranger.ok, false);
      if (!stranger.ok) assert.equal(stranger.code, "not_found");
      const other = await sql<{ caption: string }>`select caption from instagram_generation_results where job_id = ${jobB}`;
      assert.equal(other[0]?.caption, "Other caption");

      const approved = await decidePhotoReview(sql, clientA, jobA, "approved");
      assert.equal(approved.ok && approved.item.reviewStatus, "approved");
      assert.equal(approved.ok && approved.published, false);
      const again = await decidePhotoReview(sql, clientA, jobA, "approved");
      assert.equal(again.ok && again.unchanged, true);
      const locked = await savePhotoCaption(sql, clientA, jobA, "Too late");
      assert.equal(locked.ok, false);
      if (!locked.ok) assert.equal(locked.code, "locked");
      const kept = await sql<{ caption: string; review_status: string }>`
        select caption, review_status from instagram_generation_results where job_id = ${jobA}
      `;
      const job = await sql<{ status: string }>`select status from publishing_jobs where id = ${jobA}`;
      assert.equal(kept[0]?.caption, "Updated caption");
      assert.equal(kept[0]?.review_status, "approved");
      assert.equal(job[0]?.status, "queued");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects a generated photo and blocks a non-admin from changing it", async () => {
    const sql = await fixture();
    const rejected = await decidePhotoReview(sql, clientB, jobB, "rejected");
    assert.equal(rejected.ok && rejected.item.reviewStatus, "rejected");
    const flip = await decidePhotoReview(sql, clientB, jobB, "approved");
    assert.equal(flip.ok, false);
    if (!flip.ok) assert.equal(flip.code, "conflict");
    const denied = await reviewForActor(sql, { role: "admin", isAdmin: false, clientId: clientA }, {
      type: "decision",
      jobId: jobA,
      decision: "approved",
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "forbidden");
    const untouched = await sql<{ review_status: string }>`select review_status from instagram_generation_results where job_id = ${jobA}`;
    assert.equal(untouched[0]?.review_status, "pending");
    const source = readFileSync(new URL("./photo-review.server.ts", import.meta.url), "utf8");
    const wizard = readFileSync(new URL("../../components/onboarding-wizard.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /notifyMake|media_publish|publishing_jobs/);
    assert.doesNotMatch(wizard, /photo-review|reviews\.title/);
  });
});
