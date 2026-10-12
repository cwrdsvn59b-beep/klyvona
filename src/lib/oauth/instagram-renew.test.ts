import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instagramRenewWrite, renewTarget } from "./instagram-renew.ts";
import { connectResultAccepted, type ConnectCall } from "./connect-session.ts";

describe("instagram renew target", () => {
  it("never selects the Facebook or Meta renew handler", async () => {
    assert.equal(renewTarget("instagram"), "instagram");
    assert.equal(renewTarget("facebook"), "meta");
    let metaCalls = 0;
    const run = async (platform: unknown) => {
      if (renewTarget(platform) === "instagram") return "instagram";
      metaCalls += 1;
      return "meta";
    };
    assert.equal(await run("instagram"), "instagram");
    assert.equal(metaCalls, 0);
  });

  it("stores the refreshed token and its expiry", () => {
    const now = Date.parse("2026-10-12T00:00:00.000Z");
    const saved = instagramRenewWrite({ accessToken: "refreshed-token", igUserId: "1789", expiresIn: 3600, now });
    assert.deepEqual(saved.tokenPayload, { v: 2, userToken: "refreshed-token", igUserId: "1789" });
    assert.equal(saved.expiresAt, "2026-10-12T01:00:00.000Z");
    assert.equal(instagramRenewWrite({ accessToken: "refreshed-token", igUserId: "1789", expiresIn: null, now }).expiresAt, null);
  });

  it("rejects renew errors without treating them as success", () => {
    const denied: ConnectCall = {
      ok: false,
      status: 409,
      body: { error: "reconnect_required" },
      networkError: false,
      invalidBody: false,
    };
    const disabled: ConnectCall = {
      ok: false,
      status: 503,
      body: { oauthActivated: false },
      networkError: false,
      invalidBody: false,
    };
    assert.equal(connectResultAccepted(denied, "renew"), false);
    assert.equal(connectResultAccepted(disabled, "renew"), false);
  });

  it("points the button at the Instagram handler and not Meta renew", () => {
    const page = readFileSync(new URL("../../routes/connect.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../routes/api/oauth/instagram/renew.ts", import.meta.url), "utf8");
    assert.match(page, /\/api\/oauth\/instagram\/renew/);
    assert.doesNotMatch(page, /\/api\/oauth\/meta\/renew/);
    assert.match(route, /renewInstagram/);
    assert.doesNotMatch(route, /renewMeta/);
  });
});
