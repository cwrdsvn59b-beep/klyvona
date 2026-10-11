import { randomBytes, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/crypto/tokens.server";
import {
  META_AUTHORIZE_URL,
  META_GRAPH_URL,
  META_SCOPES,
  META_TOKEN_URL,
  OAUTH_STATE_TTL_MS,
  classifyAccounts,
  evaluateOAuthState,
  metaConfigProblem,
  secretMatches,
  selectionAllowed,
  sha256Hex,
} from "@/lib/oauth/meta-guards";

const STATE_COOKIE = "klyvona_meta_oauth";
const PENDING_TTL_MS = 15 * 60 * 1000;

type Platform = "facebook" | "instagram";

type GraphPage = {
  id: string;
  name: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id?: string; username?: string };
};

export type MetaGraph = {
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    appId: string;
    appSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number | null }>;
  exchangeLongLived(input: {
    token: string;
    appId: string;
    appSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number | null }>;
  listPages(userToken: string): Promise<GraphPage[]>;
};

function appCredentials() {
  return {
    appId: process.env.META_APP_ID?.trim() ?? "",
    appSecret: process.env.META_APP_SECRET?.trim() ?? "",
  };
}

export function callbackUrl(request: Request, platform: Platform): string | null {
  const explicit = process.env.META_OAUTH_REDIRECT_ORIGIN?.trim() || process.env.BETTER_AUTH_URL?.trim();
  const origin = explicit ? explicit.replace(/\/$/, "") : metaConfigProblem() ? null : new URL(request.url).origin;
  if (!origin) return null;
  return `${origin}/api/oauth/${platform}/callback`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof body.error === "object") {
    const code =
      body.error && typeof body.error === "object" && "code" in body.error
        ? String((body.error as { code?: unknown }).code ?? "")
        : "";
    throw new Error(code ? `meta_${code}` : "meta_request_failed");
  }
  return body;
}

export const liveMetaGraph: MetaGraph = {
  async exchangeCode(input) {
    const payload = await readJson(
      await fetch(META_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: input.appId,
          client_secret: input.appSecret,
          redirect_uri: input.redirectUri,
          code: input.code,
        }),
      }),
    );
    return tokenResult(payload);
  },
  async exchangeLongLived(input) {
    const payload = await readJson(
      await fetch(META_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: input.appId,
          client_secret: input.appSecret,
          fb_exchange_token: input.token,
        }),
      }),
    );
    return tokenResult(payload);
  },
  async listPages(userToken) {
    const payload = await readJson(
      await fetch(
        `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token,tasks,instagram_business_account{id,username}`,
        { headers: { authorization: `Bearer ${userToken}` } },
      ),
    );
    return Array.isArray(payload.data) ? (payload.data as GraphPage[]) : [];
  },
};

function tokenResult(payload: Record<string, unknown>) {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("meta_token_missing");
  return { accessToken, expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null };
}

function disabled(platform: string): Response {
  return Response.json(
    {
      platform,
      connectionStatus: "awaiting_setup",
      oauthActivated: false,
      message:
        "Meta OAuth is disabled until the app id, app secret, encryption key, and persistent database are configured.",
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
  let body: { reference?: unknown; connectSecret?: unknown; pendingId?: unknown; platform?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return null;
  }
  if (typeof body.reference !== "string" || typeof body.connectSecret !== "string") return null;
  const client = await clientForSecret(body.reference.trim(), body.connectSecret);
  if (!client) return null;
  return {
    client,
    pendingId: typeof body.pendingId === "string" ? body.pendingId : "",
    platform: body.platform === "facebook" || body.platform === "instagram" ? body.platform : "",
  };
}

export function newConnectSecret(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

export async function startMetaOAuth(request: Request, platform: Platform): Promise<Response> {
  if (metaConfigProblem()) return disabled(platform);
  const redirectUri = callbackUrl(request, platform);
  if (!redirectUri) return disabled(platform);
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
      ${platform},
      ${sha256Hex(nonce)},
      ${new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()}
    )
  `;
  const url = new URL(META_AUTHORIZE_URL);
  url.searchParams.set("client_id", appCredentials().appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", `${id}.${nonce}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));
  const headers = new Headers();
  headers.append("set-cookie", stateCookie(id, request));
  return noStore({ oauthActivated: true, authorizeUrl: url.toString() }, 200, headers);
}

