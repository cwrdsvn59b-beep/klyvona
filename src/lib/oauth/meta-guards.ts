import { createHash, timingSafeEqual } from "node:crypto";
import { productionDatabaseProblem } from "../../../scripts/db-mode.mjs";

/** Latest stable Graph API version as of the Meta changelog dated 29 July 2026. */
export const META_GRAPH_VERSION = "v26.0";

export const META_AUTHORIZE_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const META_TOKEN_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`;
export const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export function facebookAuthorizeUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
  configId: string;
}): string {
  const url = new URL(META_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("config_id", input.configId);
  return url.toString();
}

/**
 * Permissions required for a person who manages their own Page and a linked
 * Instagram professional account. business_management is only for system users
 * and is intentionally not requested.
 */
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
] as const;

export const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const PUBLISH_TASKS = new Set(["CREATE_CONTENT", "MANAGE", "PROFILE_PLUS_CREATE_CONTENT", "PROFILE_PLUS_FULL_CONTROL"]);

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secretMatches(raw: string, hash: string | null | undefined): boolean {
  if (!hash || !raw) return false;
  const actual = Buffer.from(sha256Hex(raw), "utf8");
  const expected = Buffer.from(hash, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function encryptionKeyReady(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

export function metaConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const database = productionDatabaseProblem(env);
  if (database) return database;
  if (!env.META_APP_ID?.trim() || !env.META_APP_SECRET?.trim()) {
    return "Meta app credentials are not configured.";
  }
  if (!encryptionKeyReady(env.TOKEN_ENCRYPTION_KEY)) {
    return "TOKEN_ENCRYPTION_KEY is not configured.";
  }
  const published = Boolean(env.GROK_PROJECT_ID?.trim()) || env.VERCEL_ENV === "production";
  if (published && !env.BETTER_AUTH_URL?.trim() && !env.META_OAUTH_REDIRECT_ORIGIN?.trim()) {
    return "The public OAuth callback origin is not configured.";
  }
  return null;
}

export function instagramConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const database = productionDatabaseProblem(env);
  if (database) return database;
  if (!env.INSTAGRAM_APP_ID?.trim() || !env.INSTAGRAM_APP_SECRET?.trim()) {
    return "Instagram app credentials are not configured.";
  }
  if (!encryptionKeyReady(env.TOKEN_ENCRYPTION_KEY)) {
    return "TOKEN_ENCRYPTION_KEY is not configured.";
  }
  const published = Boolean(env.GROK_PROJECT_ID?.trim()) || env.VERCEL_ENV === "production";
  if (published && !env.BETTER_AUTH_URL?.trim() && !env.META_OAUTH_REDIRECT_ORIGIN?.trim()) {
    return "The public OAuth callback origin is not configured.";
  }
  return null;
}

export function instagramCallbackUrl(request: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.META_OAUTH_REDIRECT_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim();
  const origin = explicit ? explicit.replace(/\/$/, "") : instagramConfigProblem(env) ? null : new URL(request.url).origin;
  if (!origin) return null;
  return `${origin}/api/oauth/instagram/callback`;
}

export function instagramAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", input.state);
  // Instagram's own apple-app-site-association excludes the "weblink" fragment,
  // so iOS keeps the login page in the browser instead of opening the app.
  url.hash = "weblink";
  return url.toString();
}

export type InstagramCallbackOutcome = "denied" | "exchange" | "state" | "ready";

export function instagramCallbackOutcome(search: { get(name: string): string | null }): InstagramCallbackOutcome {
  const error = search.get("error");
  if (error === "access_denied") return "denied";
  if (error) return "exchange";
  const state = search.get("state");
  const code = (search.get("code") ?? "").replace(/#_$/, "");
  if (!state || !state.includes(".") || !code) return "state";
  return "ready";
}

export function instagramConnectReturn(outcome: InstagramCallbackOutcome): string {
  if (outcome === "ready") return "/connect?ready=1";
  return `/connect?error=${outcome}`;
}

export function readInstagramShortToken(payload: unknown): { accessToken: string; userId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const entry = Array.isArray(record.data) ? record.data[0] : record;
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const accessToken = typeof row.access_token === "string" ? row.access_token : "";
  const userId =
    typeof row.user_id === "string" || typeof row.user_id === "number" ? String(row.user_id) : "";
  if (!accessToken || !userId) return null;
  return { accessToken, userId };
}

export function instagramAccountEligible(accountType: string | null): boolean {
  if (!accountType) return true;
  const value = accountType.toUpperCase();
  return value === "BUSINESS" || value === "MEDIA_CREATOR";
}

export type StateVerdict = "ok" | "missing" | "mismatch" | "expired" | "used" | "csrf";

export function evaluateOAuthState(input: {
  cookieStateId: string | null;
  stateId: string;
  nonce: string;
  storedHash: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  now: Date;
}): StateVerdict {
  if (!input.cookieStateId || input.cookieStateId !== input.stateId) return "csrf";
  if (!input.storedHash || !input.expiresAt) return "missing";
  if (!secretMatches(input.nonce, input.storedHash)) return "mismatch";
  if (input.usedAt) return "used";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "ok";
}

export function pageCanPublish(tasks: readonly string[]): boolean {
  return tasks.some((task) => PUBLISH_TASKS.has(task));
}

export function classifyAccounts(page: {
  id: string;
  name: string;
  tasks: readonly string[];
  instagram: { id: string; username: string } | null;
}): Array<{
  platform: "facebook" | "instagram";
  externalAccountId: string;
  displayName: string;
  eligible: boolean;
  reason: string | null;
  parentExternalId: string | null;
}> {
  const canPublish = pageCanPublish(page.tasks);
  const facebook = {
    platform: "facebook" as const,
    externalAccountId: page.id,
    displayName: page.name,
    eligible: canPublish,
    reason: canPublish ? null : "אין הרשאת פרסום לעמוד הזה.",
    parentExternalId: null,
  };
  if (!page.instagram) {
    return [
      facebook,
      {
        platform: "instagram",
        externalAccountId: `missing:${page.id}`,
        displayName: page.name,
        eligible: false,
        reason: "לעמוד אין חשבון Instagram מקצועי מחובר.",
        parentExternalId: page.id,
      },
    ];
  }
  return [
    facebook,
    {
      platform: "instagram",
      externalAccountId: page.instagram.id,
      displayName: page.instagram.username || page.name,
      eligible: canPublish,
      reason: canPublish ? null : "אין הרשאת פרסום לחשבון Instagram המחובר לעמוד.",
      parentExternalId: page.id,
    },
  ];
}

export function selectionAllowed(input: {
  ownerClientId: string;
  pendingClientId: string;
  eligible: boolean;
  expired: boolean;
}): "ok" | "foreign" | "ineligible" | "expired" {
  if (input.ownerClientId !== input.pendingClientId) return "foreign";
  if (input.expired) return "expired";
  if (!input.eligible) return "ineligible";
  return "ok";
}

export type PendingCandidate = {
  id: string;
  clientId: string;
  platform: string;
  externalAccountId: string;
  createdAt: string;
  name: string;
  eligible: boolean;
  reason: string | null;
};

/** One row per customer, platform and Instagram/Facebook account id. Username is not the key. */
export function visiblePendingAccounts(
  rows: readonly PendingCandidate[],
  connected: readonly { clientId: string; platform: string; externalAccountId: string }[] = [],
): PendingCandidate[] {
  const connectedKeys = new Set(
    connected.map((row) => `${row.clientId}\0${row.platform}\0${row.externalAccountId}`),
  );
  const best = new Map<string, PendingCandidate>();
  for (const row of rows) {
    const key = `${row.clientId}\0${row.platform}\0${row.externalAccountId}`;
    if (connectedKeys.has(key)) continue;
    const current = best.get(key);
    if (!current || row.createdAt > current.createdAt) best.set(key, row);
  }
  return [...best.values()];
}
