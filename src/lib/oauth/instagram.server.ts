import { randomBytes, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { instagramRenewWrite, instagramTokenPayload } from "@/lib/oauth/instagram-renew";
import { openSecret, sealSecret } from "@/lib/crypto/tokens.server";
import {
  INSTAGRAM_GRAPH_URL,
  INSTAGRAM_TOKEN_URL,
  OAUTH_STATE_TTL_MS,
  assessInstagramLookup,
  configuredAppIds,
  evaluateOAuthState,
  instagramAccountEligible,
  instagramAuthorizeUrl,
  instagramCallbackOutcome,
  instagramCallbackUrl,
  instagramConfigProblem,
  instagramConnectReturn,
  instagramUsername,
  instagramPermissionVerdict,
  instagramVerifyVerdict,
  preserveInstagramIds,
  readInstagramProfile,
  readInstagramShortToken,
  resolveInstagramAccount,
  secretMatches,
  sha256Hex,
} from "@/lib/oauth/meta-guards";

const STATE_COOKIE = "klyvona_ig_oauth";
const PENDING_TTL_MS = 15 * 60 * 1000;

export type InstagramGraph = {
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    appId: string;
    appSecret: string;
  }): Promise<{ accessToken: string; userId: string }>;
  exchangeLongLived(input: {
    token: string;
    appSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number | null }>;
  refresh(token: string): Promise<{ accessToken: string; expiresIn: number | null }>;
  profile(token: string): Promise<{ username: string; accountType: string | null; userId: string | null; appScopedId: string | null }>;
  grantedPermissions?(token: string): Promise<
    { documented: false; reviewRequired?: boolean } | { documented: true; granted: string[]; reviewRequired?: boolean }
  >;
};

function appCredentials() {
  return {
    appId: process.env.INSTAGRAM_APP_ID?.trim() ?? "",
    appSecret: process.env.INSTAGRAM_APP_SECRET?.trim() ?? "",
  };
}