function parseState(raw: string | null): { id: string; nonce: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  return { id: raw.slice(0, dot), nonce: raw.slice(dot + 1) };
}

export async function finishMetaOAuth(
  request: Request,
  platform: Platform,
  graph: MetaGraph = liveMetaGraph,
): Promise<Response> {
  const url = new URL(request.url);
  const back = (code: string) => Response.redirect(new URL(`/connect?error=${code}`, url.origin), 303);
  if (url.searchParams.get("error")) return back("denied");
  if (metaConfigProblem()) return disabled(platform);
  const redirectUri = callbackUrl(request, platform);
  if (!redirectUri) return disabled(platform);
  const parsed = parseState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
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
  if (verdict !== "ok" || !row || row.platform !== platform) return back(verdict === "ok" ? "state" : verdict);

  const consumed = await sql<{ id: string }>`
    update oauth_states set used_at = now()
    where id = ${parsed.id} and used_at is null
    returning id
  `;
  if (!consumed[0]) return back("used");

  try {
    const { appId, appSecret } = appCredentials();
    const shortLived = await graph.exchangeCode({ code, redirectUri, appId, appSecret });
    const longLived = await graph.exchangeLongLived({ token: shortLived.accessToken, appId, appSecret });
    const expiresAt = longLived.expiresIn ? new Date(Date.now() + longLived.expiresIn * 1000).toISOString() : null;
    const pages = await graph.listPages(longLived.accessToken);
    for (const page of pages.slice(0, 25)) {
      if (!page.id || !page.access_token) continue;
      const packed = await sealSecret(
        JSON.stringify({ v: 1, userToken: longLived.accessToken, pageToken: page.access_token, pageId: page.id }),
      );
      const accounts = classifyAccounts({
        id: page.id,
        name: page.name || page.id,
        tasks: page.tasks ?? [],
        instagram: page.instagram_business_account?.id
          ? {
              id: page.instagram_business_account.id,
              username: page.instagram_business_account.username ?? "",
            }
          : null,
      });
      for (const account of accounts) {
        await sql`
          insert into oauth_pending_accounts (
            id, client_id, state_id, platform, external_account_id, display_name,
            eligible, ineligible_reason, token_ciphertext, token_expires_at, parent_external_id, expires_at
          ) values (
            ${randomUUID()}, ${row.client_id}, ${parsed.id}, ${account.platform}, ${account.externalAccountId},
            ${account.displayName}, ${account.eligible}, ${account.reason}, ${account.eligible ? packed : null},
            ${expiresAt}, ${account.parentExternalId}, ${new Date(Date.now() + PENDING_TTL_MS).toISOString()}
          )
        `;
      }
    }
  } catch (error) {
    console.error("[meta] callback failed", error instanceof Error ? error.message : "error");
    return back("exchange");
  }
  return Response.redirect(new URL("/connect?ready=1", url.origin), 303);
}

export async function listPendingAccounts(request: Request): Promise<Response> {
  if (metaConfigProblem()) return disabled("meta");
  const parsed = await readConnectBody(request);
  if (!parsed) return noStore({ error: "unauthorized" }, 401);
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    platform: string;
    display_name: string;
    eligible: boolean;
    ineligible_reason: string | null;
  }>`
    select id, platform, display_name, eligible, ineligible_reason
    from oauth_pending_accounts
    where client_id = ${parsed.client.id} and expires_at > now()
    order by platform, display_name
  `;
  return noStore({
    accounts: rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      name: row.display_name,
      eligible: row.eligible,
      reason: row.ineligible_reason,
    })),
  });
}

