import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { instagramUsername, instagramAccountEligible, resolveInstagramAccount, configuredAppIds, INSTAGRAM_GRAPH_URL } from "@/lib/oauth/meta-guards";
import { instagramPermalink, manualPhase, normalizeClientId, MANUAL_CONFIRMATION, type ManualPhase } from "@/lib/instagram-manual-publish";
import {
  executeManualPublication,
  manualAccountGate,
  ManualContainerError,
  ManualGraphPostError,
  type ManualAccountRow,
  type ManualPublishView,
} from "@/lib/instagram-manual-publish.server";

export type ManualAccountChoice = {
  clientId: string;
  reference: string;
  businessName: string;
  username: string | null;
  ready: boolean;
  block: string | null;
};

export type ManualHistoryItem = {
  id: string;
  phase: ManualPhase;
  status: string;
  permalink: string | null;
  mediaId: string | null;
  errorCode: string | null;
  createdAt: string;
};

async function requireAdmin(userId: string) {
  const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
  const access = await resolveAdminAccess(userId);
  if (!access.isAdmin) throw new Error("Administrator permission required");
}

async function storedUsername(ciphertext: string | null): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    const { openSecret } = await import("@/lib/crypto/tokens.server");
    const saved = JSON.parse(await openSecret(ciphertext)) as { username?: unknown };
    return instagramUsername(saved.username);
  } catch {
    return null;
  }
}

export const listInstagramManualAccounts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ManualAccountChoice[]> => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<ManualAccountRow & { id: string; reference_code: string; business_name: string | null }>`
      select c.id, c.reference_code, c.approval_status, bp.business_name,
        s.status as subscription_status, sa.status, sa.external_account_id,
        sa.token_ciphertext, sa.publish_permission, sa.publish_permission_token_hash
      from social_accounts sa
      join clients c on c.id = sa.client_id
      left join business_profiles bp on bp.client_id = c.id
      left join client_subscriptions s on s.client_id = c.id
      where sa.platform = 'instagram' and sa.status = 'connected'
      order by c.created_at desc
      limit 100
    `;
    const choices: ManualAccountChoice[] = [];
    for (const row of rows) {
      const gate = manualAccountGate(row);
      choices.push({
        clientId: row.id,
        reference: row.reference_code,
        businessName: row.business_name?.slice(0, 120) || row.reference_code,
        username: await storedUsername(row.token_ciphertext),
        ready: gate.ready,
        block: gate.block,
      });
    }
    return choices;
  });

export const inspectInstagramManualPosts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => {
    const clientId = normalizeClientId(value && typeof value === "object" ? (value as { clientId?: unknown }).clientId : null);
    if (!clientId) throw new Error("Invalid client");
    return { clientId };
  })
  .handler(async ({ context, data }): Promise<ManualHistoryItem[]> => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      status: string;
      permalink: string | null;
      media_id: string | null;
      error_code: string | null;
      created_at: string;
    }>`
      select id, status, permalink, media_id, error_code, created_at::text as created_at
      from instagram_manual_publications
      where client_id = ${data.clientId}
      order by created_at desc
      limit 8
    `;
    return rows.map((row) => ({
      id: row.id,
      phase: manualPhase(row.status),
      status: row.status,
      permalink: instagramPermalink(row.permalink),
      mediaId: row.media_id,
      errorCode: row.error_code,
      createdAt: row.created_at,
    }));
  });

async function safeRead(path: string, token: string, fields: string): Promise<{
  httpStatus: number;
  body: Record<string, unknown> | null;
}> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    const parsed: unknown = await response.json();
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
    return { httpStatus: response.status, body: response.ok ? body : null };
  } catch {
    return { httpStatus: 0, body: null };
  }
}

async function graphPost(path: string, fields: Record<string, string>): Promise<{ id?: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${INSTAGRAM_GRAPH_URL}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new ManualGraphPostError("meta_post_transport_unknown", false);
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    throw new ManualGraphPostError(`meta_post_unreadable_http_${response.status}`, false);
  }
  const error = body?.error && typeof body.error === "object" && !Array.isArray(body.error)
    ? body.error as Record<string, unknown> : null;
  if (!response.ok || error) {
    const safeInt = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "none";
    throw new ManualGraphPostError(
      `meta_http_${response.status}_code_${safeInt(error?.code)}_sub_${safeInt(error?.error_subcode)}`,
      response.status >= 400 && response.status < 500,
    );
  }
  if (!body || typeof body.id !== "string" || !/^\d{5,32}$/.test(body.id)) {
    throw new ManualGraphPostError(`meta_post_invalid_id_http_${response.status}`, false);
  }
  return body;
}

async function waitUntilFinished(containerId: string, token: string): Promise<void> {
  for (let check = 0; check < 8; check += 1) {
    const state = await safeRead(containerId, token, "status_code");
    const status = state.body?.status_code;
    if (state.httpStatus !== 200 || !state.body) {
      throw new ManualContainerError(`container_status_unavailable_http_${state.httpStatus}`);
    }
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED" || status === "PUBLISHED") {
      throw new ManualContainerError(`container_status_${String(status).toLowerCase()}`);
    }
    if (status !== "IN_PROGRESS") throw new ManualContainerError("container_status_unrecognized");
    if (check < 7) await new Promise<void>((resolve) => setTimeout(resolve, 1800));
  }
  throw new ManualContainerError("container_not_ready_within_wait");
}