function disabled(): Response {
  return Response.json(
    {
      platform: "instagram",
      connectionStatus: "awaiting_setup",
      oauthActivated: false,
      message:
        "Instagram Login is disabled until the Instagram app id, app secret, encryption key, and persistent database are configured.",
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

function noStore(body: unknown, status = 200, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

export class InstagramRequestError extends Error {
  readonly kind: "auth" | "temporary";
  constructor(kind: "auth" | "temporary") {
    super(kind === "auth" ? "instagram_auth" : "instagram_temporary");
    this.kind = kind;
  }
}

function instagramFailureKind(status: number, body: Record<string, unknown>): "auth" | "temporary" | null {
  if (status >= 200 && status < 300 && typeof body.error !== "object" && typeof body.error_message !== "string") return null;
  const error = body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : {};
  const code = Number(error.code);
  const message = `${typeof error.message === "string" ? error.message : ""} ${typeof body.error_message === "string" ? body.error_message : ""}`;
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429 || status >= 500) return "temporary";
  if (status === 401 || status === 403 || code === 190 || /invalid oauth access token|session has expired|error validating access token/i.test(message)) {
    return "auth";
  }
  return "temporary";
}

async function readInstagramJson(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(preserveInstagramIds(raw)) as Record<string, unknown>;
  } catch {
    throw new Error("instagram_request_failed");
  }
  if (!response.ok || typeof body.error === "object" || typeof body.error_message === "string") {
    throw new Error("instagram_request_failed");
  }
  return body;
}

function tokenResult(payload: Record<string, unknown>) {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("instagram_token_missing");
  return {
    accessToken,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
  };
}

export const liveInstagramGraph: InstagramGraph = {
  async exchangeCode(input) {
    const payload = await readInstagramJson(
      await fetch(INSTAGRAM_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: input.appId,
          client_secret: input.appSecret,
          grant_type: "authorization_code",
          redirect_uri: input.redirectUri,
          code: input.code,
        }),
      }),
    );
    const token = readInstagramShortToken(payload);
    if (!token) throw new Error("instagram_token_missing");
    return token;
  },
  async exchangeLongLived(input) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/access_token`);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", input.appSecret);
    url.searchParams.set("access_token", input.token);
    return tokenResult(await readInstagramJson(await fetch(url)));
  },
  async refresh(token) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    return tokenResult(await readInstagramJson(await fetch(url)));
  },
  async profile(token) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/me`);
    url.searchParams.set("fields", "user_id,username,account_type,id");
    url.searchParams.set("access_token", token);
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new InstagramRequestError("temporary");
    }
    const raw = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(preserveInstagramIds(raw)) as Record<string, unknown>;
    } catch {
      throw new InstagramRequestError("temporary");
    }
    const kind = instagramFailureKind(response.status, body);
    if (kind) throw new InstagramRequestError(kind);
    return readInstagramProfile(body);
  },
  async grantedPermissions(token) {
    // Business Login documents the granted scope list only on the short-lived
    // code exchange. The long-lived token and /me do not return it, and
    // debug_token is not documented for this token family. No media call.
    void token;
    return { documented: false };
  },
};

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === STATE_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function stateCookie(id: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`;
}

async function clientForSecret(reference: string, connectSecret: string, sql?: Sql) {
  const db = sql ?? (await getSql());
  const rows = await db<{ id: string; connect_secret_hash: string | null }>`
    select id, connect_secret_hash from clients where reference_code = ${reference} limit 1
  `;
  const row = rows[0];
  if (!row || !secretMatches(connectSecret, row.connect_secret_hash)) return null;
  return row;
}

async function readConnectBody(request: Request, sql?: Sql) {
  let body: { reference?: unknown; connectSecret?: unknown; platform?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return null;
  }
  if (typeof body.reference !== "string" || typeof body.connectSecret !== "string") return null;
  const client = await clientForSecret(body.reference.trim(), body.connectSecret, sql);
  if (!client) return null;
  return { client, platform: body.platform === "instagram" ? "instagram" : "" };
}

function parseState(raw: string | null): { id: string; nonce: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  return { id: raw.slice(0, dot), nonce: raw.slice(dot + 1) };
}

export async function startInstagramOAuth(request: Request): Promise<Response> {
  if (instagramConfigProblem()) return disabled();
  const redirectUri = instagramCallbackUrl(request);
  if (!redirectUri) return disabled();
  const parsed = await readConnectBody(request);
  if (!parsed) return noStore({ error: "unauthorized" }, 401);

  const id = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  const sql = await getSql();
  await sql`
    insert into oauth_states (id, client_id, platform, nonce_hash, expires_at)
    values (
      ${id},
      ${parsed.client.id},
      ${"instagram"},
      ${sha256Hex(nonce)},
      ${new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()}
    )
  `;
  const authorizeUrl = instagramAuthorizeUrl({
    appId: appCredentials().appId,
    redirectUri,
    state: `${id}.${nonce}`,
  });
  const headers = new Headers();
  headers.append("set-cookie", stateCookie(id, request));
  return noStore({ oauthActivated: true, authorizeUrl }, 200, headers);
}

export async function finishInstagramOAuth(
  request: Request,
  graph: InstagramGraph = liveInstagramGraph,
  sql?: Sql,
): Promise<Response> {
  const url = new URL(request.url);
  const outcome = instagramCallbackOutcome(url.searchParams);
  if (outcome !== "ready") {
    return Response.redirect(new URL(instagramConnectReturn(outcome), url.origin), 303);
  }
  if (instagramConfigProblem()) return disabled();
  const redirectUri = instagramCallbackUrl(request);
  if (!redirectUri) return disabled();
  const back = (code: string) => Response.redirect(new URL(`/connect?error=${code}`, url.origin), 303);
  const parsed = parseState(url.searchParams.get("state"));
  const rawCode = url.searchParams.get("code");
  const code = rawCode?.replace(/#_$/, "") ?? "";
  if (!parsed || !code) return back("state");

  const db = sql ?? (await getSql());
  const rows = await db<{
    client_id: string;
    nonce_hash: string;
    expires_at: string;
    used_at: string | null;
    platform: string;
  }>`
    select client_id, nonce_hash, expires_at::text as expires_at, used_at::text as used_at, platform
    from oauth_states where id = ${parsed.id} limit 1
  `;
  const row = rows[0];
  const verdict = evaluateOAuthState({
    cookieStateId: cookieValue(request),
    stateId: parsed.id,
    nonce: parsed.nonce,
    storedHash: row?.nonce_hash ?? null,
    expiresAt: row ? new Date(row.expires_at) : null,
    usedAt: row?.used_at ? new Date(row.used_at) : null,
    now: new Date(),
  });
  if (verdict !== "ok" || !row || row.platform !== "instagram") return back(verdict === "ok" ? "state" : verdict);

  const consumed = await db<{ id: string }>`
    update oauth_states set used_at = now()
    where id = ${parsed.id} and used_at is null
    returning id
  `;
  if (!consumed[0]) return back("used");

  try {
    const { appId, appSecret } = appCredentials();
    const shortLived = await graph.exchangeCode({ code, redirectUri, appId, appSecret });
    const longLived = await graph.exchangeLongLived({ token: shortLived.accessToken, appSecret });
    const profile = await graph.profile(longLived.accessToken);
    const identity = resolveInstagramAccount({
      tokenUserId: shortLived.userId,
      profileUserId: profile.userId,
      profileAppScopedId: profile.appScopedId,
      appIds: configuredAppIds(),
    });
    if (!identity.ok) throw new Error("instagram_identity_rejected");
    const username = instagramUsername(profile.username);
    const eligible = instagramAccountEligible(profile.accountType);
    const packed = eligible
      ? await sealSecret(JSON.stringify(instagramTokenPayload({ accessToken: longLived.accessToken, igUserId: identity.userId, username })))
      : null;
    const expiresAt = longLived.expiresIn ? new Date(Date.now() + longLived.expiresIn * 1000).toISOString() : null;
    const pendingUntil = new Date(Date.now() + PENDING_TTL_MS).toISOString();
    const displayName = username || identity.userId;
    const existing = await db<{ id: string }>`
      select id from oauth_pending_accounts
      where client_id = ${row.client_id}
        and platform = 'instagram'
        and external_account_id = ${identity.userId}
      order by created_at desc
      limit 1
    `;
    if (existing[0]) {
      await db`
        update oauth_pending_accounts
        set state_id = ${parsed.id},
            display_name = ${displayName},
            eligible = ${eligible},
            ineligible_reason = ${eligible ? null : "חשבון Instagram אינו מקצועי."},
            token_ciphertext = ${packed},
            token_expires_at = ${expiresAt},
            expires_at = ${pendingUntil},
            created_at = now()
        where id = ${existing[0].id} and client_id = ${row.client_id}
      `;
    } else {
      await db`
        insert into oauth_pending_accounts (
          id, client_id, state_id, platform, external_account_id, display_name,
          eligible, ineligible_reason, token_ciphertext, token_expires_at, parent_external_id, expires_at
        ) values (
          ${randomUUID()},
          ${row.client_id},
          ${parsed.id},
          ${"instagram"},
          ${identity.userId},
          ${displayName},
          ${eligible},
          ${eligible ? null : "חשבון Instagram אינו מקצועי."},
          ${packed},
          ${expiresAt},
          ${null},
          ${pendingUntil}
        )
      `;
    }
  } catch (error) {
    console.error("[instagram] callback failed", error instanceof Error ? error.message : "error");
    return back("exchange");
  }
  return Response.redirect(new URL("/connect?ready=1", url.origin), 303);
}

/** Reads /me with the stored token and returns a verdict. Does not write the database or return the token. */
export async function previewInstagramIdentity(
  input: { tokenCiphertext: string | null; storedId: string },
  graph: InstagramGraph,
): Promise<{ status: "connected" | "missing_username" | "unconfirmed" | "reconnect"; publishUserId: string | null; username: string | null; persist: false }> {
  const appIds = configuredAppIds();
  if (!input.tokenCiphertext) {
    return assessInstagramLookup({ storedId: input.storedId, tokenReadable: false, lookup: "skipped", profile: null, appIds });
  }
  let token = "";
  try {
    const saved = JSON.parse(await openSecret(input.tokenCiphertext)) as { userToken?: unknown };
    token = typeof saved.userToken === "string" ? saved.userToken : "";
  } catch {
    return assessInstagramLookup({ storedId: input.storedId, tokenReadable: false, lookup: "skipped", profile: null, appIds });
  }
  if (!token) return assessInstagramLookup({ storedId: input.storedId, tokenReadable: false, lookup: "skipped", profile: null, appIds });
  try {
    const profile = await graph.profile(token);
    return assessInstagramLookup({ storedId: input.storedId, tokenReadable: true, lookup: "ok", profile, appIds });
  } catch {
    return assessInstagramLookup({ storedId: input.storedId, tokenReadable: true, lookup: "failed", profile: null, appIds });
  }
}

/** Explicit identity check. Does not update the stored id, token, or connection status. */
export async function verifyInstagramIdentity(
  request: Request,
  graph: InstagramGraph = liveInstagramGraph,
  sql?: Sql,
): Promise<Response> {
  if (instagramConfigProblem()) return disabled();
  const db = sql ?? (await getSql());
  const parsed = await readConnectBody(request, db);
  if (!parsed) return noStore({ error: "unauthorized" }, 401);
  const rows = await db<{ external_account_id: string | null; token_ciphertext: string | null }>`
    select external_account_id, token_ciphertext from social_accounts
    where client_id = ${parsed.client.id} and platform = ${"instagram"} limit 1
  `;
  const row = rows[0];
  const storedId = row?.external_account_id ?? "";
  const appIds = configuredAppIds();
  if (!row?.token_ciphertext) {
    return noStore({ ...instagramVerifyVerdict({ storedId, tokenReadable: false, failure: "none", profile: null, appIds }), persist: false });
  }
  let token = "";
  try {
    const saved = JSON.parse(await openSecret(row.token_ciphertext)) as { userToken?: unknown };
    token = typeof saved.userToken === "string" ? saved.userToken : "";
  } catch {
    token = "";
  }
  if (!token) {
    return noStore({ ...instagramVerifyVerdict({ storedId, tokenReadable: false, failure: "none", profile: null, appIds }), persist: false });
  }
  try {
    const profile = await graph.profile(token);
    return noStore({ ...instagramVerifyVerdict({ storedId, tokenReadable: true, failure: "none", profile, appIds }), persist: false });
  } catch (error) {
    const failure = error instanceof InstagramRequestError && error.kind === "auth" ? "auth" : "temporary";
    console.error("[instagram] verify failed", failure);
    return noStore({ ...instagramVerifyVerdict({ storedId, tokenReadable: true, failure, profile: null, appIds }), persist: false });
  }
}

/** Read-only publish-permission check. Never writes the database or creates media. */
export async function checkInstagramPublishPermission(
  request: Request,
  graph: InstagramGraph = liveInstagramGraph,
  sql?: Sql,
): Promise<Response> {
  if (instagramConfigProblem()) return disabled();
  const db = sql ?? (await getSql());
  const parsed = await readConnectBody(request, db);
  if (!parsed) return noStore({ error: "unauthorized" }, 401);
  const rows = await db<{ external_account_id: string | null; token_ciphertext: string | null; status: string }>`
    select external_account_id, token_ciphertext, status from social_accounts
    where client_id = ${parsed.client.id} and platform = ${"instagram"} limit 1
  `;
  const before = rows[0];
  const storedId = before?.external_account_id ?? "";
  const appIds = configuredAppIds();
  const checkedAt = new Date().toISOString();
  const finish = (
    identity: ReturnType<typeof instagramVerifyVerdict>,
    permissions: { documented: false; reviewRequired?: boolean } | { documented: true; granted: string[]; reviewRequired?: boolean } | null,
    failure: "none" | "auth" | "temporary",
  ) =>
    noStore({
      identity: identity.check,
      identityConfirmed: identity.identityConfirmed,
      username: identity.username,
      ...instagramPermissionVerdict({ identityConfirmed: identity.identityConfirmed, failure, permissions }),
      checkedAt,
      persist: false,
    });

  if (!before?.token_ciphertext) {
    const identity = instagramVerifyVerdict({ storedId, tokenReadable: false, failure: "none", profile: null, appIds });
    return finish(identity, null, "auth");
  }
  let token = "";
  try {
    const saved = JSON.parse(await openSecret(before.token_ciphertext)) as { userToken?: unknown };
    token = typeof saved.userToken === "string" ? saved.userToken : "";
  } catch {
    token = "";
  }
  if (!token) {
    const identity = instagramVerifyVerdict({ storedId, tokenReadable: false, failure: "none", profile: null, appIds });
    return finish(identity, null, "auth");
  }
  let failure: "none" | "auth" | "temporary" = "none";
  let profile: Awaited<ReturnType<InstagramGraph["profile"]>> | null = null;
  try {
    profile = await graph.profile(token);
  } catch (error) {
    failure = error instanceof InstagramRequestError && error.kind === "auth" ? "auth" : "temporary";
    console.error("[instagram] permission check failed", failure);
  }
  const identity = instagramVerifyVerdict({
    storedId,
    tokenReadable: true,
    failure,
    profile,
    appIds,
  });
  if (failure !== "none") return finish(identity, null, failure);
  let permissions: { documented: false; reviewRequired?: boolean } | { documented: true; granted: string[]; reviewRequired?: boolean } | null = null;
  try {
    permissions = graph.grantedPermissions ? await graph.grantedPermissions(token) : { documented: false };
  } catch (error) {
    const permissionFailure = error instanceof InstagramRequestError && error.kind === "auth" ? "auth" : "temporary";
    console.error("[instagram] permission check failed", permissionFailure);
    return finish(identity, null, permissionFailure);
  }
  return finish(identity, permissions, "none");
}

export async function renewInstagram(request: Request, graph: InstagramGraph = liveInstagramGraph): Promise<Response> {
  if (instagramConfigProblem()) return disabled();
  const parsed = await readConnectBody(request);
  if (!parsed || parsed.platform !== "instagram") return noStore({ error: "unauthorized" }, 401);
  const sql = await getSql();
  const rows = await sql<{ token_ciphertext: string | null }>`
    select token_ciphertext from social_accounts
    where client_id = ${parsed.client.id} and platform = ${"instagram"} limit 1
  `;
  const sealed = rows[0]?.token_ciphertext;
  if (!sealed) return noStore({ error: "reconnect_required" }, 409);
  try {
    const saved = JSON.parse(await openSecret(sealed)) as { v?: number; userToken?: string; igUserId?: string; username?: string };
    if (saved.v !== 2 || !saved.userToken || !saved.igUserId) return noStore({ error: "reconnect_required" }, 409);
    const renewed = await graph.refresh(saved.userToken);
    const record = instagramRenewWrite({
      accessToken: renewed.accessToken,
      igUserId: saved.igUserId,
      expiresIn: renewed.expiresIn,
      now: Date.now(),
      username: saved.username,
    });
    const packed = await sealSecret(JSON.stringify(record.tokenPayload));
    await sql`
      update social_accounts
      set status = 'connected', token_ciphertext = ${packed}, token_expires_at = ${record.expiresAt}, last_error = null
      where client_id = ${parsed.client.id} and platform = ${"instagram"}
    `;
    return noStore({ ok: true });
  } catch (error) {
    console.error("[instagram] renew failed", error instanceof Error ? error.message : "error");
    await sql`
      update social_accounts
      set status = 'expired', last_error = ${"ההרשאה פגה או בוטלה. יש לחבר מחדש."}
      where client_id = ${parsed.client.id} and platform = ${"instagram"}
    `;
    return noStore({ error: "reconnect_required" }, 409);
  }
}
