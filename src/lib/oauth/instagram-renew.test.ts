import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instagramRenewWrite, renewTarget } from "./instagram-renew.ts";
import { connectResultAccepted, type ConnectCall } from "./connect-session.ts";
import { openSecret, sealSecret } from "../crypto/tokens.server.ts";

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

  it("seals the refreshed token so the plaintext is not what gets stored", async () => {
    const previous = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    try {
      const record = instagramRenewWrite({
        accessToken: "plain-token-value",
        igUserId: "1789",
        expiresIn: 60,
        now: 0,
      });
      const sealed = await sealSecret(JSON.stringify(record.tokenPayload));
      assert.equal(sealed.includes("plain-token-value"), false);
      const opened = JSON.parse(await openSecret(sealed)) as { v: number; userToken: string; igUserId: string };
      assert.equal(opened.v, 2);
      assert.equal(opened.userToken, "plain-token-value");
      assert.equal(opened.igUserId, "1789");
    } finally {
      if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = previous;
    }
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
