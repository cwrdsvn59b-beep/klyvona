import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { sealSecret, openSecret } from "../crypto/tokens.server.ts";
import { sha256Hex } from "./meta-guards.ts";
import {
  OAUTH_TRACE_LIMIT,
  clearOAuthTrace,
  oauthTraceForAdmin,
  readOAuthTrace,
  recordOAuthTrace,
} from "./oauth-trace.ts";
import { TRACE_MEMORY_WARNING, TRACE_REFRESH_ERROR, createTraceRefreshController, traceOperationLabel, traceResultLabel } from "./oauth-trace-view.ts";

(globalThis as { __pgBootstrapPromise__?: Promise<void> }).__pgBootstrapPromise__ = Promise.resolve();

const PROFESSIONAL_ID = "17841400000000021";
const SECRET_MARKERS = ["short-lived-token", "long-lived-token", "old-token", "refreshed-token", "connect-secret", "instagram-app-secret", PROFESSIONAL_ID, "instagram_business_content_publish"];

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function memorySql(db: PGlite): Sql {
  const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await db.query(text, params)).rows as T[];
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

function assertNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const marker of SECRET_MARKERS) assert.equal(text.includes(marker), false, marker);
}

function quietGraph(refreshToken = "refreshed-token") {
  return {
    async exchangeCode() {
      throw new Error("unused");
    },
    async exchangeLongLived() {
      throw new Error("unused");
    },
    async refresh() {
      return { accessToken: refreshToken, expiresIn: 3600 };
    },
    async profile() {
      return { username: "klyvona_business", accountType: "BUSINESS", userId: PROFESSIONAL_ID, appScopedId: null };
    },
    async grantedPermissions() {
      return { documented: false as const };
    },
  };
}

function mockCallbackFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.instagram.com/oauth/access_token")) {
      return Response.json({
        data: [{
          access_token: "short-lived-token",
          user_id: PROFESSIONAL_ID,
          permissions: "instagram_business_basic,instagram_business_content_publish",
        }],
      });
    }
    if (url.includes("/access_token")) return Response.json({ access_token: "long-lived-token", expires_in: 3600 });
    if (url.includes("/me")) {
      return Response.json({ id: "39264341293211040", user_id: PROFESSIONAL_ID, username: "klyvona_business", account_type: "BUSINESS" });
    }
    return new Response("unexpected", { status: 404 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function seedClient(sql: Sql, stateId = "state-1", nonce = "nonce-value") {
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

async function runCallback(sql: Sql) {
  const { finishInstagramOAuth } = await import("./instagram.server.ts");
  const stateId = "state-1";
  const nonce = "nonce-value";
  const response = await finishInstagramOAuth(
    new Request(`http://127.0.0.1:8080/api/oauth/instagram/callback?code=once&state=${stateId}.${nonce}`, {
      headers: { cookie: `klyvona_ig_oauth=${stateId}` },
    }),
    undefined,
    sql,
  );
  assert.equal(response.headers.get("location"), "http://127.0.0.1:8080/connect?ready=1");
  const pending = await sql<{ id: string }>`select id from oauth_pending_accounts`;
  return pending[0]?.id ?? "";
}

function selectRequest(pendingId: string) {
  return new Request("http://127.0.0.1:8080/api/oauth/meta/select", {
    method: "POST",
    body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret", pendingId }),
  });
}

function customerRequest(path: string) {
  return new Request(`http://127.0.0.1:8080${path}`, {
    method: "POST",
    body: JSON.stringify({ reference: "KV-TEST", connectSecret: "connect-secret", platform: "instagram" }),
  });
}

describe("oauth diagnostic trace", () => {
  it("drops secrets, expires old rows and stays bounded", () => {
    clearOAuthTrace();
    recordOAuthTrace({
      operation: "instagram_callback",
      result: "success",
      grantStatus: "permissions_unknown",
      grantSource: "not_stored",
      permissionsPresent: false,
      accessToken: "short-lived-token",
      clientId: "client-1",
      permissions: "instagram_business_content_publish",
    } as never);
    const stored = readOAuthTrace();
    assert.equal(stored.length, 1);
    assert.deepEqual(Object.keys(stored[0] ?? {}).sort(), ["at", "grantSource", "grantStatus", "operation", "permissionsPresent", "result"]);
    assertNoSecrets(stored);
    clearOAuthTrace();
    recordOAuthTrace({
      operation: "instagram_callback",
      result: "success",
      grantStatus: "permissions_unknown",
      grantSource: "not_stored",
      permissionsPresent: false,
    }, new Date(Date.now() - 3 * 60 * 60 * 1000));
    assert.equal(readOAuthTrace().length, 0);
    clearOAuthTrace();
    for (let index = 0; index < OAUTH_TRACE_LIMIT + 5; index += 1) {
      recordOAuthTrace({
        operation: "permissions_checked",
        result: "success",
        grantStatus: "not_stored",
        grantSource: "not_stored",
        permissionsPresent: false,
      });
    }
    assert.equal(readOAuthTrace().length, OAUTH_TRACE_LIMIT);
    clearOAuthTrace();
  });

  it("refuses the trace to a non-admin and the server function checks admin access", () => {
    assert.throws(() => oauthTraceForAdmin({ isAdmin: false }), /forbidden/);
    const source = readFileSync(new URL("../admin.functions.ts", import.meta.url), "utf8");
    assert.match(source, /export const getOAuthTrace/);
    assert.match(source, /resolveAdminAccess/);
    assert.match(source, /oauthTraceForAdmin/);
    assert.doesNotMatch(source, /localStorage/);
    const page = readFileSync(new URL("../../routes/admin/index.tsx", import.meta.url), "utf8");
    assert.match(page, /רענון יומן האבחון/);
    assert.match(page, /getOAuthTrace\(\)/);
    assert.match(page, /createTraceRefreshController/);
    assert.match(page, /TRACE_MEMORY_WARNING/);
    assert.equal(TRACE_MEMORY_WARNING, "היומן נשמר בזיכרון השרת בלבד. אירועים עשויים להיעלם לאחר הפעלה מחדש או להופיע באופן חלקי כאשר הבקשות מטופלות בשרתים שונים. היעדר אירוע אינו מוכיח שהפעולה לא בוצעה.");
    assert.doesNotMatch(page, /setInterval/);
  });

  it("refreshes the admin trace once, keeps rows after an error, and records the refresh time", async () => {
    const row = {
      at: "2026-10-12T14:20:00.000Z",
      operation: "payload_transferred",
      result: "success",
      grantStatus: "permissions_confirmed",
      grantSource: "oauth_exchange",
      permissionsPresent: true,
    };
    const later = {
      ...row,
      at: "2026-10-12T14:28:01.000Z",
      operation: "permissions_checked",
      result: "error",
      grantStatus: "permissions_unknown",
      grantSource: "preserved_on_refresh",
      permissionsPresent: false,
    };
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const clock = new Date("2026-10-12T14:28:01.000Z");
    const controller = createTraceRefreshController(async () => {
      calls += 1;
      await gate;
      return [later, row];
    }, () => clock);
    const first = controller.refresh();
    assert.equal(controller.panel.loading, true);
    const blocked = await controller.refresh();
    assert.equal(calls, 1);
    assert.equal(blocked.loading, true);
    assert.equal(blocked.rows.length, 0);
    release();
    const loaded = await first;
    assert.equal(calls, 1);
    assert.deepEqual(loaded.rows.map((entry) => entry.at), ["2026-10-12T14:20:00.000Z", "2026-10-12T14:28:01.000Z"]);
    assert.equal(loaded.refreshedAt, "2026-10-12T14:28:01.000Z");
    assert.equal(loaded.loadError, null);
    assert.equal(traceOperationLabel("instagram_renew"), "חידוש אסימון");
    assert.equal(traceResultLabel("success"), "הצליח");
    assert.equal(traceResultLabel("error"), "נכשל");

    let fail = false;
    const durable = createTraceRefreshController(async () => {
      if (fail) throw new Error("short-lived-token");
      return [row];
    }, () => clock);
    const saved = await durable.refresh();
    fail = true;
    const kept = await durable.refresh();
    assert.deepEqual(kept.rows, saved.rows);
    assert.equal(kept.refreshedAt, saved.refreshedAt);
    assert.equal(kept.loadError, TRACE_REFRESH_ERROR);
    assert.equal(JSON.stringify(kept).includes("short-lived-token"), false);
  });

  it("records oauth, confirmation and the permission check", async () => {
    const restoreEnv = useTestEnv();
    const restoreFetch = mockCallbackFetch();
    const { db, sql } = await createDatabase();
    clearOAuthTrace();
    try {
      await seedClient(sql);
      const pendingId = await runCallback(sql);
      const { selectPendingAccount } = await import("./meta.server.ts");
      const { checkInstagramPublishPermission } = await import("./instagram.server.ts");
      const selected = await selectPendingAccount(selectRequest(pendingId), sql);
      assert.equal(selected.status, 200);
      const checked = await checkInstagramPublishPermission(customerRequest("/api/oauth/instagram/permissions"), quietGraph(), sql);
      assert.equal(checked.status, 200);
      const trace = readOAuthTrace();
      assert.deepEqual(trace.map((entry) => entry.operation), [
        "instagram_callback",
        "permissions_field",
        "pending_saved",
        "authorization_confirmed",
        "payload_transferred",
        "permissions_checked",
      ]);
      assert.equal(trace[1]?.permissionsPresent, true);
      assert.equal(trace[4]?.result, "success");
      assert.equal(trace[4]?.grantSource, "oauth_exchange");
      assert.equal(trace[5]?.grantStatus, "permissions_confirmed");
      assert.equal(trace[5]?.grantSource, "oauth_exchange");
      assertNoSecrets(trace);
      assert.deepEqual(oauthTraceForAdmin({ isAdmin: true }).map((entry) => entry.operation), trace.map((entry) => entry.operation));
    } finally {
      clearOAuthTrace();
      restoreFetch();
      restoreEnv();
      await db.close();
    }
  });

  it("shows renew after confirmation rewriting the grant source", async () => {
    const restoreEnv = useTestEnv();
    const restoreFetch = mockCallbackFetch();
    const { db, sql } = await createDatabase();
    clearOAuthTrace();
    try {
      await seedClient(sql);
      const pendingId = await runCallback(sql);
      const { selectPendingAccount } = await import("./meta.server.ts");
      const { checkInstagramPublishPermission, renewInstagram } = await import("./instagram.server.ts");
      assert.equal((await selectPendingAccount(selectRequest(pendingId), sql)).status, 200);
      assert.equal((await renewInstagram(customerRequest("/api/oauth/instagram/renew"), quietGraph(), sql)).status, 200);
      assert.equal((await checkInstagramPublishPermission(customerRequest("/api/oauth/instagram/permissions"), quietGraph(), sql)).status, 200);
      const trace = readOAuthTrace();
      const names = trace.map((entry) => entry.operation);
      assert.ok(names.indexOf("payload_transferred") < names.indexOf("instagram_renew"));
      assert.ok(names.indexOf("instagram_renew") < names.lastIndexOf("permissions_checked"));
      const renewed = trace.find((entry) => entry.operation === "instagram_renew");
      const checked = trace.filter((entry) => entry.operation === "permissions_checked").at(-1);
      assert.equal(renewed?.grantSource, "preserved_on_refresh");
      assert.equal(renewed?.grantStatus, "permissions_confirmed");
      assert.equal(renewed?.permissionsPresent, true);
      assert.equal(checked?.grantSource, "preserved_on_refresh");
      assert.equal(checked?.grantStatus, "permissions_confirmed");
      assertNoSecrets(trace);
    } finally {
      clearOAuthTrace();
      restoreFetch();
      restoreEnv();
      await db.close();
    }
  });

  it("shows a renew that happened before the new oauth is confirmed", async () => {
    const restoreEnv = useTestEnv();
    const restoreFetch = mockCallbackFetch();
    const { db, sql } = await createDatabase();
    clearOAuthTrace();
    try {
      const oldCipher = await sealSecret(JSON.stringify({
        v: 2,
        userToken: "old-token",
        igUserId: PROFESSIONAL_ID,
        username: "klyvona_business",
        grantStatus: "permissions_unknown",
        grantSource: "oauth_exchange",
      }));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"test@example.com"}, ${"0500000000"}, ${sha256Hex("connect-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
        values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${oldCipher})
      `;
      await sql`
        insert into oauth_states (id, client_id, platform, nonce_hash, expires_at)
        values (${"state-1"}, ${"client-1"}, ${"instagram"}, ${sha256Hex("nonce-value")}, ${new Date(Date.now() + 60_000).toISOString()})
      `;
      const { renewInstagram } = await import("./instagram.server.ts");
      const { selectPendingAccount } = await import("./meta.server.ts");
      assert.equal((await renewInstagram(customerRequest("/api/oauth/instagram/renew"), quietGraph(), sql)).status, 200);
      const pendingId = await runCallback(sql);
      assert.equal((await selectPendingAccount(selectRequest(pendingId), sql)).status, 200);
      const names = readOAuthTrace().map((entry) => entry.operation);
      assert.equal(names[0], "instagram_renew");
      assert.ok(names.indexOf("instagram_renew") < names.indexOf("authorization_confirmed"));
      const transferred = readOAuthTrace().find((entry) => entry.operation === "payload_transferred");
      assert.equal(transferred?.result, "success");
      assert.equal(transferred?.grantSource, "oauth_exchange");
      const stored = await sql<{ token_ciphertext: string }>`select token_ciphertext from social_accounts where id = ${"social-1"}`;
      const opened = JSON.parse(await openSecret(stored[0]?.token_ciphertext ?? "")) as { userToken?: string; grantSource?: string };
      assert.equal(opened.userToken, "long-lived-token");
      assert.equal(opened.grantSource, "oauth_exchange");
      assertNoSecrets(readOAuthTrace());
    } finally {
      clearOAuthTrace();
      restoreFetch();
      restoreEnv();
      await db.close();
    }
  });

  it("keeps the old token when confirmation fails", async () => {
    const restoreEnv = useTestEnv();
    const { db, sql } = await createDatabase();
    clearOAuthTrace();
    try {
      const oldCipher = await sealSecret(JSON.stringify({ v: 2, userToken: "old-token", igUserId: PROFESSIONAL_ID, grantSource: "preserved_on_refresh", grantStatus: "permissions_unknown" }));
      const otherCipher = await sealSecret(JSON.stringify({
        v: 2,
        userToken: "refreshed-token",
        igUserId: "17841400000000099",
        grantStatus: "permissions_confirmed",
        grantSource: "oauth_exchange",
        grantedPermissions: ["instagram_business_content_publish"],
      }));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"test@example.com"}, ${"0500000000"}, ${sha256Hex("connect-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
        values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${oldCipher})
      `;
      await sql`
        insert into oauth_pending_accounts (
          id, client_id, state_id, platform, external_account_id, display_name, eligible, token_ciphertext, expires_at
        ) values (
          ${"pending-1"}, ${"client-1"}, ${"state-1"}, ${"instagram"}, ${"17841400000000099"}, ${"other"}, ${true}, ${otherCipher},
          ${new Date(Date.now() + 60_000).toISOString()}
        )
      `;
      const { selectPendingAccount } = await import("./meta.server.ts");
      const response = await selectPendingAccount(selectRequest("pending-1"), sql);
      assert.equal(response.status, 409);
      const stored = await sql<{ token_ciphertext: string }>`select token_ciphertext from social_accounts where id = ${"social-1"}`;
      assert.equal(stored[0]?.token_ciphertext, oldCipher);
      const trace = readOAuthTrace();
      assert.deepEqual(trace.map((entry) => entry.operation), ["authorization_confirmed", "payload_transferred"]);
      assert.equal(trace.every((entry) => entry.result === "error"), true);
      assertNoSecrets(trace);
    } finally {
      clearOAuthTrace();
      restoreEnv();
      await db.close();
    }
  });

  it("does not let a late renew replace a newer saved token", async () => {
    const restoreEnv = useTestEnv();
    const { db, sql } = await createDatabase();
    clearOAuthTrace();
    try {
      const oldCipher = await sealSecret(JSON.stringify({
        v: 2,
        userToken: "old-token",
        igUserId: PROFESSIONAL_ID,
        grantStatus: "permissions_unknown",
        grantSource: "preserved_on_refresh",
      }));
      const newer = await sealSecret(JSON.stringify({
        v: 2,
        userToken: "long-lived-token",
        igUserId: PROFESSIONAL_ID,
        username: "klyvona_business",
        grantStatus: "permissions_confirmed",
        grantSource: "oauth_exchange",
        grantedPermissions: ["instagram_business_basic", "instagram_business_content_publish"],
      }));
      await sql`
        insert into clients (id, reference_code, contact_name, email, phone, connect_secret_hash)
        values (${"client-1"}, ${"KV-TEST"}, ${"Test"}, ${"test@example.com"}, ${"0500000000"}, ${sha256Hex("connect-secret")})
      `;
      await sql`
        insert into social_accounts (id, client_id, platform, status, external_account_id, token_ciphertext)
        values (${"social-1"}, ${"client-1"}, ${"instagram"}, ${"connected"}, ${PROFESSIONAL_ID}, ${oldCipher})
      `;
      const { renewInstagram } = await import("./instagram.server.ts");
      const swapped = {
        ...quietGraph(),
        async refresh() {
          await sql`update social_accounts set token_ciphertext = ${newer}, status = 'connected', last_error = null where id = ${"social-1"}`;
          return { accessToken: "refreshed-token", expiresIn: 3600 };
        },
      };
      const response = await renewInstagram(customerRequest("/api/oauth/instagram/renew"), swapped, sql);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 409);
      assert.equal(body.error, "token_replaced");
      assert.equal(body.kept, true);
      const stored = await sql<{ token_ciphertext: string; status: string }>`select token_ciphertext, status from social_accounts where id = ${"social-1"}`;
      assert.equal(stored[0]?.token_ciphertext, newer);
      assert.equal(stored[0]?.status, "connected");
      await sql`update social_accounts set token_ciphertext = ${oldCipher}, status = 'connected' where id = ${"social-1"}`;
      const failed = {
        ...quietGraph(),
        async refresh() {
          await sql`update social_accounts set token_ciphertext = ${newer} where id = ${"social-1"}`;
          throw new Error("temporary");
        },
      };
      const broken = await renewInstagram(customerRequest("/api/oauth/instagram/renew"), failed, sql);
      assert.equal(broken.status, 409);
      const after = await sql<{ token_ciphertext: string; status: string }>`select token_ciphertext, status from social_accounts where id = ${"social-1"}`;
      assert.equal(after[0]?.token_ciphertext, newer);
      assert.notEqual(after[0]?.status, "expired");
      assert.equal(readOAuthTrace().every((entry) => entry.result === "error"), true);
      assertNoSecrets(readOAuthTrace());
    } finally {
      clearOAuthTrace();
      restoreEnv();
      await db.close();
    }
  });
});
