import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";
import { MANUAL_CONFIRMATION, normalizePublicJpegUrl } from "./instagram-manual-publish.ts";
import { ManualGraphPostError, manualTokenHash, type ManualPublishView } from "./instagram-manual-publish.server.ts";

const source = readFileSync(fileURLToPath(new URL("./instagram-manual-publish.server.ts", import.meta.url)), "utf8");
const handler = readFileSync(fileURLToPath(new URL("./instagram-manual-publish.functions.ts", import.meta.url)), "utf8");
const migration = readFileSync(fileURLToPath(new URL("../../migrations/1001_instagram_manual_publications.sql", import.meta.url)), "utf8");
const ui = readFileSync(fileURLToPath(new URL("../components/instagram-manual-publish.tsx", import.meta.url)), "utf8");

const clientId = "11111111-1111-4111-8111-111111111111";
const accountId = "17841400000000021";
const ciphertext = "ciphertext-v1";
const token = "secret-token";
const imageUrl = "https://cdn.example.com/photo.jpg";
const caption = "KLYVONA manual photo";

function memorySql(db: PGlite): Sql {
  const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
    const result = await db.query(text, params);
    return result.rows as T[];
  };
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((queryText, part, index) => queryText + part + (index < values.length ? `$${index + 1}` : ""), "");
    return query<T>(text, values);
  }) as Sql;
  sql.query = query;
  return sql;
}

