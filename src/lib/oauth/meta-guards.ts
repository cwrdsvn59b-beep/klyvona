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

/** Keep Instagram ids as strings. JSON numbers above 2^53-1 are rounded. */
export function preserveInstagramIds(raw: string): string {
  return raw.replace(/"(user_id|id)"\s*:\s*(\d{1,32})/g, '"$1":"$2"');
}

export function readInstagramUserId(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,32}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

export type InstagramGrantStatus = "permissions_confirmed" | "permissions_missing" | "permissions_unknown";

const INSTAGRAM_SCOPE_NAME = /^[a-z0-9_]{1,64}$/;

/** Parses the documented comma-separated permissions string. Any other shape is unknown, not a denial. */
export function readInstagramGrant(value: unknown): { status: InstagramGrantStatus; granted: string[] } {
  if (typeof value !== "string" || value.trim() === "") return { status: "permissions_unknown", granted: [] };
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !INSTAGRAM_SCOPE_NAME.test(part))) return { status: "permissions_unknown", granted: [] };
  const granted = [...new Set(parts)];
  if (granted.includes("instagram_business_content_publish")) return { status: "permissions_confirmed", granted };
  return { status: "permissions_missing", granted };
}

export function readStoredInstagramGrant(payload: unknown): {
  status: InstagramGrantStatus;
  source: "oauth_exchange" | "preserved_on_refresh" | "not_stored";
  granted: string[];
} {
  if (!payload || typeof payload !== "object") return { status: "permissions_unknown", source: "not_stored", granted: [] };
  const row = payload as Record<string, unknown>;
  if (!("grantStatus" in row) && !("grantedPermissions" in row)) return { status: "permissions_unknown", source: "not_stored", granted: [] };
  const source = row.grantSource === "oauth_exchange" || row.grantSource === "preserved_on_refresh" ? row.grantSource : "not_stored";
  if (!Array.isArray(row.grantedPermissions) || row.grantedPermissions.some((item) => typeof item !== "string")) {
    return { status: "permissions_unknown", source, granted: [] };
  }
  const parsed = readInstagramGrant(row.grantedPermissions.join(","));
  return { status: parsed.status, source, granted: parsed.granted };
}

export function readInstagramShortToken(payload: unknown): { accessToken: string; userId: string; grant: { status: InstagramGrantStatus; granted: string[] } } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const entry = Array.isArray(record.data) ? record.data[0] : record;
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const accessToken = typeof row.access_token === "string" ? row.access_token : "";
  const userId = readInstagramUserId(row.user_id);
  if (!accessToken || !userId) return null;
  return { accessToken, userId, grant: readInstagramGrant("permissions" in row ? row.permissions : undefined) };
}

export function instagramUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(name) || !/[A-Za-z]/.test(name)) return null;
  return name;
}

export function configuredAppIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([env.INSTAGRAM_APP_ID, env.META_APP_ID].map((id) => id?.trim() ?? "").filter((id) => /^\d{1,32}$/.test(id)))];
}

export function readInstagramProfile(payload: unknown): {
  username: string;
  accountType: string | null;
  userId: string | null;
  appScopedId: string | null;
} {
  if (!payload || typeof payload !== "object") return { username: "", accountType: null, userId: null, appScopedId: null };
  const record = payload as Record<string, unknown>;
  const entry = Array.isArray(record.data) ? record.data[0] : record;
  if (!entry || typeof entry !== "object") return { username: "", accountType: null, userId: null, appScopedId: null };
  const row = entry as Record<string, unknown>;
  return {
    username: typeof row.username === "string" ? row.username : "",
    accountType: typeof row.account_type === "string" ? row.account_type : null,
    userId: readInstagramUserId(row.user_id),
    appScopedId: readInstagramUserId(row.id),
  };
}

/**
 * Publishing uses /me user_id, the professional Instagram account id.
 * /me id is only the app-scoped id and is not a publish target.
 * Neither value is accepted when it equals a configured app id.
 */
export function resolveInstagramAccount(input: {
  tokenUserId: string | null;
  profileUserId: string | null;
  profileAppScopedId?: string | null;
  appIds: readonly string[];
}): { ok: true; userId: string } | { ok: false; reason: "app_id" | "missing" | "not_publishable" } {
  const blocked = new Set(input.appIds.map((id) => id.trim()).filter(Boolean));
  const professional = readInstagramUserId(input.profileUserId);
  const scoped = readInstagramUserId(input.profileAppScopedId ?? null);
  if (professional && !blocked.has(professional)) return { ok: true, userId: professional };
  if (professional && blocked.has(professional)) return { ok: false, reason: "app_id" };
  if (scoped && blocked.has(scoped)) return { ok: false, reason: "app_id" };
  if (scoped) return { ok: false, reason: "not_publishable" };
  const token = readInstagramUserId(input.tokenUserId);
  if (token && blocked.has(token)) return { ok: false, reason: "app_id" };
  return { ok: false, reason: "missing" };
}

export type InstagramConnectionStatus = "connected" | "missing_username" | "unconfirmed" | "reconnect";

export function usernameFromTokenPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  return instagramUsername((payload as { username?: unknown }).username);
}

/** Missing username does not invalidate a readable token or a non-app account id. */
export function classifyInstagramConnection(input: {
  storedId: string;
  username: string | null;
  tokenReadable: boolean;
  appIds: readonly string[];
}): { status: InstagramConnectionStatus; externalAccountId: string; name?: string; trusted: boolean } {
  const id = input.storedId.trim();
  const blocked = new Set(input.appIds.map((item) => item.trim()).filter(Boolean));
  const username = instagramUsername(input.username);
  const publishable = /^\d{5,32}$/.test(id) && !blocked.has(id);
  if (!input.tokenReadable) return { status: "reconnect", externalAccountId: publishable ? id : "", trusted: false };
  if (!publishable) return { status: "unconfirmed", externalAccountId: "", trusted: false };
  if (!username) return { status: "missing_username", externalAccountId: id, trusted: false };
  return { status: "connected", externalAccountId: id, name: username, trusted: true };
}

