import { randomBytes, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/crypto/tokens.server";
import {
  INSTAGRAM_GRAPH_URL,
  INSTAGRAM_TOKEN_URL,
  OAUTH_STATE_TTL_MS,
  evaluateOAuthState,
  instagramAccountEligible,
  instagramAuthorizeUrl,
  instagramCallbackUrl,
  instagramConfigProblem,
  readInstagramShortToken,
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
  profile(token: string): Promise<{ username: string; accountType: string | null }>;
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

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
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
    const payload = await readJson(
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
    return tokenResult(await readJson(await fetch(url)));
  },
  async refresh(token) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    return tokenResult(await readJson(await fetch(url)));
  },
  async profile(token) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/me`);
    url.searchParams.set("fields", "user_id,username,account_type");
    url.searchParams.set("access_token", token);
    const payload = await readJson(await fetch(url));
    return {
      username: typeof payload.username === "string" ? payload.username : "",
      accountType: typeof payload.account_type === "string" ? payload.account_type : null,
    };
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

async function clientForSecret(reference: string, connectSecret: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; connect_secret_hash: string | null }>`
    select id, connect_secret_hash from clients where reference_code = ${reference} limit 1
  `;
  const row = rows[0];
  if (!row || !secretMatches(connectSecret, row.connect_secret_hash)) return null;
  return row;
}

async function readConnectBody(request: Request) {
  let body: { reference?: unknown; connectSecret?: unknown; platform?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return null;
  }
  if (typeof body.reference !== "string" || typeof body.connectSecret !== "string") return null;
  const client = await clientForSecret(body.reference.trim(), body.connectSecret);
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
): Promise<Response> {
  const url = new URL(request.url);
  const back = (code: string) => Response.redirect(new URL(`/connect?error=${code}`, url.origin), 303);
  if (url.searchParams.get("error")) return back("denied");
  if (instagramConfigProblem()) return disabled();
  const redirectUri = instagramCallbackUrl(request);
  if (!redirectUri) return disabled();
  const parsed = parseState(url.searchParams.get("state"));
  const rawCode = url.searchParams.get("code");
  const code = rawCode?.replace(/#_$/, "") ?? "";
  if (!parsed || !code) return back("state");

  const sql = await getSql();
  const rows = await sql<{
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

  const consumed = await sql<{ id: string }>`
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
    const eligible = instagramAccountEligible(profile.accountType);
    const packed = eligible
      ? await sealSecret(JSON.stringify({ v: 2, userToken: longLived.accessToken, igUserId: shortLived.userId }))
      : null;
    const expiresAt = longLived.expiresIn ? new Date(Date.now() + longLived.expiresIn * 1000).toISOString() : null;
    await sql`
      insert into oauth_pending_accounts (
        id, client_id, state_id, platform, external_account_id, display_name,
        eligible, ineligible_reason, token_ciphertext, token_expires_at, parent_external_id, expires_at
      ) values (
        ${randomUUID()},
        ${row.client_id},
        ${parsed.id},
        ${"instagram"},
        ${shortLived.userId},
        ${profile.username || shortLived.userId},
        ${eligible},
        ${eligible ? null : "חשבון Instagram אינו מקצועי."},
        ${packed},
        ${expiresAt},
        ${null},
        ${new Date(Date.now() + PENDING_TTL_MS).toISOString()}
      )
    `;
  } catch (error) {
    console.error("[instagram] callback failed", error instanceof Error ? error.message : "error");
    return back("exchange");
  }
  return Response.redirect(new URL("/connect?ready=1", url.origin), 303);
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
    const saved = JSON.parse(await openSecret(sealed)) as { v?: number; userToken?: string; igUserId?: string };
    if (saved.v !== 2 || !saved.userToken || !saved.igUserId) return noStore({ error: "reconnect_required" }, 409);
    const renewed = await graph.refresh(saved.userToken);
    const packed = await sealSecret(JSON.stringify({ v: 2, userToken: renewed.accessToken, igUserId: saved.igUserId }));
    const expiresAt = renewed.expiresIn ? new Date(Date.now() + renewed.expiresIn * 1000).toISOString() : null;
    await sql`
      update social_accounts
      set status = 'connected', token_ciphertext = ${packed}, token_expires_at = ${expiresAt}, last_error = null
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
