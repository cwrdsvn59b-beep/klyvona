import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sealSecret, openSecret } from "../crypto/tokens.server.ts";
import {
  INSTAGRAM_SCOPES,
  classifyAccounts,
  evaluateOAuthState,
  facebookAuthorizeUrl,
  customerAccountConfigProblem,
  instagramAccountEligible,
  instagramAuthorizeUrl,
  instagramCallbackOutcome,
  instagramConfigProblem,
  instagramConnectReturn,
  metaConfigProblem,
  readInstagramShortToken,
  secretMatches,
  selectionAllowed,
  selectionWriteSucceeded,
  sha256Hex,
  visiblePendingAccounts,
} from "./meta-guards.ts";
import { findProvider } from "./providers.ts";

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

describe("instagram login", () => {
  it("builds the Facebook business login URL from the configuration id and without a scope", () => {
    const url = new URL(
      facebookAuthorizeUrl({
        appId: "meta-app",
        redirectUri: "https://spring-orbit-honey-baker.grok.me/api/oauth/facebook/callback",
        state: "state.nonce",
        configId: "business-config",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://www.facebook.com/v26.0/dialog/oauth");
    assert.equal(url.searchParams.get("client_id"), "meta-app");
    assert.equal(url.searchParams.get("config_id"), "business-config");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("override_default_response_type"), "true");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "https://spring-orbit-honey-baker.grok.me/api/oauth/facebook/callback",
    );
    assert.equal(url.searchParams.get("state"), "state.nonce");
    assert.equal(url.searchParams.get("scope"), null);
    assert.equal(url.searchParams.get("client_secret"), null);
  });

  it("uses Instagram credentials and business scopes, not the Facebook app", () => {
    const instagram = findProvider("instagram");
    const facebook = findProvider("facebook");
    assert.equal(instagram?.clientIdEnv, "INSTAGRAM_APP_ID");
    assert.equal(instagram?.clientSecretEnv, "INSTAGRAM_APP_SECRET");
    assert.equal(facebook?.clientIdEnv, "META_APP_ID");
    assert.equal(facebook?.clientSecretEnv, "META_APP_SECRET");
    assert.deepEqual([...INSTAGRAM_SCOPES], ["instagram_business_basic", "instagram_business_content_publish"]);
    assert.match(instagram?.authorizeUrl ?? "", /^https:\/\/www\.instagram\.com\/oauth\/authorize$/);
    assert.match(facebook?.authorizeUrl ?? "", /^https:\/\/www\.facebook\.com\//);
  });

  it("fails closed without Instagram credentials and does not accept Meta credentials instead", () => {
    assert.match(instagramConfigProblem({ META_APP_ID: "meta", META_APP_SECRET: "meta-secret" }) ?? "", /Instagram app credentials/);
    assert.match(
      metaConfigProblem({ INSTAGRAM_APP_ID: "ig", INSTAGRAM_APP_SECRET: "ig-secret" }) ?? "",
      /Meta app credentials/,
    );
  });

  it("builds the Instagram authorize URL without a secret and keeps the existing callback path", () => {
    const url = new URL(
      instagramAuthorizeUrl({
        appId: "ig-app",
        redirectUri: "https://spring-orbit-honey-baker.grok.me/api/oauth/instagram/callback",
        state: "state.nonce",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "https://spring-orbit-honey-baker.grok.me/api/oauth/instagram/callback");
    assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_content_publish");
    assert.equal(url.searchParams.get("client_secret"), null);
    assert.equal(url.searchParams.get("client_id"), "ig-app");
    assert.equal(url.hash, "#weblink");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "state.nonce");
    assert.equal(findProvider("facebook")?.authorizeUrl.includes("#weblink"), false);
  });

  it("keeps iPhone on the browser login and returns the customer to KLYVONA", () => {
    const started = new URL(
      instagramAuthorizeUrl({
        appId: "ig-app",
        redirectUri: "https://spring-orbit-honey-baker.grok.me/api/oauth/instagram/callback",
        state: "state.nonce",
      }),
    );
    assert.equal(started.hash, "#weblink");
    assert.equal(started.searchParams.get("redirect_uri")?.includes("#"), false);
    assert.equal(instagramCallbackOutcome(new URLSearchParams("error=access_denied")), "denied");
    assert.equal(instagramCallbackOutcome(new URLSearchParams("error=server_error")), "exchange");
    assert.equal(instagramCallbackOutcome(new URLSearchParams("state=state.nonce")), "state");
    assert.equal(instagramCallbackOutcome(new URLSearchParams("code=once&state=state.nonce")), "ready");
    assert.equal(instagramConnectReturn("denied"), "/connect?error=denied");
    assert.equal(instagramConnectReturn("exchange"), "/connect?error=exchange");
    assert.equal(instagramConnectReturn("ready"), "/connect?ready=1");
  });

  it("reads the short-lived token shape and rejects a personal account", () => {
    assert.deepEqual(
      readInstagramShortToken({ data: [{ access_token: "short", user_id: "1789", permissions: "instagram_business_basic" }] }),
      { accessToken: "short", userId: "1789" },
    );
    assert.equal(readInstagramShortToken({ access_token: "short" }), null);
    assert.equal(instagramAccountEligible("BUSINESS"), true);
    assert.equal(instagramAccountEligible("MEDIA_CREATOR"), true);
    assert.equal(instagramAccountEligible("PERSONAL"), false);
    assert.equal(instagramAccountEligible(null), false);
    assert.equal(instagramAccountEligible(""), false);
    assert.equal(instagramAccountEligible("UNKNOWN"), false);
  });
});

describe("instagram account save", () => {
  it("does not require the Facebook app to list or save an Instagram account", () => {
    const env = {
      INSTAGRAM_APP_ID: "ig-app",
      INSTAGRAM_APP_SECRET: "ig-secret",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    } as NodeJS.ProcessEnv;
    assert.equal(customerAccountConfigProblem(env), null);
    assert.match(metaConfigProblem(env) ?? "", /Meta app credentials/);
    const source = readFileSync(new URL("./meta.server.ts", import.meta.url), "utf8");
    const list = source.slice(source.indexOf("export async function listPendingAccounts"), source.indexOf("export async function selectPendingAccount"));
    const select = source.slice(source.indexOf("export async function selectPendingAccount"), source.indexOf("export async function disconnectMeta"));
    assert.match(list, /customerAccountConfigProblem/);
    assert.doesNotMatch(list, /metaConfigProblem/);
    assert.match(select, /customerAccountConfigProblem/);
    assert.doesNotMatch(select, /metaConfigProblem/);
  });

  it("does not report success when the account row was not updated", () => {
    assert.equal(selectionWriteSucceeded([]), false);
    assert.equal(selectionWriteSucceeded([{ platform: "" }]), false);
    assert.equal(selectionWriteSucceeded([{ platform: "instagram" }]), true);
    const source = readFileSync(new URL("./meta.server.ts", import.meta.url), "utf8");
    const select = source.slice(source.indexOf("export async function selectPendingAccount"), source.indexOf("export async function disconnectMeta"));
    assert.match(select, /returning platform/);
    assert.match(select, /selectionWriteSucceeded/);
    assert.match(select, /not_saved/);
  });
});

describe("instagram account list", () => {
  const row = {
    clientId: "client-a",
    platform: "instagram",
    externalAccountId: "1789",
    name: "klyvona_business",
    eligible: true,
    reason: null,
  };

  it("shows one card for repeated OAuth of the same Instagram account id", () => {
    const visible = visiblePendingAccounts([
      { ...row, id: "1", createdAt: "2026-10-11T10:00:00Z" },
      { ...row, id: "2", createdAt: "2026-10-11T11:00:00Z" },
      { ...row, id: "3", createdAt: "2026-10-11T12:00:00Z" },
      { ...row, id: "4", createdAt: "2026-10-11T13:00:00Z" },
    ]);
    assert.deepEqual(visible.map((item) => item.id), ["4"]);
  });

  it("does not treat the username as the unique key", () => {
    const visible = visiblePendingAccounts([
      { ...row, id: "1", createdAt: "2026-10-11T10:00:00Z", externalAccountId: "1789" },
      { ...row, id: "2", createdAt: "2026-10-11T11:00:00Z", externalAccountId: "1790" },
    ]);
    assert.deepEqual(visible.map((item) => item.externalAccountId).sort(), ["1789", "1790"]);
  });

  it("keeps another customer's identical Instagram id separate", () => {
    const visible = visiblePendingAccounts([
      { ...row, id: "1", createdAt: "2026-10-11T10:00:00Z" },
      { ...row, id: "2", clientId: "client-b", createdAt: "2026-10-11T11:00:00Z" },
    ]);
    assert.equal(visible.length, 2);
  });

  it("hides an account that is already saved for this customer", () => {
    const visible = visiblePendingAccounts(
      [
        { ...row, id: "1", createdAt: "2026-10-11T10:00:00Z" },
        { ...row, id: "2", createdAt: "2026-10-11T11:00:00Z" },
      ],
      [{ clientId: "client-a", platform: "instagram", externalAccountId: "1789" }],
    );
    assert.deepEqual(visible, []);
    const other = visiblePendingAccounts(
      [{ ...row, id: "1", createdAt: "2026-10-11T10:00:00Z" }],
      [{ clientId: "client-b", platform: "instagram", externalAccountId: "1789" }],
    );
    assert.equal(other.length, 1);
  });
});
