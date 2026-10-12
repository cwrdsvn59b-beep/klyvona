import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { sealSecret } from "../crypto/tokens.server.ts";
import { sha256Hex } from "./meta-guards.ts";

(globalThis as { __pgBootstrapPromise__?: Promise<void> }).__pgBootstrapPromise__ = Promise.resolve();

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const INSTAGRAM_APP_ID = "39264341293211040";
const META_APP_ID = "2136197140600082";
const PROFESSIONAL_ID = "17841400000000021";

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

async function createDatabase(): Promise<{ db: PGlite; sql: Sql }> {
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
    create table oauth_states (
      id text primary key,
      client_id text not null,
      platform text not null,
      nonce_hash text not null,
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create table oauth_pending_accounts (
      id text primary key,
      client_id text not null,
      state_id text not null,
      platform text not null,
      external_account_id text not null,
      display_name text not null,
      eligible boolean not null,
      ineligible_reason text,
      token_ciphertext text,
      token_expires_at timestamptz,
      parent_external_id text,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
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
      connected_at timestamptz
    );
  `);
  return { db, sql: memorySql(db) };
}

function useTestEnv() {
  const previous = {
    INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID,
    INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET,
    META_APP_ID: process.env.META_APP_ID,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    META_OAUTH_REDIRECT_ORIGIN: process.env.META_OAUTH_REDIRECT_ORIGIN,
    GROK_PROJECT_ID: process.env.GROK_PROJECT_ID,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  process.env.INSTAGRAM_APP_ID = INSTAGRAM_APP_ID;
  process.env.INSTAGRAM_APP_SECRET = "instagram-app-secret";
  process.env.META_APP_ID = META_APP_ID;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
  process.env.META_OAUTH_REDIRECT_ORIGIN = "http://127.0.0.1:8080";
  delete process.env.GROK_PROJECT_ID;
  delete process.env.VERCEL_ENV;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function mockInstagram(profile: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.instagram.com/oauth/access_token")) {
      return Response.json({ data: [{ access_token: "short-lived-token", user_id: INSTAGRAM_APP_ID }] });
    }
    if (url.includes("/access_token")) return Response.json({ access_token: "long-lived-token", expires_in: 3600 });
    if (url.includes("/me")) return Response.json(profile);
    return new Response("unexpected", { status: 404 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function seed(sql: Sql, stateId: string, nonce: string) {
  await sql`
    insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
    values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"test@example.com"}, ${"0500000000"}, ${sha256Hex("connect-secret")})
  `;
  await sql`
    insert into social_accounts (id, client_id, platform, status)
    values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"awaiting_setup"})
  `;
  await sql`
    insert into oauth_states (id, client_id, platform, nonce_hash, expires_at)
    values (${stateId}, ${"client-1"}, ${"instagram"}, ${sha256Hex(nonce)}, ${new Date(Date.now() + 60_000).toISOString()})
  `;
}

describe("instagram identity against a test database", () => {
  async function handlers() {
    const instagram = await import("./instagram.server.ts");
    const meta = await import("./meta.server.ts");
    return { finishInstagramOAuth: instagram.finishInstagramOAuth, listPendingAccounts: meta.listPendingAccounts, selectPendingAccount: meta.selectPendingAccount };
  }

  it("stores the professional id and username, not either app id", async () => {
    const restoreEnv = useTestEnv();
    const restoreFetch = mockInstagram({
      id: META_APP_ID,
      user_id: PROFESSIONAL_ID,
      username: "klyvona_business",
      account_type: "BUSINESS",
    });
    const { db, sql } = await createDatabase();
    try {
      const { finishInstagramOAuth, selectPendingAccount, listPendingAccounts } = await handlers();
      const stateId = "state-1";
      const nonce = "nonce-value";
      await seed(sql, stateId, nonce);
      const response = await finishInstagramOAuth(
        new Request(`http://127.0.0.1:8080/api/oauth/instagram/callback?code=once&state=${stateId}.${nonce}`, {
          headers: { cookie: `klyvona_ig_oauth=${stateId}` },
        }),
        undefined,
        sql,
      );
      assert.equal(response.headers.get("location"), "http://127.0.0.1:8080/connect?ready=1");
      const pending = await sql<{ id: string; external_account_id: string; display_name: string }>`
        select id, external_account_id, display_name from oauth_pending_accounts
      `;
      assert.equal(pending[0]?.external_account_id, PROFESSIONAL_ID);
      assert.equal(pending[0]?.display_name, "klyvona_business");
      assert.notEqual(pending[0]?.external_account_id, INSTAGRAM_APP_ID);
      assert.notEqual(pending[0]?.external_account_id, META_APP_ID);

      const saved = await selectPendingAccount(
        new Request("http://127.0.0.1:8080/api/oauth/meta/accounts/select", {
          method: "POST",
          body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret", pendingId: pending[0]?.id }),
        }),
        sql,
      );
      assert.equal(saved.status, 200);
      const listed = await listPendingAccounts(
        new Request("http://127.0.0.1:8080/api/oauth/meta/accounts", {
          method: "POST",
          body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret" }),
        }),
        sql,
      );
      const body = await listed.json() as { connected: Array<{ name?: string; externalAccountId: string; trusted: boolean }> };
      const encoded = JSON.stringify(body);
      assert.equal(body.connected[0]?.name, "klyvona_business");
      assert.equal(body.connected[0]?.externalAccountId, PROFESSIONAL_ID);
      assert.equal(body.connected[0]?.trusted, true);
      assert.equal(encoded.includes(INSTAGRAM_APP_ID), false);
      assert.equal(encoded.includes(META_APP_ID), false);
      assert.equal(encoded.includes("long-lived-token"), false);
      assert.equal(encoded.includes("short-lived-token"), false);
    } finally {
      restoreFetch();
      restoreEnv();
      await db.close();
    }
  });

  it("does not store an app-scoped id as the publishing id and rejects app ids", async () => {
    const restoreEnv = useTestEnv();
    const { db, sql } = await createDatabase();
    const restoreFetch = mockInstagram({ id: PROFESSIONAL_ID, username: "klyvona_business", account_type: "BUSINESS" });
    const { finishInstagramOAuth } = await handlers();
    try {
      await seed(sql, "state-2", "nonce-2");
      const accepted = await finishInstagramOAuth(
        new Request("http://127.0.0.1:8080/api/oauth/instagram/callback?code=once&state=state-2.nonce-2", {
          headers: { cookie: "klyvona_ig_oauth=state-2" },
        }),
        undefined,
        sql,
      );
      assert.equal(accepted.headers.get("location"), "http://127.0.0.1:8080/connect?error=exchange");
      const rows = await sql<{ external_account_id: string }>`select external_account_id from oauth_pending_accounts`;
      assert.equal(rows.length, 0);
    } finally {
      restoreFetch();
    }

    const rejectFetch = mockInstagram({ id: META_APP_ID, user_id: INSTAGRAM_APP_ID, username: "klyvona_business", account_type: "BUSINESS" });
    try {
      await sql`
        insert into oauth_states (id, client_id, platform, nonce_hash, expires_at)
        values (${"state-3"}, ${"client-1"}, ${"instagram"}, ${sha256Hex("nonce-3")}, ${new Date(Date.now() + 60_000).toISOString()})
      `;
      const rejected = await finishInstagramOAuth(
        new Request("http://127.0.0.1:8080/api/oauth/instagram/callback?code=once&state=state-3.nonce-3", {
          headers: { cookie: "klyvona_ig_oauth=state-3" },
        }),
        undefined,
        sql,
      );
      assert.equal(rejected.headers.get("location"), "http://127.0.0.1:8080/connect?error=exchange");
      const rows = await sql<{ external_account_id: string }>`select external_account_id from oauth_pending_accounts`;
      assert.equal(rows.every((row) => row.external_account_id === PROFESSIONAL_ID), true);
      assert.equal(rows.some((row) => row.external_account_id === INSTAGRAM_APP_ID || row.external_account_id === META_APP_ID), false);
    } finally {
      rejectFetch();
      restoreEnv();
      await db.close();
    }
  });

  it("does not treat a stored numeric id as a username", async () => {
    const restoreEnv = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      const { listPendingAccounts } = await handlers();
      const sealed = await sealSecret(JSON.stringify({ v: 2, userToken: "stored-token", igUserId: PROFESSIONAL_ID }));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"test@example.com"}, ${"0500000000"}, ${sha256Hex("connect-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
        values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${sealed})
      `;
      const listed = await listPendingAccounts(
        new Request("http://127.0.0.1:8080/api/oauth/meta/accounts", {
          method: "POST",
          body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret" }),
        }),
        sql,
      );
      const body = await listed.json() as { connected: Array<{ name?: string; trusted: boolean; externalAccountId: string; status?: string }> };
      assert.equal(body.connected[0]?.status, "missing_username");
      assert.equal(body.connected[0]?.trusted, false);
      assert.equal(body.connected[0]?.name, undefined);
      assert.equal(body.connected[0]?.externalAccountId, PROFESSIONAL_ID);
      assert.equal(JSON.stringify(body).includes("stored-token"), false);
      const before = await sql<{ token_ciphertext: string | null }>`select token_ciphertext from social_accounts`;
      const { previewInstagramIdentity } = await import("./instagram.server.ts");
      const preview = await previewInstagramIdentity({ tokenCiphertext: sealed, storedId: PROFESSIONAL_ID }, {
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
          return { username: "klyvona_business", accountType: "BUSINESS", userId: PROFESSIONAL_ID, appScopedId: META_APP_ID };
        },
      });
      assert.equal(preview.persist, false);
      assert.equal(preview.status, "connected");
      assert.equal(preview.publishUserId, PROFESSIONAL_ID);
      assert.equal(JSON.stringify(preview).includes("stored-token"), false);
      const after = await sql<{ token_ciphertext: string | null }>`select token_ciphertext from social_accounts`;
      assert.equal(after[0]?.token_ciphertext, before[0]?.token_ciphertext);
    } finally {
      restoreEnv();
      await db.close();
    }
  });
});