export async function selectPendingAccount(request: Request): Promise<Response> {
  if (metaConfigProblem()) return disabled("meta");
  const parsed = await readConnectBody(request);
  if (!parsed?.pendingId) return noStore({ error: "unauthorized" }, 401);
  const sql = await getSql();
  const rows = await sql<{
    client_id: string;
    platform: string;
    external_account_id: string;
    eligible: boolean;
    token_ciphertext: string | null;
    token_expires_at: string | null;
    expires_at: string;
  }>`
    select client_id, platform, external_account_id, eligible, token_ciphertext,
      token_expires_at::text as token_expires_at, expires_at::text as expires_at
    from oauth_pending_accounts where id = ${parsed.pendingId} limit 1
  `;
  const pending = rows[0];
  if (!pending) return noStore({ error: "missing" }, 404);
  const verdict = selectionAllowed({
    ownerClientId: parsed.client.id,
    pendingClientId: pending.client_id,
    eligible: pending.eligible,
    expired: new Date(pending.expires_at).getTime() <= Date.now(),
  });
  if (verdict !== "ok" || !pending.token_ciphertext) return noStore({ error: verdict }, 403);
  await sql`
    update social_accounts
    set status = 'connected',
        external_account_id = ${pending.external_account_id},
        token_ciphertext = ${pending.token_ciphertext},
        token_expires_at = ${pending.token_expires_at},
        connected_at = now(),
        last_error = null
    where client_id = ${parsed.client.id} and platform = ${pending.platform}
  `;
  await sql`delete from oauth_pending_accounts where id = ${parsed.pendingId}`;
  return noStore({ ok: true, platform: pending.platform });
}

export async function disconnectMeta(request: Request): Promise<Response> {
  const parsed = await readConnectBody(request);
  if (!parsed?.platform) return noStore({ error: "unauthorized" }, 401);
  const sql = await getSql();
  const updated = await sql<{ platform: string }>`
    update social_accounts
    set status = 'awaiting_setup', token_ciphertext = null, token_expires_at = null,
        external_account_id = null, connected_at = null, last_error = null
    where client_id = ${parsed.client.id} and platform = ${parsed.platform}
    returning platform
  `;
  if (!updated[0]) return noStore({ error: "missing" }, 404);
  return noStore({ ok: true, platform: updated[0].platform });
}

export async function renewMeta(request: Request, graph: MetaGraph = liveMetaGraph): Promise<Response> {
  if (metaConfigProblem()) return disabled("meta");
  const parsed = await readConnectBody(request);
  if (!parsed?.platform) return noStore({ error: "unauthorized" }, 401);
  const sql = await getSql();
  const rows = await sql<{ token_ciphertext: string | null }>`
    select token_ciphertext from social_accounts
    where client_id = ${parsed.client.id} and platform = ${parsed.platform} limit 1
  `;
  const sealed = rows[0]?.token_ciphertext;
  if (!sealed) return noStore({ error: "reconnect_required" }, 409);
  try {
    const saved = JSON.parse(await openSecret(sealed)) as { userToken?: string; pageId?: string };
    if (!saved.userToken || !saved.pageId) return noStore({ error: "reconnect_required" }, 409);
    const { appId, appSecret } = appCredentials();
    const renewed = await graph.exchangeLongLived({ token: saved.userToken, appId, appSecret });
    const page = (await graph.listPages(renewed.accessToken)).find((item) => item.id === saved.pageId && item.access_token);
    if (!page?.access_token) {
      await markExpired(parsed.client.id, parsed.platform);
      return noStore({ error: "reconnect_required" }, 409);
    }
    const packed = await sealSecret(
      JSON.stringify({ v: 1, userToken: renewed.accessToken, pageToken: page.access_token, pageId: page.id }),
    );
    const expiresAt = renewed.expiresIn ? new Date(Date.now() + renewed.expiresIn * 1000).toISOString() : null;
    await sql`
      update social_accounts
      set status = 'connected', token_ciphertext = ${packed}, token_expires_at = ${expiresAt}, last_error = null
      where client_id = ${parsed.client.id} and platform = ${parsed.platform}
    `;
    return noStore({ ok: true });
  } catch (error) {
    console.error("[meta] renew failed", error instanceof Error ? error.message : "error");
    await markExpired(parsed.client.id, parsed.platform);
    return noStore({ error: "reconnect_required" }, 409);
  }
}

async function markExpired(clientId: string, platform: string) {
  const sql = await getSql();
  await sql`
    update social_accounts
    set status = 'expired', last_error = ${"ההרשאה פגה או בוטלה. יש לחבר מחדש."}
    where client_id = ${clientId} and platform = ${platform}
  `;
}
