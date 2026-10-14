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
    assert.ok(source.indexOf("await waitForContainerFinished(containerId, token)") < source.indexOf("const published = await graphPost"));
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
});
