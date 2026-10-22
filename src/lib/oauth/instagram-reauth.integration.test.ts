import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { sealSecret, openSecret } from "../crypto/tokens.server.ts";
import { sha256Hex } from "./meta-guards.ts";

(globalThis as { __pgBootstrapPromise__?: Promise<void> }).__pgBootstrapPromise__ = Promise.resolve();

const PROFESSIONAL_ID = "17841400000000021";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(run: (tx: Sql) => Promise<T>): Promise<T>;
};

function memorySql(db: PGlite): Sql {
  const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await db.query(text, params)).rows as T[];
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((queryText, part, index) => queryText + part + (index < values.length ? `$${index + 1}` : ""), "");
    return query<T>(text, values);
  }) as Sql;
  sql.query = query;
  sql.transaction = (run) => run(sql);
  return sql;
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      contact_name text not null,
      email text not null,
      phone text not null,
      connect_secret_hash text
    );
    create table social_accounts (
      id text primary key,
      client_id text not null,
      platform text not null,
      status text not null,
      token_ciphertext text,
      token_expires_at timestamptz,
      last_error text,
      external_account_id text,
      connected_at timestamptz,
      unique (client_id, platform)
    );
    create table oauth_states (
      id text primary key,
      client_id text not null,
      platform text not null,
      nonce_hash text not null,
      expires_at timestamptz not null
    );
    create table oauth_pending_accounts (
      id text primary key,
      client_id text not null,
      state_id text not null,
      platform text not null,
      external_account_id text not null,
      display_name text not null,
      eligible boolean not null,
      token_ciphertext text,
      token_expires_at timestamptz,
      expires_at timestamptz not null
    );
  `);
  return { db, sql: memorySql(db) };
}

function useTestEnv() {
  const keys = ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "META_APP_ID", "TOKEN_ENCRYPTION_KEY", "META_OAUTH_REDIRECT_ORIGIN", "GROK_PROJECT_ID", "VERCEL_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.INSTAGRAM_APP_ID = "39264341293211040";
  process.env.INSTAGRAM_APP_SECRET = "instagram-app-secret";
  process.env.META_APP_ID = "2136197140600082";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_OAUTH_REDIRECT_ORIGIN = "http://127.0.0.1:8080";
  delete process.env.GROK_PROJECT_ID;
  delete process.env.VERCEL_ENV;
  return () => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

describe("instagram reauthorization", () => {
  it("replaces only the same account token after one confirmation", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      const oldCipher = await sealSecret(JSON.stringify({ v: 2, userToken: "old-token", igUserId: PROFESSIONAL_ID, username: "klyvona_business" }));
      const newCipher = await sealSecret(JSON.stringify({
        v: 2,
        userToken: "new-token",
        igUserId: PROFESSIONAL_ID,
        username: "klyvona_business",
        grantStatus: "permissions_confirmed",
        grantSource: "oauth_exchange",
        grantedPermissions: ["instagram_business_basic", "instagram_business_content_publish"],
      }));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"a@example.com"}, ${"050"}, ${sha256Hex("connect-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
        values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${oldCipher})
      `;
      await sql`
        insert into oauth_states (id, client_id, platform, nonce_hash, expires_at)
        values (${"state-1"}, ${"client-1"}, ${"instagram"}, ${"hash"}, ${new Date(Date.now() + 60_000).toISOString()})
      `;
      await sql`
        insert into oauth_pending_accounts (
          id, client_id, state_id, platform, external_account_id, display_name, eligible, token_ciphertext, expires_at
        ) values (
          ${"pending-1"}, ${"client-1"}, ${"state-1"}, ${"instagram"}, ${PROFESSIONAL_ID}, ${"klyvona_business"}, ${true}, ${newCipher},
          ${new Date(Date.now() + 60_000).toISOString()}
        )
      `;
      const { selectPendingAccount } = await import("./meta.server.ts");
      const { checkInstagramPublishPermission } = await import("./instagram.server.ts");
      const request = () =>
        new Request("http://127.0.0.1:8080/api/oauth/meta/select", {
          method: "POST",
          body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret", pendingId: "pending-1" }),
        });
      const saved = await selectPendingAccount(request(), sql);
      const body = await saved.json() as Record<string, unknown>;
      assert.equal(saved.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.refreshed, true);
      assert.equal(JSON.stringify(body).includes("new-token"), false);
      assert.equal(JSON.stringify(body).includes("instagram_business_content_publish"), false);
      const stored = await sql<{ token_ciphertext: string; total: number }>`
        select token_ciphertext, (select count(*)::int from social_accounts where client_id = ${"client-1"}) as total
        from social_accounts where id = ${"social-1"}
      `;
      assert.equal(stored[0]?.token_ciphertext, newCipher);
      assert.equal(Number(stored[0]?.total), 1);
      assert.notEqual(stored[0]?.token_ciphertext, oldCipher);
      const opened = JSON.parse(await openSecret(stored[0]?.token_ciphertext ?? "")) as { userToken: string; grantStatus: string };
      assert.equal(opened.userToken, "new-token");
      assert.equal(opened.grantStatus, "permissions_confirmed");
      const pending = await sql`select id from oauth_pending_accounts where id = ${"pending-1"}`;
      assert.equal(pending.length, 0);
      const again = await selectPendingAccount(request(), sql);
      assert.equal(again.status, 404);
      const checked = await checkInstagramPublishPermission(
        new Request("http://127.0.0.1:8080/api/oauth/instagram/permissions", {
          method: "POST",
          body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret" }),
        }),
        {
          async exchangeCode() {
            throw new Error("unused");
          },
          async exchangeLongLived() {
            throw new Error("unused");
          },
          async refresh() {
            throw new Error("unused");
          },
          async profile() {
            return { username: "klyvona_business", accountType: "BUSINESS", userId: PROFESSIONAL_ID, appScopedId: null };
          },
          async grantedPermissions() {
            return { documented: false };
          },
        },
        sql,
      );
      const permission = await checked.json() as Record<string, unknown>;
      assert.equal(permission.grantAtConnection, "permissions_confirmed");
      assert.equal(permission.grantSource, "oauth_exchange");
      assert.equal(permission.liveRecheck, "not_performed");
      assert.equal(permission.permission, "permission_confirmed_at_connection");
      assert.equal(permission.publishingTested, false);
      assert.equal(JSON.stringify(permission).includes("new-token"), false);
      assert.equal(JSON.stringify(permission).includes("instagram_business_content_publish"), false);
    } finally {
      restore();
      await db.close();
    }
  });

  it("keeps the saved connection when the confirmation is not valid", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      const oldCipher = await sealSecret(JSON.stringify({ v: 2, userToken: "old-token", igUserId: PROFESSIONAL_ID }));
      const otherCipher = await sealSecret(JSON.stringify({ v: 2, userToken: "other-token", igUserId: "17841400000000099" }));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash) values
          (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"a@example.com"}, ${"050"}, ${sha256Hex("connect-secret")}),
          (${"client-2"}, ${"KV-OTHER"}, ${"Other"}, ${"b@example.com"}, ${"051"}, ${sha256Hex("other-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext) values
          (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${oldCipher}),
          (${"social-2"}, ${"client-2"}, ${"instagram"}, ${"connected"}, ${"17841400000000099"}, ${otherCipher})
      `;
      await sql`
        insert into oauth_states (id, client_id, platform, nonce_hash, expires_at) values
          (${"state-1"}, ${"client-1"}, ${"instagram"}, ${"hash"}, ${new Date(Date.now() + 60_000).toISOString()}),
          (${"state-2"}, ${"client-2"}, ${"instagram"}, ${"hash"}, ${new Date(Date.now() + 60_000).toISOString()})
      `;
      const future = new Date(Date.now() + 60_000).toISOString();
      const past = new Date(Date.now() - 60_000).toISOString();
      await sql`
        insert into oauth_pending_accounts (
          id, client_id, state_id, platform, external_account_id, display_name, eligible, token_ciphertext, expires_at
        ) values
          (${"wrong-id"}, ${"client-1"}, ${"state-1"}, ${"instagram"}, ${"17841400000000077"}, ${"other"}, ${true}, ${otherCipher}, ${future}),
          (${"foreign"}, ${"client-2"}, ${"state-2"}, ${"instagram"}, ${"17841400000000099"}, ${"other"}, ${true}, ${otherCipher}, ${future}),
          (${"expired"}, ${"client-1"}, ${"state-1"}, ${"instagram"}, ${PROFESSIONAL_ID}, ${"klyvona_business"}, ${true}, ${otherCipher}, ${past})
      `;
      const { selectPendingAccount } = await import("./meta.server.ts");
      const post = (pendingId: string) =>
        selectPendingAccount(
          new Request("http://127.0.0.1:8080/api/oauth/meta/select", {
            method: "POST",
            body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret", pendingId }),
          }),
          sql,
        );
      const mismatch = await (await post("wrong-id")).json() as { error: string };
      const foreign = await (await post("foreign")).json() as { error: string };
      const expired = await (await post("expired")).json() as { error: string };
      assert.equal(mismatch.error, "instagram_id_mismatch");
      assert.equal(foreign.error, "foreign");
      assert.equal(expired.error, "expired");
      const stored = await sql<{ id: string; token_ciphertext: string }>`
        select id, token_ciphertext from social_accounts order by id
      `;
      assert.equal(stored[0]?.token_ciphertext, oldCipher);
      assert.equal(stored[1]?.token_ciphertext, otherCipher);
      const pending = await sql<{ id: string }>`select id from oauth_pending_accounts order by id`;
      assert.deepEqual(pending.map((row) => row.id), ["expired", "foreign", "wrong-id"]);
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-3"}, ${"KV-NEW"}, ${"New"}, ${"c@example.com"}, ${"052"}, ${sha256Hex("new-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status)
        values (${"social-3"}, ${"client-3"}, ${"instagram"}, ${"awaiting_setup"})
      `;
      await sql`
        insert into oauth_states (id, client_id, platform, nonce_hash, expires_at)
        values (${"state-3"}, ${"client-3"}, ${"instagram"}, ${"hash"}, ${future})
      `;
      const firstCipher = await sealSecret(JSON.stringify({ v: 2, userToken: "first-token", igUserId: PROFESSIONAL_ID }));
      await sql`
        insert into oauth_pending_accounts (
          id, client_id, state_id, platform, external_account_id, display_name, eligible, token_ciphertext, expires_at
        ) values (
          ${"first"}, ${"client-3"}, ${"state-3"}, ${"instagram"}, ${PROFESSIONAL_ID}, ${"klyvona_business"}, ${true}, ${firstCipher}, ${future}
        )
      `;
      const first = await selectPendingAccount(
        new Request("http://127.0.0.1:8080/api/oauth/meta/select", {
          method: "POST",
          body: JSON.stringify({ reference: "KV-NEW", connectSecret: "new-secret", pendingId: "first" }),
        }),
        sql,
      );
      const firstBody = await first.json() as { ok?: boolean; refreshed?: boolean };
      assert.equal(first.status, 200);
      assert.equal(firstBody.ok, true);
      assert.equal(firstBody.refreshed, false);
      const rows = await sql`select id from social_accounts where client_id = ${"client-3"}`;
      assert.equal(rows.length, 1);
    } finally {
      restore();
      await db.close();
    }
  });
});
