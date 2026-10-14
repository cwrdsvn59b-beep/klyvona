import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { sealSecret } from "../crypto/tokens.server.ts";
import { sha256Hex } from "./meta-guards.ts";

(globalThis as { __pgBootstrapPromise__?: Promise<void> }).__pgBootstrapPromise__ = Promise.resolve();

const INSTAGRAM_APP_ID = "39264341293211040";
const META_APP_ID = "2136197140600082";
const PROFESSIONAL_ID = "17841400000000021";

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

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create table clients (
      id text primary key,
      reference_code text not null,
      contact_name text not null,
      email text not null,
      phone text not null,
      connect_secret_hash text,
      approval_status text default 'approved'
    );
    create table social_accounts (
      id text primary key,
      client_id text not null,
      platform text not null,
      status text not null,
      token_ciphertext text,
      external_account_id text,
      publish_permission text,
      publish_permission_token_hash text,
      publish_permission_at timestamptz
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
type PermissionResult = { documented: false; reviewRequired?: boolean } | { documented: true; granted: string[]; reviewRequired?: boolean };

describe("instagram publish permission check", () => {
  const calls: string[] = [];
  const business: Profile = { username: "klyvona_business", accountType: "BUSINESS", userId: PROFESSIONAL_ID, appScopedId: "17841400000000077" };
  const creator: Profile = { ...business, username: "klyvona_creator", accountType: "MEDIA_CREATOR" };

  function graph(profile: Profile | Error, permissions: PermissionResult | Error = { documented: false }) {
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
        calls.push("me");
        if (profile instanceof Error) throw profile;
        return profile;
      },
      async grantedPermissions() {
        calls.push("permissions");
        if (permissions instanceof Error) throw permissions;
        return permissions;
      },
    };
  }

  async function seed(sql: Sql, storedId = PROFESSIONAL_ID) {
    await sql`
      insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
      values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"a@example.com"}, ${"050"}, ${sha256Hex("connect-secret")})
    `;
    const ciphertext = await sealSecret(JSON.stringify({ v: 2, userToken: "stored-token", igUserId: storedId, username: "klyvona_business" }));
    await sql`
      insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
      values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${storedId}, ${ciphertext})
    `;
    return ciphertext;
  }

  async function run(sql: Sql, profile: Profile | Error, permissions?: PermissionResult | Error, reference = "KV-TEST", secret = "connect-secret") {
    const { checkInstagramPublishPermission } = await import("./instagram.server.ts");
    const response = await checkInstagramPublishPermission(
      new Request("http://127.0.0.1:8080/api/oauth/instagram/permissions", {
        method: "POST",
        body: JSON.stringify({ reference, connectSecret: secret }),
      }),
      graph(profile, permissions),
      sql,
    );
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it("does not treat a live token or the authorize scope as publish permission", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    const { liveInstagramGraph, InstagramRequestError } = await import("./instagram.server.ts");
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = () => {
      fetched += 1;
      return Promise.reject(new Error("network-not-allowed"));
    };
    try {
      await liveInstagramGraph.grantedPermissions?.("stored-token");
      assert.equal(fetched, 0);
      const ciphertext = await seed(sql);
      const before = await sql<{ token_ciphertext: string | null; status: string; external_account_id: string }>`
        select token_ciphertext, status, external_account_id from social_accounts where id = ${"social-1"}
      `;
      calls.length = 0;
      const unavailable = await run(sql, business, { documented: false });
      assert.equal(unavailable.body.identity, "identity_confirmed");
      assert.equal(unavailable.body.permission, "verification_unavailable");
      assert.equal(unavailable.body.publishingTested, false);
      assert.equal(unavailable.body.contentCreated, false);
      assert.equal(calls.includes("media") || calls.includes("media_publish"), false);
      assert.deepEqual(await sql`select token_ciphertext, status, external_account_id from social_accounts where id = ${"social-1"}`, before);
      assert.equal(before[0]?.token_ciphertext, ciphertext);

      const granted = ["instagram_business_basic", "instagram_business_content_publish"];
      const confirmed = await run(sql, business, { documented: true, granted });
      assert.equal(confirmed.body.permission, "permission_confirmed");
      assert.equal(confirmed.body.grantAtConnection, "permissions_unknown");
      assert.equal(confirmed.body.liveRecheck, "not_performed");
      assert.equal(confirmed.body.contentCreated, false);
      const created = await run(sql, creator, { documented: true, granted });
      assert.equal(created.body.permission, "permission_confirmed");
      assert.equal(created.body.identity, "identity_confirmed");
      const missing = await run(sql, business, { documented: true, granted: ["instagram_business_basic"] });
      assert.equal(missing.body.permission, "permission_missing");
      const review = await run(sql, business, { documented: false, reviewRequired: true });
      assert.equal(review.body.permission, "app_review_required");
      const auth = await run(sql, new InstagramRequestError("auth"));
      assert.equal(auth.body.identity, "reconnect");
      assert.notEqual(auth.body.permission, "permission_confirmed");
      const temporary = await run(sql, new InstagramRequestError("temporary"));
      assert.equal(temporary.body.permission, "temporary_error");
      assert.equal(JSON.stringify(confirmed.body).includes("stored-token"), false);
      assert.deepEqual(await sql`select token_ciphertext, status, external_account_id from social_accounts where id = ${"social-1"}`, before);
    } finally {
      globalThis.fetch = originalFetch;
      restore();
      await db.close();
    }
  });

  it("rejects another customer and does not create content", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      await seed(sql);
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-2"}, ${"KV-OTHER"}, ${"Other"}, ${"b@example.com"}, ${"051"}, ${sha256Hex("other-secret")})
      `;
      calls.length = 0;
      const other = await run(sql, business, { documented: true, granted: ["instagram_business_content_publish"] }, "KV-OTHER", "other-secret");
      assert.equal(other.body.identity, "reconnect");
      assert.notEqual(other.body.permission, "permission_confirmed");
      assert.equal(JSON.stringify(other.body).includes("klyvona_business"), false);
      assert.equal(calls.includes("me"), false);
      const denied = await run(sql, business, { documented: true, granted: ["instagram_business_content_publish"] }, "KV-TEST", "wrong-secret");
      assert.equal(denied.status, 401);
      assert.equal(JSON.stringify(denied.body).includes("stored-token"), false);
    } finally {
      restore();
      await db.close();
    }
  });

  it("reports the grant saved at connection without calling it a live permission", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    const { instagramPermissionText } = await import("./connect-session.ts");
    try {
      await seed(sql);
      const replace = async (payload: Record<string, unknown>) => {
        const ciphertext = await sealSecret(JSON.stringify(payload));
        await sql`update social_accounts set token_ciphertext = ${ciphertext} where id = ${"social-1"}`;
        return ciphertext;
      };
      const base = { v: 2, userToken: "stored-token", igUserId: PROFESSIONAL_ID, username: "klyvona_business" };
      const before = await replace({
        ...base,
        grantStatus: "permissions_confirmed",
        grantSource: "oauth_exchange",
        grantedPermissions: ["instagram_business_basic", "instagram_business_content_publish"],
      });
      const confirmed = await run(sql, business, { documented: false });
      assert.equal(confirmed.body.grantAtConnection, "permissions_confirmed");
      assert.equal(confirmed.body.grantSource, "oauth_exchange");
      assert.equal(confirmed.body.liveRecheck, "not_performed");
      assert.equal(confirmed.body.permission, "permission_confirmed_at_connection");
      assert.equal(confirmed.body.identity, "identity_confirmed");
      assert.equal(confirmed.body.publishingTested, false);
      assert.equal(confirmed.body.contentCreated, false);
      const confirmedText = instagramPermissionText(confirmed.body);
      assert.match(confirmedText.grantMessage, /אינה בדיקה מקוונת/);
      assert.equal(JSON.stringify(confirmed.body).includes("stored-token"), false);
      assert.equal(JSON.stringify(confirmed.body).includes("instagram_business_content_publish"), false);
      const liveMissing = await run(sql, business, { documented: true, granted: ["instagram_business_basic"] });
      assert.equal(liveMissing.body.permission, "permission_missing");
      const wrongIdentity = await run(sql, { ...business, userId: "17841400000000099" }, { documented: false });
      assert.equal(wrongIdentity.body.permission, "verification_unavailable");
      assert.equal(wrongIdentity.body.identity, "identity_mismatch");
      const temporary = await run(sql, new Error("network"), { documented: false });
      assert.equal(temporary.body.permission, "temporary_error");
      assert.equal((await sql<{ token_ciphertext: string }>`select token_ciphertext from social_accounts where id = ${"social-1"}`)[0]?.token_ciphertext, before);

      await replace({ ...base, grantStatus: "permissions_missing", grantSource: "oauth_exchange", grantedPermissions: ["instagram_business_basic"] });
      const missing = await run(sql, business, { documented: false });
      assert.equal(missing.body.grantAtConnection, "permissions_missing");
      assert.equal(missing.body.permission, "permission_missing_at_connection");
      assert.notEqual(missing.body.identity, "reconnect");

      await replace(base);
      const oldToken = await run(sql, business, { documented: false });
      assert.equal(oldToken.body.grantAtConnection, "permissions_unknown");
      assert.equal(oldToken.body.grantSource, "not_stored");
      assert.equal(oldToken.body.permission, "verification_unavailable");
      assert.equal(oldToken.body.identity, "identity_confirmed");

      await replace({ ...base, grantStatus: "permissions_confirmed", grantedPermissions: ["not a scope"] });
      const broken = await run(sql, business, { documented: false });
      assert.equal(broken.body.grantAtConnection, "permissions_unknown");
      assert.equal(broken.body.permission, "verification_unavailable");
      assert.notEqual(broken.body.identity, "reconnect");
    } finally {
      restore();
      await db.close();
    }
  });
  it("persists an OAuth-exchange publish grant for the matching connected token only", async () => {
    const restore = useTestEnv();
    const { db, sql } = await createDatabase();
    try {
      const { rememberCheckedPermission, tokenHash } = await import("../approval.server.ts");
      const secret = "valid-connect-secret-123456";
      const reference = "KV-ABC123";
      const payload = {
        v: 2,
        userToken: "long-lived-token",
        igUserId: PROFESSIONAL_ID,
        username: "klyvona_business",
        grantStatus: "permissions_confirmed",
        grantSource: "oauth_exchange",
        grantedPermissions: ["instagram_business_basic", "instagram_business_content_publish"],
      };
      const cipher = await sealSecret(JSON.stringify(payload));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-1"}, ${reference}, ${"Client"}, ${"test@example.com"}, ${"050"}, ${sha256Hex(secret)})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
        values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${cipher})
      `;
      const record = (permission: string, identity = "identity_confirmed", connectSecret = secret) =>
        rememberCheckedPermission({ reference, connectSecret, identity, permission }, sql);
      const stored = async () => (await sql<{ publish_permission: string | null; publish_permission_token_hash: string | null }>`
        select publish_permission, publish_permission_token_hash from social_accounts where id = ${"social-1"}
      `)[0];

      await record("permission_confirmed_at_connection", "identity_mismatch");
      assert.equal((await stored())?.publish_permission, null);
      await record("permission_confirmed_at_connection", "identity_confirmed", "invalid-connect-secret-123456");
      assert.equal((await stored())?.publish_permission, null);

      await record("permission_confirmed_at_connection");
      assert.equal((await stored())?.publish_permission, "confirmed");
      assert.equal((await stored())?.publish_permission_token_hash, tokenHash(cipher));

      const replacement = await sealSecret(JSON.stringify({ ...payload, userToken: "replacement", grantedPermissions: ["instagram_business_basic"], grantStatus: "permissions_missing" }));
      await sql`update social_accounts set token_ciphertext = ${replacement} where id = ${"social-1"}`;
      assert.notEqual((await stored())?.publish_permission_token_hash, tokenHash(replacement));
      await record("permission_confirmed_at_connection");
      assert.notEqual((await stored())?.publish_permission_token_hash, tokenHash(replacement));
      await record("permission_missing_at_connection");
      assert.equal((await stored())?.publish_permission, "missing");
      assert.equal((await stored())?.publish_permission_token_hash, null);

      const wrongAccount = await sealSecret(JSON.stringify({ ...payload, igUserId: "17841400000000099" }));
      await sql`update social_accounts set token_ciphertext = ${wrongAccount} where id = ${"social-1"}`;
      await record("permission_confirmed_at_connection");
      assert.equal((await stored())?.publish_permission, "missing");

      const unknown = await sealSecret(JSON.stringify({ ...payload, grantSource: "not_stored" }));
      await sql`update social_accounts set token_ciphertext = ${unknown} where id = ${"social-1"}`;
      await record("permission_confirmed_at_connection");
      assert.equal((await stored())?.publish_permission, "missing");

      await sql`update social_accounts set token_ciphertext = ${cipher}, status = ${"expired"} where id = ${"social-1"}`;
      await record("permission_confirmed_at_connection");
      assert.equal((await stored())?.publish_permission, "missing");
    } finally {
      restore();
      await db.close();
    }
  });

});
