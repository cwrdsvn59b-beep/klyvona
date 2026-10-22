import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { isMigrationFile, migrationName, migrationPrefix, pendingMigrations } from "./migration-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

const AUTH_MIGRATION = "0001_auth.sql";

/**
 * The auth-on copy of the Better Auth schema and its source, or null when the
 * app has not turned sign-in on (the shipped state).
 */
function authSchemaCopy(root) {
  const copy = join(root, "migrations", AUTH_MIGRATION);
  const source = join(root, "migrations/auth", AUTH_MIGRATION);
  if (!existsSync(copy) || !existsSync(source)) return null;
  return { copy: readFileSync(copy, "utf8"), source: readFileSync(source, "utf8") };
}

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/auth/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  // The auth-on path copies migrations/auth/0001_auth.sql into the globbed
  // directory; a database that already has it must not run it twice.
  assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("999 is applied before 1000, and an already applied 999 is not run again", () => {
  const paths = [
    "migrations/1000_instagram_test_publication_attempts.sql",
    "migrations/999_instagram_test_publications.sql",
    "migrations/0004_client_approval.sql",
  ];
  assert.ok(migrationPrefix("999_instagram_test_publications.sql") < migrationPrefix("1000_instagram_test_publication_attempts.sql"));
  assert.deepEqual(
    pendingMigrations(paths, []).map((item) => item.name),
    [
      "0004_client_approval.sql",
      "999_instagram_test_publications.sql",
      "1000_instagram_test_publication_attempts.sql",
    ],
  );
  assert.deepEqual(
    pendingMigrations(paths, [
      "0004_client_approval.sql",
      "999_instagram_test_publications.sql",
    ]).map((item) => item.name),
    ["1000_instagram_test_publication_attempts.sql"],
  );
});

test("the instagram attempt migration follows 999 on disk and does not reapply it", () => {
  const names = readdirSync(join(projectRoot(), "migrations"));
  const order = pendingMigrations(names, []).map((item) => item.name);
  const first = order.indexOf("999_instagram_test_publications.sql");
  const second = order.indexOf("1000_instagram_test_publication_attempts.sql");
  assert.ok(first >= 0 && second > first);
  const pending = pendingMigrations(names, ["999_instagram_test_publications.sql"]).map((item) => item.name);
  assert.equal(pending.includes("999_instagram_test_publications.sql"), false);
  assert.equal(pending.includes("1000_instagram_test_publication_attempts.sql"), true);
});

test("non-.sql entries are dropped (readdir also yields the auth/ directory)", () => {
  assert.equal(isMigrationFile("auth"), false);
  assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
});

test("product migrations are globbed and the auth source stays outside that glob", () => {
  const migrationsDir = join(projectRoot(), "migrations");
  const pending = pendingMigrations(readdirSync(migrationsDir), []).map((item) => item.name);
  assert.deepEqual(pending, [
    "0001_auth.sql",
    "0002_klyvona.sql",
    "0003_meta_oauth.sql",
    "0004_client_approval.sql",
    "999_instagram_test_publications.sql",
    "1000_instagram_test_publication_attempts.sql",
    "1001_instagram_manual_publications.sql",
    "1002_instagram_generation_results.sql",
    "1003_photo_generation_jobs.sql",
    "1004_instagram_generation_review.sql",
  ]);
  assert.ok(readdirSync(join(migrationsDir, "auth")).includes("0001_auth.sql"));
  assert.equal(pending.filter((name) => name === "0001_auth.sql").length, 1);
});

test("this workspace's auth schema copy is byte-identical to its source", () => {
  // An edited copy diverges silently: basename keying skips it on a database
  // that already ran the original, and applies it on a fresh PGLite preview.
  const pair = authSchemaCopy(projectRoot());
  if (pair === null) return; // sign-in off — nothing has been copied up
  assert.equal(
    pair.copy,
    pair.source,
    "migrations/0001_auth.sql has been edited — it must stay a verbatim copy of migrations/auth/0001_auth.sql",
  );
});

test("ordered migrations apply on a local Postgres and 1000 follows 999", async () => {
  const root = projectRoot();
  const pending = pendingMigrations(readdirSync(join(root, "migrations")), []);
  const db = new PGlite();
  for (const item of pending) {
    await db.exec(readFileSync(join(root, "migrations", item.name), "utf8"));
  }
  await db.exec(`
    insert into clients (id, reference_code, contact_name, email, phone)
    values ('client-1', 'KV-EKBXGL', 'Test', 'test@example.com', '0500000000');
    insert into instagram_test_publications (
      id, client_id, admin_user_id, instagram_account_id, token_hash, status, container_id
    ) values (
      'first', 'client-1', 'admin-0', '17841499900000001', 'hash', 'uncertain', '17841499900000001'
    );
  `);
  const blocked = await db.query(`
    insert into instagram_test_publication_attempts (
      id, client_id, admin_user_id, instagram_account_id, token_hash, status, container_id
    ) values (
      'second', 'client-1', 'admin-1', '17841499900000002', 'hash', 'container_created', '17841499900000001'
    )
  `).then(() => false).catch((error) => /reused_instagram_test_container/.test(String(error.message)));
  assert.equal(blocked, true);
  const original = await db.query("select status from instagram_test_publications where client_id = 'client-1'");
  assert.equal(original.rows[0].status, "uncertain");
});

test("the copy check reads both files and catches an edit", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-schema-"));
  mkdirSync(join(root, "migrations/auth"), { recursive: true });
  writeFileSync(join(root, "migrations/auth", AUTH_MIGRATION), "create table t ();\n");
  assert.equal(authSchemaCopy(root), null);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t ();\n");
  const same = authSchemaCopy(root);
  assert.equal(same.copy, same.source);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t (x int);\n");
  const drifted = authSchemaCopy(root);
  assert.notEqual(drifted.copy, drifted.source);
});
