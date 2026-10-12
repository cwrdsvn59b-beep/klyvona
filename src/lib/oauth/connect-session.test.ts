import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountsFromBody,
  callConnect,
  canConnectInThisBrowser,
  connectResultAccepted,
  connectedFromBody,
  instagramConnectLists,
  readConnectReceipt,
} from "./connect-session.ts";

const receipt = { reference: "KV-1", connectSecret: "secret-value", businessName: "עסק" };

describe("same-browser onboarding receipt", () => {
  it("lets a new visitor connect only after this browser saved the receipt", () => {
    assert.equal(canConnectInThisBrowser(null), false);
    assert.equal(canConnectInThisBrowser("{"), false);
    assert.equal(canConnectInThisBrowser(JSON.stringify({ reference: "KV-1" })), false);
    assert.equal(canConnectInThisBrowser(JSON.stringify(receipt)), true);
    assert.deepEqual(readConnectReceipt(JSON.stringify(receipt))?.businessName, "עסק");
  });
});

describe("instagram list refresh", () => {
  it("shows one Instagram once and drops it from the pending list after it is saved", () => {
    const lists = instagramConnectLists(
      [
        { id: "p1", platform: "instagram", name: "klyvona_business", eligible: true, reason: null, externalAccountId: "1789" },
        { id: "p2", platform: "instagram", name: "klyvona_business", eligible: true, reason: null, externalAccountId: "1789" },
        { id: "fb", platform: "facebook", name: "Page", eligible: true, reason: null, externalAccountId: "99" },
      ],
      [
        { platform: "instagram", externalAccountId: "1789" },
        { platform: "instagram", externalAccountId: "1789" },
        { platform: "facebook", externalAccountId: "99" },
      ],
    );
    assert.deepEqual(lists.connected, [{ platform: "instagram", externalAccountId: "1789" }]);
    assert.deepEqual(lists.accounts, []);
  });

  it("keeps an unsaved Instagram pending and ignores a broken payload", () => {
    const lists = instagramConnectLists(
      accountsFromBody({
        accounts: [
          { id: "p1", platform: "instagram", name: "shop", eligible: true, reason: null, externalAccountId: "42" },
          { nope: true },
        ],
      }),
      connectedFromBody({ connected: "nope" }),
    );
    assert.equal(lists.accounts.length, 1);
    assert.equal(lists.connected.length, 0);
  });
});

describe("connect requests", () => {
  it("reports a rejected request without throwing", async () => {
    const result = await callConnect(async () => {
      throw new Error("offline");
    }, "/api/oauth/meta/disconnect", receipt, { platform: "instagram" });
    assert.equal(result.networkError, true);
    assert.equal(result.ok, false);
  });

  it("does not treat HTTP 200 with invalid JSON as a completed action", async () => {
    const result = await callConnect(
      async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
      "/api/oauth/meta/disconnect",
      receipt,
      { platform: "instagram" },
    );
    assert.equal(result.status, 200);
    assert.equal(result.networkError, false);
    assert.equal(result.invalidBody, true);
    assert.equal(result.ok, false);
    assert.equal(connectResultAccepted(result, "disconnect"), false);
  });

  it("rejects HTTP 200 when the JSON says ok false", async () => {
    const result = await callConnect(
      async () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
      "/api/oauth/meta/disconnect",
      receipt,
      { platform: "instagram" },
    );
    assert.equal(result.status, 200);
    assert.equal(result.invalidBody, false);
    assert.equal(connectResultAccepted(result, "disconnect"), false);
    assert.equal(connectResultAccepted(result, "renew"), false);
  });

  it("accepts each route only when its own contract is present", async () => {
    const disconnect = await callConnect(
      async () => new Response(JSON.stringify({ ok: true, platform: "instagram" }), { status: 200 }),
      "/api/oauth/meta/disconnect",
      receipt,
    );
    assert.equal(connectResultAccepted(disconnect, "disconnect"), true);
    const incomplete = await callConnect(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      "/api/oauth/meta/disconnect",
      receipt,
    );
    assert.equal(connectResultAccepted(incomplete, "disconnect"), false);
    const accounts = await callConnect(
      async () => new Response(JSON.stringify({ ok: false, accounts: [], connected: [] }), { status: 200 }),
      "/api/oauth/meta/accounts",
      receipt,
    );
    assert.equal(connectResultAccepted(accounts, "accounts"), false);
    const start = await callConnect(
      async () =>
        new Response(JSON.stringify({ ok: false, oauthActivated: true, authorizeUrl: "https://www.instagram.com/oauth/authorize" }), {
          status: 200,
        }),
      "/api/oauth/instagram/start",
      receipt,
    );
    assert.equal(connectResultAccepted(start, "start"), false);
    const renew = await callConnect(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      "/api/oauth/meta/renew",
      receipt,
    );
    assert.equal(connectResultAccepted(renew, "renew"), true);
  });

  it("reloads the saved list after a successful disconnect response", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith("/disconnect")) return new Response(JSON.stringify({ ok: true, platform: "instagram" }), { status: 200 });
      return new Response(
        JSON.stringify({
          accounts: [],
          connected: [],
        }),
        { status: 200 },
      );
    };
    const disconnected = await callConnect(fetchImpl, "/api/oauth/meta/disconnect", receipt, { platform: "instagram" });
    const refreshed = await callConnect(fetchImpl, "/api/oauth/meta/accounts", receipt);
    assert.equal(connectResultAccepted(disconnected, "disconnect"), true);
    assert.equal(connectResultAccepted(refreshed, "accounts"), true);
    const lists = instagramConnectLists(accountsFromBody(refreshed.body), connectedFromBody(refreshed.body));
    assert.deepEqual(calls, ["/api/oauth/meta/disconnect", "/api/oauth/meta/accounts"]);
    assert.deepEqual(lists.connected, []);
  });
});

