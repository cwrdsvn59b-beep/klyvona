import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sealSecret, openSecret } from "../crypto/tokens.server.ts";
import {
  classifyAccounts,
  evaluateOAuthState,
  metaConfigProblem,
  secretMatches,
  selectionAllowed,
  sha256Hex,
} from "./meta-guards.ts";

const now = new Date("2026-10-11T12:00:00Z");

describe("oauth state", () => {
  const nonce = "nonce-value";
  const base = {
    cookieStateId: "state-1",
    stateId: "state-1",
    nonce,
    storedHash: sha256Hex(nonce),
    expiresAt: new Date(now.getTime() + 60_000),
    usedAt: null,
    now,
  };

  it("accepts a matching unused state", () => {
    assert.equal(evaluateOAuthState(base), "ok");
  });

  it("rejects a missing cookie as csrf", () => {
    assert.equal(evaluateOAuthState({ ...base, cookieStateId: null }), "csrf");
  });

  it("rejects an expired callback", () => {
    assert.equal(evaluateOAuthState({ ...base, expiresAt: new Date(now.getTime() - 1) }), "expired");
  });

  it("rejects a single-use state that was already consumed", () => {
    assert.equal(evaluateOAuthState({ ...base, usedAt: now }), "used");
  });

  it("rejects a tampered nonce", () => {
    assert.equal(evaluateOAuthState({ ...base, nonce: "other" }), "mismatch");
  });
});

describe("account ownership", () => {
  it("allows only an eligible account owned by the same customer", () => {
    assert.equal(selectionAllowed({ ownerClientId: "a", pendingClientId: "a", eligible: true, expired: false }), "ok");
    assert.equal(selectionAllowed({ ownerClientId: "a", pendingClientId: "b", eligible: true, expired: false }), "foreign");
    assert.equal(selectionAllowed({ ownerClientId: "a", pendingClientId: "a", eligible: false, expired: false }), "ineligible");
  });

  it("marks a personal Instagram account without a professional link as ineligible", () => {
    const accounts = classifyAccounts({ id: "page", name: "Shop", tasks: ["CREATE_CONTENT"], instagram: null });
    assert.equal(accounts.find((account) => account.platform === "instagram")?.eligible, false);
  });

  it("rejects a connect secret that does not match the stored hash", () => {
    assert.equal(secretMatches("right-secret", sha256Hex("right-secret")), true);
    assert.equal(secretMatches("wrong-secret", sha256Hex("right-secret")), false);
  });
});

describe("configuration and encryption", () => {
  it("fails closed when Meta secrets or the encryption key are missing", () => {
    assert.match(metaConfigProblem({}) ?? "", /Meta app credentials/);
    assert.match(
      metaConfigProblem({ META_APP_ID: "app", META_APP_SECRET: "secret" }) ?? "",
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it("fails closed in production without a database", () => {
    const problem = metaConfigProblem({
      GROK_PROJECT_ID: "proj",
      META_APP_ID: "app",
      META_APP_SECRET: "secret",
      TOKEN_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32)).toString("base64"),
      BETTER_AUTH_URL: "https://spring-orbit-honey-baker.grok.me",
    });
    assert.match(problem ?? "", /DATABASE_URL/);
  });

  it("seals a token and refuses to seal when the key is missing", async () => {
    const key = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
    process.env.TOKEN_ENCRYPTION_KEY = key;
    const sealed = await sealSecret("page-token");
    assert.equal(sealed.includes("page-token"), false);
    assert.equal(await openSecret(sealed), "page-token");
    delete process.env.TOKEN_ENCRYPTION_KEY;
    await assert.rejects(sealSecret("page-token"), /TOKEN_ENCRYPTION_KEY/);
  });
});
