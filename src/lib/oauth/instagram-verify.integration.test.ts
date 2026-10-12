import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { sealSecret } from "../crypto/tokens.server.ts";
import { sha256Hex } from "./meta-guards.ts";

(globalThis as { __pgBootstrapPromise__?: Promise<void> }).__pgBootstrapPromise__ = Promise.resolve();

const INSTAGRAM_APP_ID = "39264341293211040";
const META_APP_ID = "2136197140600082";
const PROFESSIONAL_ID = "17841400000000021";
const OTHER_ID = "17841400000000099";
const SCOPED_ID = "17841400000000077";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

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
    create table social_accounts (
      id text primary key,
      client_id text not null,
      platform text not null,
      status text not null,
      token_ciphertext text,
      external_account_id text
    );
  `);
  return { db, sql: memorySql(db) };
}

function useTestEnv() {
  const keys = ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "META_APP_ID", "TOKEN_ENCRYPTION_KEY", "META_OAUTH_REDIRECT_ORIGIN", "GROK_PROJECT_ID", "VERCEL_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.INSTAGRAM_APP_ID = INSTAGRAM_APP_ID;
  process.env.INSTAGRAM_APP_SECRET = "instagram-app-secret";
  process.env.META_APP_ID = META_APP_ID;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
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

type Profile = { username: string; accountType: string | null; userId: string | null; appScopedId: string | null };

function graph(result: Profile | Error) {
  return {
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
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("instagram identity verification", () => {
  async function verify() {
    return import("./instagram.server.ts");
  }

  async function seed(sql: Sql, input: { storedId: string; token?: string | null; username?: string; status?: string }) {
    await sql`
      insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
      values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"a@example.com"}, ${"050"}, ${sha256Hex("connect-secret")})
    `;
    const ciphertext = input.token
      ? await sealSecret(JSON.stringify({ v: 2, userToken: input.token, igUserId: input.storedId, ...(input.username ? { username: input.username } : {}) }))
      : null;
    await sql`
      insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
      values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${input.status ?? "connected"}, ${input.storedId}, ${ciphertext})
    `;
    return ciphertext;
  }

  async function snapshot(sql: Sql) {
    const rows = await sql<{ external_account_id: string; token_ciphertext: string | null; status: string }>`
      select external_account_id, token_ciphertext, status from social_accounts where id = ${"social-1"}
    `;
    return rows[0];
  }

  async function run(sql: Sql, result: Profile | Error, reference = "KV-TEST", secret = "connect-secret") {
    const { verifyInstagramIdentity } = await verify();
    const response = await verifyInstagramIdentity(
      new Request("http://127.0.0.1:8080/api/oauth/instagram/verify", {
        method: "POST",
        body: JSON.stringify({ reference, connectSecret: secret }),
      }),
      graph(result),
      sql,
    );
    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body };
  }

  const business: Profile = { username: "klyvona_business", accountType: "BUSINESS", userId: PROFESSIONAL_ID, appScopedId: SCOPED_ID };
  const creator: Profile = { username: "klyvona_creator", accountType: "MEDIA_CREATOR", userId: PROFESSIONAL_ID, appScopedId: SCOPED_ID };

  it("confirms a business account, a creator, and leaves the database unchanged", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      const sealed = await seed(sql, { storedId: PROFESSIONAL_ID, token: "stored-token", username: "klyvona_business" });
      const before = await snapshot(sql);
      const checked = await run(sql, business);
      assert.equal(checked.body.check, "identity_confirmed");
      assert.equal(checked.body.identityConfirmed, true);
      assert.equal(checked.body.username, "klyvona_business");
      assert.equal(checked.body.publishingAllowed, false);
      assert.equal(checked.body.publishing, "not_verified");
      assert.equal(JSON.stringify(checked.body).includes("stored-token"), false);
      assert.deepEqual(await snapshot(sql), before);
      assert.equal(before?.token_ciphertext, sealed);

      const created = await run(sql, creator);
      assert.equal(created.body.check, "identity_confirmed");
      assert.equal(created.body.username, "klyvona_creator");
      assert.equal(created.body.publishingAllowed, false);
      assert.deepEqual(await snapshot(sql), before);
    } finally {
      restore();
      await db.close();
    }
  });

  it("rejects app ids, an app-scoped id, a mismatch, and an old row without a username", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    const { InstagramRequestError } = await verify();
    try {
      await seed(sql, { storedId: PROFESSIONAL_ID, token: "stored-token" });
      const before = await snapshot(sql);
      assert.equal((await run(sql, { ...business, userId: INSTAGRAM_APP_ID })).body.check, "identity_unconfirmed");
      assert.equal((await run(sql, { ...business, userId: META_APP_ID })).body.check, "identity_unconfirmed");
      assert.equal((await run(sql, { username: "klyvona_business", accountType: "BUSINESS", userId: null, appScopedId: SCOPED_ID })).body.check, "identity_unconfirmed");
      const mismatch = await run(sql, { ...business, userId: OTHER_ID });
      assert.equal(mismatch.body.check, "identity_mismatch");
      assert.equal(mismatch.body.identityConfirmed, false);
      const named = await run(sql, business);
      assert.equal(named.body.check, "identity_confirmed");
      assert.equal(named.body.username, "klyvona_business");
      assert.deepEqual(await snapshot(sql), before);

      const auth = await run(sql, new InstagramRequestError("auth"));
      assert.equal(auth.body.check, "reconnect");
      const temporary = await run(sql, new InstagramRequestError("temporary"));
      assert.equal(temporary.body.check, "temporary_error");
      assert.equal((await run(sql, new Error("network"))).body.check, "temporary_error");
      assert.deepEqual(await snapshot(sql), before);
      assert.equal(JSON.stringify(auth.body).includes("stored-token"), false);
    } finally {
      restore();
      await db.close();
    }
  });

  it("does not reveal another customer's account and does not rewrite a stored app id", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      await seed(sql, { storedId: INSTAGRAM_APP_ID, token: "stored-token" });
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-2"}, ${"KV-OTHER"}, ${"Other"}, ${"b@example.com"}, ${"051"}, ${sha256Hex("other-secret")})
      `;
      const before = await snapshot(sql);
      const other = await run(sql, business, "KV-OTHER", "other-secret");
      assert.equal(other.status, 200);
      assert.equal(other.body.check, "reconnect");
      assert.equal(other.body.tokenSaved, false);
      assert.equal(JSON.stringify(other.body).includes("klyvona_business"), false);
      assert.equal(JSON.stringify(other.body).includes("stored-token"), false);
      const denied = await run(sql, business, "KV-TEST", "wrong-secret");
      assert.equal(denied.status, 401);
      assert.equal(JSON.stringify(denied.body).includes("stored-token"), false);
      const mismatch = await run(sql, business);
      assert.equal(mismatch.body.check, "identity_mismatch");
      assert.equal(mismatch.body.identityConfirmed, false);
      assert.equal((await snapshot(sql))?.external_account_id, INSTAGRAM_APP_ID);
      assert.deepEqual(await snapshot(sql), before);
    } finally {
      restore();
      await db.close();
    }
  });
});