/** Interprets a /me lookup. Never instructs the caller to write the database. */
export function assessInstagramLookup(input: {
  storedId: string;
  tokenReadable: boolean;
  lookup: "skipped" | "ok" | "failed";
  profile: { userId: string | null; appScopedId: string | null; username: string } | null;
  appIds: readonly string[];
}): { status: InstagramConnectionStatus; publishUserId: string | null; username: string | null; persist: false } {
  if (!input.tokenReadable) return { status: "reconnect", publishUserId: null, username: null, persist: false };
  if (input.lookup !== "ok" || !input.profile) {
    const local = classifyInstagramConnection({
      storedId: input.storedId,
      username: null,
      tokenReadable: true,
      appIds: input.appIds,
    });
    return { status: local.status, publishUserId: local.externalAccountId || null, username: null, persist: false };
  }
  const resolved = resolveInstagramAccount({
    tokenUserId: null,
    profileUserId: input.profile.userId,
    profileAppScopedId: input.profile.appScopedId,
    appIds: input.appIds,
  });
  const username = instagramUsername(input.profile.username);
  if (!resolved.ok) return { status: "unconfirmed", publishUserId: null, username, persist: false };
  return { status: username ? "connected" : "missing_username", publishUserId: resolved.userId, username, persist: false };
}

export type InstagramVerifyCheck =
  | "identity_confirmed"
  | "identity_unconfirmed"
  | "identity_mismatch"
  | "reconnect"
  | "temporary_error";

/** A /me response can confirm identity. It does not prove the publish permission. */
export function instagramVerifyVerdict(input: {
  storedId: string;
  tokenReadable: boolean;
  failure: "none" | "auth" | "temporary";
  profile: { userId: string | null; appScopedId: string | null; username: string; accountType: string | null } | null;
  appIds: readonly string[];
}): {
  check: InstagramVerifyCheck;
  username: string | null;
  identityConfirmed: boolean;
  tokenSaved: boolean;
  publishingAllowed: false;
  publishing: "not_verified";
  accountEligible: boolean;
} {
  const base = { publishingAllowed: false as const, publishing: "not_verified" as const };
  const username = instagramUsername(input.profile?.username);
  const accountEligible = instagramAccountEligible(input.profile?.accountType ?? null);
  if (!input.tokenReadable) {
    return { ...base, check: "reconnect", username: null, identityConfirmed: false, tokenSaved: false, accountEligible: false };
  }
  if (input.failure === "temporary") {
    return { ...base, check: "temporary_error", username: null, identityConfirmed: false, tokenSaved: true, accountEligible: false };
  }
  if (input.failure === "auth") {
    return { ...base, check: "reconnect", username: null, identityConfirmed: false, tokenSaved: true, accountEligible: false };
  }
  const resolved = resolveInstagramAccount({
    tokenUserId: null,
    profileUserId: input.profile?.userId ?? null,
    profileAppScopedId: input.profile?.appScopedId ?? null,
    appIds: input.appIds,
  });
  if (!resolved.ok || !accountEligible) {
    return { ...base, check: "identity_unconfirmed", username, identityConfirmed: false, tokenSaved: true, accountEligible };
  }
  if (resolved.userId !== input.storedId.trim()) {
    return { ...base, check: "identity_mismatch", username, identityConfirmed: false, tokenSaved: true, accountEligible };
  }
  return { ...base, check: "identity_confirmed", username, identityConfirmed: true, tokenSaved: true, accountEligible: true };
}

export type InstagramPermissionCheck =
  | "permission_confirmed"
  | "permission_missing"
  | "verification_unavailable"
  | "app_review_required"
  | "temporary_error";

/**
 * A granted scope is confirmed only from a documented live permission list.
 * The authorize URL and a successful /me response are not that list.
 * Confirming the scope still does not mean a post was published.
 */
export function instagramPermissionVerdict(input: {
  identityConfirmed: boolean;
  failure: "none" | "auth" | "temporary";
  permissions: { documented: false; reviewRequired?: boolean } | { documented: true; granted: readonly string[]; reviewRequired?: boolean } | null;
}): { permission: InstagramPermissionCheck; publishingTested: false; contentCreated: false } {
  const base = { publishingTested: false as const, contentCreated: false as const };
  if (input.failure === "temporary") return { ...base, permission: "temporary_error" };
  if (input.failure === "auth" || !input.identityConfirmed) return { ...base, permission: "verification_unavailable" };
  if (input.permissions?.reviewRequired) return { ...base, permission: "app_review_required" };
  if (!input.permissions?.documented) return { ...base, permission: "verification_unavailable" };
  const granted = new Set(input.permissions.granted);
  if (granted.has("instagram_business_content_publish")) return { ...base, permission: "permission_confirmed" };
  return { ...base, permission: "permission_missing" };
}

export function instagramAccountEligible(accountType: string | null): boolean {
  if (!accountType) return false;
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
  authorizationRefresh?: boolean;
};

/** One row per customer, platform and Instagram account id. A matching saved id stays visible so the customer can confirm a new grant. */
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
    const next = { ...row, authorizationRefresh: connectedKeys.has(key) };
    const current = best.get(key);
    if (!current || row.createdAt > current.createdAt) best.set(key, next);
  }
  return [...best.values()];
}