async function database() {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      approval_status text not null,
      created_at timestamptz not null default now()
    );
    create table client_subscriptions (client_id text primary key, status text not null);
    create table social_accounts (
      id text primary key,
      client_id text not null,
      platform text not null,
      status text not null,
      external_account_id text,
      token_ciphertext text,
      publish_permission text,
      publish_permission_token_hash text
    );
    create table publishing_jobs (
      id text primary key,
      client_id text not null,
      status text not null,
      error_message text
    );
    create table instagram_test_publications (
      client_id text primary key,
      status text not null,
      container_id text
    );
    create table instagram_test_publication_attempts (
      id text primary key,
      client_id text not null,
      status text not null
    );
  `);
  await db.exec(migration);
  const sql = memorySql(db);
  const hash = manualTokenHash(ciphertext);
  await sql`
    insert into clients (id, reference_code, approval_status)
    values (${clientId}, 'KV-CLIENT', 'approved')
  `;
  await sql`insert into client_subscriptions (client_id, status) values (${clientId}, 'active')`;
  await sql`
    insert into social_accounts (
      id, client_id, platform, status, external_account_id, token_ciphertext,
      publish_permission, publish_permission_token_hash
    ) values (
      'social-1', ${clientId}, 'instagram', 'connected', ${accountId},
      ${ciphertext}, 'confirmed', ${hash}
    )
  `;
  await sql.query(
    "insert into " + "publishing_jobs (id, client_id, status, error_message) values ($1, $2, $3, $4)",
    ["job-1", clientId, "queued", null],
  );
  await sql`
    insert into instagram_test_publications (client_id, status, container_id)
    values (${clientId}, 'uncertain', '17841499900000001')
  `;
  await sql`
    insert into instagram_test_publication_attempts (id, client_id, status)
    values ('second-1', ${clientId}, 'uncertain')
  `;
  return sql;
}

function callsOf(calls: string[]) {
  return {
    post: async (path: string) => {
      calls.push(path);
      if (path.endsWith("/media_publish")) return { id: "17841499900000111" };
      if (path.endsWith("/media")) return { id: "17841499900000099" };
      throw new Error("unexpected path");
    },
    wait: async () => {},
    permalink: async () => "https://www.instagram.com/p/Cmanual/",
  };
}

async function publish(sql: Sql, key: string, overrides: Record<string, unknown> = {}): Promise<{ result: ManualPublishView; calls: string[] }> {
  const { executeManualPublication } = await import("./instagram-manual-publish.server.ts");
  const calls: string[] = [];
  const graph = callsOf(calls);
  const result = await executeManualPublication({
    sql,
    adminUserId: "admin-1",
    clientId,
    confirmation: MANUAL_CONFIRMATION,
    idempotencyKey: key,
    imageUrl,
    caption,
    externalAccountId: accountId,
    token,
    tokenCiphertext: ciphertext,
    imageAvailable: async () => true,
    post: graph.post,
    waitUntilFinished: graph.wait,
    readPermalink: graph.permalink,
    ...overrides,
  });
  return { result, calls };
}

async function untouched(sql: Sql) {
  const job = await sql<{ status: string }>`select status from publishing_jobs where id = 'job-1'`;
  const first = await sql<{ status: string; container_id: string }>`select status, container_id from instagram_test_publications`;
  const second = await sql<{ status: string }>`select status from instagram_test_publication_attempts`;
  assert.equal(job[0]?.status, "queued");
  assert.equal(first[0]?.status, "uncertain");
  assert.equal(first[0]?.container_id, "17841499900000001");
  assert.equal(second[0]?.status, "uncertain");
}

describe("manual Instagram client publication", () => {
  it("keeps the new migration away from the locked tables and publishes only after the row is stored", () => {
    assert.match(migration, /create table if not exists instagram_manual_publications/);
    assert.match(migration, /idempotency_key text not null unique/);
    assert.match(migration, /instagram_manual_publications_one_open_idx/);
    const sqlOnly = migration.replace(/--.*$/gm, "");
    assert.doesNotMatch(sqlOnly, /instagram_test_publications|instagram_test_publication_attempts|publishing_jobs/);
    assert.doesNotMatch(source, /instagram_test_publications|instagram_test_publication_attempts|publishing_jobs|notifyMake/);
    assert.doesNotMatch(handler, /instagram_test_publications|instagram_test_publication_attempts|publishing_jobs|notifyMake/);
    const savedAt = source.indexOf('await advance("publish_requested")');
    const startedAt = source.indexOf("publishPostStarted = true");
    const publishAt = source.indexOf("await input.post(`${input.externalAccountId}/media_publish`");
    assert.ok(savedAt > 0 && startedAt > savedAt && publishAt > startedAt);
    assert.equal((source.match(/\/media_publish`/g) ?? []).length, 1);
    assert.equal(handler.indexOf("data.confirmation !== MANUAL_CONFIRMATION") < handler.indexOf("liveInstagramGraph.profile"), true);
    assert.match(handler, /resolveAdminAccess\(userId\)/);
    assert.match(handler, /instagramAccountEligible/);
    assert.match(handler, /publish_permission_token_hash/);
    const effect = ui.slice(ui.indexOf("useEffect(() =>"), ui.indexOf("function phaseText"));
    assert.doesNotMatch(effect, /publishInstagramManualPhoto/);
    assert.equal(ui.includes("onClick={() => void publish()}"), true);
    assert.match(ui, /MANUAL_CONFIRMATION/);
    assert.equal(normalizePublicJpegUrl("http://cdn.example.com/a.jpg"), null);
    assert.equal(normalizePublicJpegUrl("https://user:pass@cdn.example.com/a.jpg"), null);
    assert.equal(normalizePublicJpegUrl("https://127.0.0.1/a.jpg"), null);
    assert.equal(normalizePublicJpegUrl("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
  });

  it("publishes one mocked photo and leaves the older records unchanged", async () => {
    const sql = await database();
    const { result, calls } = await publish(sql, "22222222-2222-4222-8222-222222222222");
    assert.equal(result.ok, true);
    assert.equal(result.phase, "success");
    assert.equal(result.mediaId, "17841499900000111");
    assert.equal(result.permalink, "https://www.instagram.com/p/Cmanual/");
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 1);
    const stored = await sql<{ permalink: string; caption: string; image_url: string }>`
      select permalink, caption, image_url from instagram_manual_publications
    `;
    assert.equal(stored[0]?.permalink, "https://www.instagram.com/p/Cmanual/");
    assert.equal(JSON.stringify(stored).includes(token), false);
    await untouched(sql);
  });

  it("does not call media_publish again for the same confirmation", async () => {
    const sql = await database();
    const key = "22222222-2222-4222-8222-222222222222";
    const first = await publish(sql, key);
    const second = await publish(sql, key);
    assert.equal(second.result.ok, true);
    assert.equal(second.result.mediaId, first.result.mediaId);
    assert.equal(second.calls.length, 0);
    const rows = await sql<{ id: string }>`select id from instagram_manual_publications`;
    assert.equal(rows.length, 1);
  });

  it("blocks a new post after an uncertain media_publish and does not send it again", async () => {
    const sql = await database();
    const { executeManualPublication } = await import("./instagram-manual-publish.server.ts");
    const calls: string[] = [];
    const once = async (key: string) => executeManualPublication({
      sql,
      adminUserId: "admin-1",
      clientId,
      confirmation: MANUAL_CONFIRMATION,
      idempotencyKey: key,
      imageUrl,
      caption,
      externalAccountId: accountId,
      token,
      tokenCiphertext: ciphertext,
      imageAvailable: async () => true,
      waitUntilFinished: async () => {},
      post: async (path) => {
        calls.push(path);
        if (path.endsWith("/media")) return { id: "17841499900000099" };
        throw new ManualGraphPostError("meta_post_transport_unknown", false);
      },
    });
    const failed = await once("22222222-2222-4222-8222-222222222222");
    assert.equal(failed.phase, "error");
    assert.equal(failed.anotherPostAllowed, false);
    assert.equal(failed.code, "uncertain_check_instagram_no_retry");
    const replay = await once("22222222-2222-4222-8222-222222222222");
    const another = await once("33333333-3333-4333-8333-333333333333");
    assert.equal(replay.anotherPostAllowed, false);
    assert.equal(replay.phase, "error");
    assert.equal(another.code, "open_attempt_blocks_new_post");
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 1);
    await untouched(sql);
  });

  it("does not send media_publish when the pre-publish write fails, then allows a new explicit post", async () => {
    const sql = await database();
    const guarded = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("");
      if (text.includes("update instagram_manual_publications") && values[0] === "publish_requested") {
        throw new Error("db down");
      }
      return sql<T>(strings, ...values);
    }) as Sql;
    guarded.query = sql.query;
    const { executeManualPublication } = await import("./instagram-manual-publish.server.ts");
    const calls: string[] = [];
    let containers = 0;
    const run = (key: string, db: Sql) => executeManualPublication({
      sql: db,
      adminUserId: "admin-1",
      clientId,
      confirmation: MANUAL_CONFIRMATION,
      idempotencyKey: key,
      imageUrl,
      caption,
      externalAccountId: accountId,
      token,
      tokenCiphertext: ciphertext,
      imageAvailable: async () => true,
      waitUntilFinished: async () => {},
      post: async (path) => {
        calls.push(path);
        if (path.endsWith("/media_publish")) return { id: "17841499900000111" };
        containers += 1;
        return { id: containers === 1 ? "17841499900000099" : "17841499900000098" };
      },
    });
    const blocked = await run("22222222-2222-4222-8222-222222222222", guarded);
    assert.equal(calls.some((path) => path.endsWith("/media_publish")), false);
    assert.equal(blocked.phase, "error");
    const again = await run("33333333-3333-4333-8333-333333333333", sql);
    assert.equal(again.ok, true);
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 1);
  });

  it("refuses a missing confirmation, a closed gate, and an unavailable image without a graph call", async () => {
    const sql = await database();
    const no = await publish(sql, "22222222-2222-4222-8222-222222222222", { confirmation: "no" });
    assert.equal(no.calls.length, 0);
    assert.equal(no.result.code, "confirmation_required");
    await sql`update clients set approval_status = 'pending_approval' where id = ${clientId}`;
    const gated = await publish(sql, "33333333-3333-4333-8333-333333333333");
    assert.equal(gated.result.code, "not_ready");
    assert.equal(gated.calls.length, 0);
    await sql`update clients set approval_status = 'approved' where id = ${clientId}`;
    const missingImage = await publish(sql, "44444444-4444-4444-8444-444444444444", { imageAvailable: async () => false });
    assert.equal(missingImage.result.code, "image_unavailable");
    assert.equal(missingImage.calls.length, 0);
    const rows = await sql<{ id: string }>`select id from instagram_manual_publications`;
    assert.equal(rows.length, 0);
  });
});