async function jpegAvailable(url: string): Promise<boolean> {
  const head = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10000) });
  const headType = head.headers.get("content-type") ?? "";
  if (head.status === 200 && /^image\/jpeg\b/i.test(headType)) return true;
  if (head.status !== 405 && head.status !== 501) return false;
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { range: "bytes=0-0" },
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  const type = response.headers.get("content-type") ?? "";
  return (response.status === 200 || response.status === 206) && /^image\/jpeg\b/i.test(type);
}

export const publishInstagramManualPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid publication request");
    const row = value as Record<string, unknown>;
    if (
      typeof row.clientId !== "string"
      || typeof row.confirmation !== "string"
      || typeof row.idempotencyKey !== "string"
      || typeof row.imageUrl !== "string"
      || typeof row.caption !== "string"
    ) throw new Error("Invalid publication request");
    return {
      clientId: row.clientId,
      confirmation: row.confirmation,
      idempotencyKey: row.idempotencyKey,
      imageUrl: row.imageUrl,
      caption: row.caption,
    };
  })
  .handler(async ({ context, data }): Promise<ManualPublishView> => {
    await requireAdmin(context.userId);
    if (data.confirmation !== MANUAL_CONFIRMATION) {
      return {
        ok: false,
        code: "confirmation_required",
        phase: "preparation",
        mediaId: null,
        permalink: null,
        status: null,
        anotherPostAllowed: true,
      };
    }
    if (!process.env.DATABASE_URL?.trim() || !process.env.TOKEN_ENCRYPTION_KEY?.trim()) {
      return {
        ok: false,
        code: "production_secrets_missing",
        phase: "error",
        mediaId: null,
        permalink: null,
        status: null,
        anotherPostAllowed: false,
      };
    }
    const clientId = normalizeClientId(data.clientId);
    if (!clientId) {
      return {
        ok: false,
        code: "not_ready",
        phase: "error",
        mediaId: null,
        permalink: null,
        status: null,
        anotherPostAllowed: false,
      };
    }
    const sql = await getSql();
    const row = (await sql<ManualAccountRow>`
      select c.approval_status, s.status as subscription_status, sa.status,
        sa.external_account_id, sa.token_ciphertext, sa.publish_permission,
        sa.publish_permission_token_hash
      from clients c
      left join client_subscriptions s on s.client_id = c.id
      left join social_accounts sa on sa.client_id = c.id and sa.platform = 'instagram'
      where c.id = ${clientId}
      limit 1
    `)[0] ?? null;
    const gate = manualAccountGate(row);
    if (!gate.ready || !row?.token_ciphertext || !row.external_account_id) {
      return {
        ok: false,
        code: gate.block ?? "not_ready",
        phase: "error",
        mediaId: null,
        permalink: null,
        status: null,
        anotherPostAllowed: false,
      };
    }
    let token = "";
    try {
      const { openSecret } = await import("@/lib/crypto/tokens.server");
      const { liveInstagramGraph } = await import("@/lib/oauth/instagram.server");
      const saved = JSON.parse(await openSecret(row.token_ciphertext)) as {
        v?: unknown;
        userToken?: unknown;
        igUserId?: unknown;
        username?: unknown;
      };
      if (saved.v !== 2 || saved.igUserId !== row.external_account_id || typeof saved.userToken !== "string" || !saved.userToken) {
        return {
          ok: false,
          code: "stored_identity_mismatch",
          phase: "error",
          mediaId: null,
          permalink: null,
          status: null,
          anotherPostAllowed: false,
        };
      }
      token = saved.userToken;
      const profile = await liveInstagramGraph.profile(token);
      const identity = resolveInstagramAccount({
        tokenUserId: row.external_account_id,
        profileUserId: profile.userId,
        profileAppScopedId: profile.appScopedId,
        appIds: configuredAppIds(),
      });
      const storedName = instagramUsername(saved.username);
      const liveName = instagramUsername(profile.username);
      if (!identity.ok || identity.userId !== row.external_account_id || !instagramAccountEligible(profile.accountType) || !storedName || storedName !== liveName) {
        return {
          ok: false,
          code: "live_identity_mismatch",
          phase: "error",
          mediaId: null,
          permalink: null,
          status: null,
          anotherPostAllowed: false,
        };
      }
    } catch {
      return {
        ok: false,
        code: "identity_check_failed",
        phase: "error",
        mediaId: null,
        permalink: null,
        status: null,
        anotherPostAllowed: false,
      };
    }
    return executeManualPublication({
      sql,
      adminUserId: context.userId,
      clientId,
      confirmation: data.confirmation,
      idempotencyKey: data.idempotencyKey,
      imageUrl: data.imageUrl,
      caption: data.caption,
      externalAccountId: row.external_account_id,
      token,
      tokenCiphertext: row.token_ciphertext,
      imageAvailable: jpegAvailable,
      post: graphPost,
      waitUntilFinished,
      readPermalink: async (mediaId, accessToken) => (await safeRead(mediaId, accessToken, "permalink")).body?.permalink,
    });
  });