describe("customer connect sequence", () => {
  it("covers receipt, start, save, refresh, re-entry and disconnect without calling Meta or a database", async () => {
    const stored = JSON.stringify(receipt);
    assert.equal(canConnectInThisBrowser(null), false);
    assert.equal(canConnectInThisBrowser(stored), true);

    const started = await callConnect(
      async () =>
        new Response(
          JSON.stringify({ oauthActivated: true, authorizeUrl: "https://www.instagram.com/oauth/authorize?response_type=code" }),
          { status: 200 },
        ),
      "/api/oauth/instagram/start",
      receipt,
    );
    assert.equal(connectResultAccepted(started, "start"), true);

    const pending = await callConnect(
      async () =>
        new Response(
          JSON.stringify({
            accounts: [{ id: "p1", platform: "instagram", name: "shop", eligible: true, reason: null, externalAccountId: "1789" }],
            connected: [],
          }),
          { status: 200 },
        ),
      "/api/oauth/meta/accounts",
      receipt,
    );
    assert.equal(connectResultAccepted(pending, "accounts"), true);
    assert.equal(instagramConnectLists(accountsFromBody(pending.body), connectedFromBody(pending.body)).accounts.length, 1);

    const saved = await callConnect(
      async () => new Response(JSON.stringify({ ok: true, platform: "instagram" }), { status: 200 }),
      "/api/oauth/meta/select",
      receipt,
      { pendingId: "p1" },
    );
    assert.equal(connectResultAccepted(saved, "select"), true);

    const visible = await callConnect(
      async () =>
        new Response(JSON.stringify({ accounts: [], connected: [{ platform: "instagram", externalAccountId: "1789" }] }), { status: 200 }),
      "/api/oauth/meta/accounts",
      receipt,
    );
    assert.deepEqual(instagramConnectLists(accountsFromBody(visible.body), connectedFromBody(visible.body)).connected, [
      { platform: "instagram", externalAccountId: "1789" },
    ]);
    assert.equal(canConnectInThisBrowser(stored), true);

    const removed = await callConnect(
      async () => new Response(JSON.stringify({ ok: true, platform: "instagram" }), { status: 200 }),
      "/api/oauth/meta/disconnect",
      receipt,
      { platform: "instagram" },
    );
    assert.equal(connectResultAccepted(removed, "disconnect"), true);
  });
});

describe("route inventory", () => {
  it("keeps the customer, admin and oauth routes that exist in the generated tree", () => {
    const tree = readFileSync(new URL("../../routeTree.gen.ts", import.meta.url), "utf8");
    for (const path of [
      "path: '/'",
      "path: '/connect'",
      "path: '/login'",
      "path: '/admin'",
      "path: '/clients/$clientId'",
      "path: '/api/auth/$'",
      "path: '/api/oauth/$provider/start'",
      "path: '/api/oauth/$provider/callback'",
      "path: '/api/oauth/meta/accounts'",
      "path: '/api/oauth/meta/select'",
      "path: '/api/oauth/meta/renew'",
      "path: '/api/oauth/instagram/renew'",
      "path: '/api/oauth/meta/disconnect'",
    ]) {
      assert.match(tree, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
