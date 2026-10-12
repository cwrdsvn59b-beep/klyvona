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
    assert.equal(connectResultAccepted(result), false);
  });

  it("accepts HTTP 200 only when the body is a JSON object", async () => {
    const result = await callConnect(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      "/api/oauth/meta/disconnect",
      receipt,
    );
    assert.equal(connectResultAccepted(result), true);
  });

  it("reloads the saved list after a successful disconnect response", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith("/disconnect")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(
        JSON.stringify({
          accounts: [],
          connected: [],
        }),
        { status: 200 },
      );
    };
    const disconnected = await callConnect(fetchImpl, "/api/oauth/meta/disconnect", receipt, { platform: "instagram" });
    assert.equal(disconnected.ok, true);
    const refreshed = await callConnect(fetchImpl, "/api/oauth/meta/accounts", receipt);
    const lists = instagramConnectLists(accountsFromBody(refreshed.body), connectedFromBody(refreshed.body));
    assert.deepEqual(calls, ["/api/oauth/meta/disconnect", "/api/oauth/meta/accounts"]);
    assert.deepEqual(lists.connected, []);
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
      "path: '/api/oauth/meta/disconnect'",
    ]) {
      assert.match(tree, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
