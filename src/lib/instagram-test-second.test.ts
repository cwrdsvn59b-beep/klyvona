import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";

(globalThis as { __pgBootstrapPromise__?: Promise<void> }).__pgBootstrapPromise__ = Promise.resolve();

const hash = createHash("sha256").update("ciphertext-v1").digest("hex");

const source = readFileSync(fileURLToPath(new URL("./instagram-test-second.functions.ts", import.meta.url)), "utf8");
const migration = readFileSync(fileURLToPath(new URL("../../migrations/1000_instagram_test_publication_attempts.sql", import.meta.url)), "utf8");
const firstMigration = readFileSync(fileURLToPath(new URL("../../migrations/999_instagram_test_publications.sql", import.meta.url)), "utf8");

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

const input = {
  clientId: "client-1",
  reference: "KV-EKBXGL",
  adminUserId: "admin-1",
  externalAccountId: "17841400000000021",
  tokenCiphertext: "ciphertext-v1",
  tokenHash: hash,
};

async function database() {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      approval_status text not null
    );
    create table client_subscriptions (
      client_id text primary key,
      status text not null
    );
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
  `);
  await db.exec(firstMigration);
  await db.exec(migration);
  const sql = memorySql(db);
  await sql`
    insert into clients (id, reference_code, approval_status)
    values (${input.clientId}, ${input.reference}, 'approved')
  `;
  await sql`insert into client_subscriptions (client_id, status) values (${input.clientId}, 'active')`;
  await sql`
    insert into social_accounts (
      id, client_id, platform, status, external_account_id, token_ciphertext,
      publish_permission, publish_permission_token_hash
    ) values (
      'social-1', ${input.clientId}, 'instagram', 'connected', ${input.externalAccountId},
      ${input.tokenCiphertext}, 'confirmed', ${input.tokenHash}
    )
  `;
  await sql`
    insert into instagram_test_publications (
      id, client_id, admin_user_id, instagram_account_id, token_hash, status, container_id, error_code
    ) values (
      'first-attempt', ${input.clientId}, 'admin-0', ${input.externalAccountId},
      ${input.tokenHash}, 'uncertain', '17841499900000001', 'publish_result_unknown'
    )
  `;
  return sql;
}

async function originalAttempt(sql: Sql) {
  const rows = await sql<{ status: string; container_id: string | null; error_code: string | null }>`
    select status, container_id, error_code from instagram_test_publications where client_id = ${input.clientId}
  `;
  return rows[0];
}

describe("second Instagram test publication", () => {
  it("keeps the first migration and the second reservation free of writes to the original table", () => {
    assert.doesNotMatch(migration, /update\s+instagram_test_publications|delete\s+from\s+instagram_test_publications|drop\s+table\s+instagram_test_publications/i);
    assert.match(migration, /instagram_test_publication_attempts/);
    assert.match(migration, /client_id text not null unique/);
    assert.match(migration, /instagram_account_id text not null unique/);
    assert.match(migration, /reused_instagram_test_container/);
    assert.doesNotMatch(source, /update\s+instagram_test_publications|delete\s+from\s+instagram_test_publications/i);
    assert.match(source, /PUBLISH KV-EKBXGL 2/);
    assert.match(source, /confirmation !== SECOND_CONFIRMATION/);
    assert.match(source, /resolveAdminAccess\(userId\)/);
    assert.match(source, /sa\.publish_permission = 'confirmed'/);
    assert.match(source, /sa\.publish_permission_token_hash =/);
    assert.match(source, /first_attempt\.status = 'uncertain'/);
    assert.match(source, /on conflict do nothing/);
    assert.match(source, /returning id/);
    assert.match(source, /updated\.length !== 1/);
    const readyAt = source.indexOf("await waitUntilFinished(containerId, input.token)");
    const savedAt = source.indexOf("await recordSecondAttempt(input.sql, input.attemptId, input.clientId, \"publish_requested\")");
    const publishAt = source.indexOf("await post(`${input.externalAccountId}/media_publish`");
    assert.ok(readyAt >= 0 && savedAt > readyAt && publishAt > savedAt);
    assert.ok(source.indexOf("publishPostStarted = true") > savedAt);
    assert.ok(source.indexOf("publishPostStarted = true") < publishAt);
    assert.match(source, /const definitelyNoPublish = !publishPostStarted && !containerUnknown/);
    const publishCalls = source.match(/\/media_publish`/g) ?? [];
    assert.equal(publishCalls.length, 1);
    assert.doesNotMatch(source, /while\s*\(|setInterval/);
  });

  it("rejects a missing, malformed, or previously stored container id", async () => {
    const { reusedTestContainer } = await import("./instagram-test-second.functions.ts");
    assert.equal(reusedTestContainer(["17841499900000001"], "17841499900000001"), true);
    assert.equal(reusedTestContainer(["17841499900000001"], "17841499900000002"), false);
    assert.equal(reusedTestContainer([null], "abc"), true);
  });

  it("reserves one second attempt and leaves the uncertain row unchanged", async () => {
    const { reserveSecondInstagramAttempt } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const before = await originalAttempt(sql);
    const reserved = await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    assert.equal(reserved?.id, "second-1");
    const again = await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-2" });
    assert.equal(again, null);
    const rows = await sql<{ id: string }>`select id from instagram_test_publication_attempts`;
    assert.deepEqual(rows.map((row) => row.id), ["second-1"]);
    assert.deepEqual(await originalAttempt(sql), before);
  });

  it("allows only one of two parallel reservations", async () => {
    const { reserveSecondInstagramAttempt } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const results = await Promise.all([
      reserveSecondInstagramAttempt(sql, { ...input, attemptId: "parallel-a" }),
      reserveSecondInstagramAttempt(sql, { ...input, attemptId: "parallel-b" }),
    ]);
    const ids = results.flatMap((row) => row ? [row.id] : []);
    assert.equal(ids.length, 1);
    const stored = await sql<{ id: string }>`select id from instagram_test_publication_attempts`;
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.id, ids[0]);
    const original = await originalAttempt(sql);
    assert.equal(original?.status, "uncertain");
    assert.equal(original?.container_id, "17841499900000001");
  });

  it("does not store the original container id on the second attempt", async () => {
    const { recordSecondAttempt, reserveSecondInstagramAttempt } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const reserved = await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    assert.ok(reserved);
    await assert.rejects(
      () => recordSecondAttempt(sql, "second-1", input.clientId, "container_created", { containerId: "17841499900000001" }),
      /reused_instagram_test_container/,
    );
    const second = await sql<{ container_id: string | null; status: string }>`
      select container_id, status from instagram_test_publication_attempts where id = 'second-1'
    `;
    assert.equal(second[0]?.container_id, null);
    assert.equal(second[0]?.status, "reserved");
    const original = await originalAttempt(sql);
    assert.equal(original?.status, "uncertain");
    assert.equal(original?.error_code, "publish_result_unknown");
  });

  it("does not continue to publish when the state update matches no row", async () => {
    const { recordSecondAttempt, reserveSecondInstagramAttempt } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const before = await originalAttempt(sql);
    await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    let published = false;
    await assert.rejects(async () => {
      await recordSecondAttempt(sql, "missing-attempt", input.clientId, "publish_requested");
      published = true;
    }, /second_attempt_state_not_persisted/);
    assert.equal(published, false);
    const second = await sql<{ status: string }>`select status from instagram_test_publication_attempts`;
    assert.equal(second[0]?.status, "reserved");
    assert.deepEqual(await originalAttempt(sql), before);
    const saved = await recordSecondAttempt(sql, "second-1", input.clientId, "publish_requested");
    assert.equal(saved, undefined);
    const after = await sql<{ status: string }>`select status from instagram_test_publication_attempts where id = 'second-1'`;
    assert.equal(after[0]?.status, "publish_requested");
    assert.equal((await originalAttempt(sql))?.status, "uncertain");
  });

  it("does not reserve when the Meta permission or token is missing", async () => {
    const { reserveSecondInstagramAttempt } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    await sql`update social_accounts set publish_permission = 'missing' where id = 'social-1'`;
    assert.equal(await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "no-permission" }), null);
    await sql`
      update social_accounts
      set publish_permission = 'confirmed', token_ciphertext = null
      where id = 'social-1'
    `;
    assert.equal(await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "no-token" }), null);
    await sql`
      update social_accounts
      set token_ciphertext = ${input.tokenCiphertext}, publish_permission_token_hash = 'wrong-hash'
      where id = 'social-1'
    `;
    assert.equal(await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "wrong-hash" }), null);
    const attempts = await sql<{ id: string }>`select id from instagram_test_publication_attempts`;
    assert.equal(attempts.length, 0);
    const original = await originalAttempt(sql);
    assert.equal(original?.status, "uncertain");
    assert.equal(original?.container_id, "17841499900000001");
  });

  it("keeps an unknown Meta result and a failed database write from starting another publish", () => {
    assert.match(source, /meta_post_transport_unknown/);
    assert.match(source, /publish_result_unknown/);
    assert.match(source, /database_persist_failed_after_meta_success/);
    assert.match(source, /published_but_database_confirmation_failed_no_retry/);
    assert.match(source, /uncertain_check_instagram_no_retry/);
    const errorStore = source.slice(source.indexOf("const safeCode"), source.indexOf("const definitelyNoPublish"));
    assert.equal(errorStore.includes("userToken"), false);
    assert.equal(errorStore.includes("access_token"), false);
  });

  it("does not call media_publish when Neon refuses the pre-publish write", async () => {
    const { reserveSecondInstagramAttempt, runReservedSecondPublish } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const before = await originalAttempt(sql);
    await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    const calls: string[] = [];
    const refusing = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update instagram_test_publication_attempts") && values[0] === "publish_requested") {
        throw new Error("neon_write_refused");
      }
      return sql<T>(strings, ...values);
    }) as Sql;
    refusing.query = sql.query;
    const result = await runReservedSecondPublish({
      sql: refusing,
      attemptId: "second-1",
      clientId: input.clientId,
      externalAccountId: input.externalAccountId,
      token: "not-a-live-token",
      imageUrl: "https://example.test/klyvona.jpg",
      caption: "test",
      waitUntilFinished: async () => {},
      post: async (path) => {
        calls.push(path);
        if (path.endsWith("/media_publish")) throw new Error("publish must not be sent");
        return { id: "17841499900000099" };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "no_publish_request_sent_locked");
    assert.equal(calls.some((path) => path.endsWith("/media_publish")), false);
    const second = await sql<{ status: string; error_code: string | null }>`
      select status, error_code from instagram_test_publication_attempts where id = 'second-1'
    `;
    assert.equal(second[0]?.status, "failed_before_request");
    assert.equal(second[0]?.error_code, "internal_error_before_publish");
    assert.notEqual(second[0]?.error_code, "publish_result_unknown");
    assert.deepEqual(await originalAttempt(sql), before);
  });

  it("stores an unknown media_publish result once and does not send it again", async () => {
    const { InstagramGraphPostError, reserveSecondInstagramAttempt, runReservedSecondPublish } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const before = await originalAttempt(sql);
    await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    const calls: string[] = [];
    const post = async (path: string) => {
      calls.push(path);
      if (path.endsWith("/media_publish")) throw new InstagramGraphPostError("meta_post_transport_unknown", false);
      return { id: "17841499900000099" };
    };
    const result = await runReservedSecondPublish({
      sql,
      attemptId: "second-1",
      clientId: input.clientId,
      externalAccountId: input.externalAccountId,
      token: "not-a-live-token",
      imageUrl: "https://example.test/klyvona.jpg",
      caption: "test",
      waitUntilFinished: async () => {},
      post,
    });
    assert.deepEqual(result, { ok: false, code: "uncertain_check_instagram_no_retry" });
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 1);
    const second = await sql<{ status: string; error_code: string | null; container_id: string | null }>`
      select status, error_code, container_id from instagram_test_publication_attempts where id = 'second-1'
    `;
    assert.equal(second[0]?.status, "uncertain");
    assert.equal(second[0]?.error_code, "meta_post_transport_unknown");
    assert.equal(second[0]?.container_id, "17841499900000099");
    assert.equal(await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-2" }), null);
    assert.deepEqual(await originalAttempt(sql), before);
  });

  it("does not treat a Meta 4xx or a PUBLISHED container as permission to publish", async () => {
    const { InstagramContainerError, InstagramGraphPostError, reserveSecondInstagramAttempt, runReservedSecondPublish } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    const calls: string[] = [];
    const rejected = await runReservedSecondPublish({
      sql,
      attemptId: "second-1",
      clientId: input.clientId,
      externalAccountId: input.externalAccountId,
      token: "not-a-live-token",
      imageUrl: "https://example.test/klyvona.jpg",
      caption: "test",
      waitUntilFinished: async () => {},
      post: async (path) => {
        calls.push(path);
        throw new InstagramGraphPostError("meta_http_400_code_100_sub_none", true);
      },
    });
    assert.equal(rejected.code, "no_publish_request_sent_locked");
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 0);
    const blocked = await sql<{ status: string }>`select status from instagram_test_publication_attempts where id = 'second-1'`;
    assert.equal(blocked[0]?.status, "failed_before_request");

    const sql2 = await database();
    await reserveSecondInstagramAttempt(sql2, { ...input, attemptId: "second-1" });
    const publishCalls: string[] = [];
    const alreadyMarked = await runReservedSecondPublish({
      sql: sql2,
      attemptId: "second-1",
      clientId: input.clientId,
      externalAccountId: input.externalAccountId,
      token: "not-a-live-token",
      imageUrl: "https://example.test/klyvona.jpg",
      caption: "test",
      post: async (path) => {
        publishCalls.push(path);
        return { id: "17841499900000099" };
      },
      waitUntilFinished: async () => {
        throw new InstagramContainerError("container_status_published");
      },
    });
    assert.equal(alreadyMarked.code, "no_publish_request_sent_locked");
    assert.equal(publishCalls.filter((path) => path.endsWith("/media_publish")).length, 0);
    assert.equal((await originalAttempt(sql2))?.status, "uncertain");
  });

  it("keeps the media id when the published row cannot be saved and does not post twice", async () => {
    const { reserveSecondInstagramAttempt, runReservedSecondPublish } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const before = await originalAttempt(sql);
    await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    let updates = 0;
    const calls: string[] = [];
    const refusing = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update instagram_test_publication_attempts") && values[0] === "published") {
        updates += 1;
        throw new Error("neon_write_refused");
      }
      return sql<T>(strings, ...values);
    }) as Sql;
    refusing.query = sql.query;
    const result = await runReservedSecondPublish({
      sql: refusing,
      attemptId: "second-1",
      clientId: input.clientId,
      externalAccountId: input.externalAccountId,
      token: "not-a-live-token",
      imageUrl: "https://example.test/klyvona.jpg",
      caption: "test",
      waitUntilFinished: async () => {},
      post: async (path) => {
        calls.push(path);
        return { id: path.endsWith("/media_publish") ? "17841499900000111" : "17841499900000099" };
      },
    });
    assert.deepEqual(result, { ok: false, code: "published_but_database_confirmation_failed_no_retry" });
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 1);
    assert.equal(updates, 1);
    const second = await sql<{ status: string; media_id: string | null; error_code: string | null }>`
      select status, media_id, error_code from instagram_test_publication_attempts where id = 'second-1'
    `;
    assert.equal(second[0]?.status, "uncertain");
    assert.equal(second[0]?.media_id, "17841499900000111");
    assert.equal(second[0]?.error_code, "database_persist_failed_after_meta_success");
    assert.deepEqual(await originalAttempt(sql), before);
  });

  it("saves a successful publish once and leaves the first uncertain row untouched", async () => {
    const { reserveSecondInstagramAttempt, runReservedSecondPublish } = await import("./instagram-test-second.functions.ts");
    const sql = await database();
    const before = await originalAttempt(sql);
    await reserveSecondInstagramAttempt(sql, { ...input, attemptId: "second-1" });
    const calls: string[] = [];
    const result = await runReservedSecondPublish({
      sql,
      attemptId: "second-1",
      clientId: input.clientId,
      externalAccountId: input.externalAccountId,
      token: "not-a-live-token",
      imageUrl: "https://example.test/klyvona.jpg",
      caption: "test",
      waitUntilFinished: async () => {},
      post: async (path) => {
        calls.push(path);
        return { id: path.endsWith("/media_publish") ? "17841499900000111" : "17841499900000099" };
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.mediaId, "17841499900000111");
    assert.equal(calls.filter((path) => path.endsWith("/media_publish")).length, 1);
    const second = await sql<{ status: string; media_id: string | null; container_id: string | null }>`
      select status, media_id, container_id from instagram_test_publication_attempts where id = 'second-1'
    `;
    assert.equal(second[0]?.status, "published");
    assert.equal(second[0]?.media_id, "17841499900000111");
    assert.equal(second[0]?.container_id, "17841499900000099");
    assert.deepEqual(await originalAttempt(sql), before);
  });
});
