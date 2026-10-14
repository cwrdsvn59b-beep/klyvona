import { createHash, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { INSTAGRAM_GRAPH_URL, configuredAppIds, instagramAccountEligible, resolveInstagramAccount } from "@/lib/oauth/meta-guards";

const TEST_REFERENCE = "KV-EKBXGL";
const TEST_USERNAME = "klyvona_business";
export const SECOND_CONFIRMATION = "PUBLISH KV-EKBXGL 2";
const CAPTION = "בדיקת פרסום ראשונה של KLYVONA 🚀";
const TEST_IMAGE_URL = "https://placehold.co/640x640/ffffff/40337a.jpg?text=KLYVONA+TEST";

type TestRow = {
  id: string;
  external_account_id: string | null;
  token_ciphertext: string | null;
  approval_status: string;
  subscription_status: string | null;
  status: string | null;
  publish_permission: string | null;
  publish_permission_token_hash: string | null;
};

type GraphResult = { id?: unknown; permalink?: unknown };

class InstagramGraphPostError extends Error {
  readonly safeCode: string;
  readonly definitive: boolean;
  constructor(safeCode: string, definitive: boolean) {
    super(safeCode);
    this.name = "InstagramGraphPostError";
    this.safeCode = safeCode;
    this.definitive = definitive;
  }
}

class InstagramContainerError extends Error {
  readonly safeCode: string;
  constructor(safeCode: string) {
    super(safeCode);
    this.name = "InstagramContainerError";
    this.safeCode = safeCode;
  }
}

export function tokenHash(ciphertext: string): string {
  return createHash("sha256").update(ciphertext).digest("hex");
}

/** True when the candidate must not be sent to /media_publish. */
export function reusedTestContainer(existingIds: readonly (string | null | undefined)[], candidate: string): boolean {
  if (!/^\d{5,32}$/.test(candidate)) return true;
  return existingIds.some((id) => typeof id === "string" && id === candidate);
}

async function safeGraphRead(path: string, token: string, fields: string, timeoutMs = 12000): Promise<{
  httpStatus: number;
  body: Record<string, unknown> | null;
  errorCode: number | null;
}> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json() as unknown;
    const body = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
    const error = body?.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? body.error as Record<string, unknown> : null;
    const errorCode = typeof error?.code === "number" && Number.isFinite(error.code) ? error.code : null;
    return { httpStatus: response.status, body: response.ok ? body : null, errorCode };
  } catch {
    return { httpStatus: 0, body: null, errorCode: null };
  }
}

async function graphPost(path: string, fields: Record<string, string>): Promise<GraphResult> {
  let response: Response;
  try {
    response = await fetch(`${INSTAGRAM_GRAPH_URL}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new InstagramGraphPostError("meta_post_transport_unknown", false);
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    throw new InstagramGraphPostError(`meta_post_unreadable_http_${response.status}`, false);
  }
  const error = body?.error && typeof body.error === "object" && !Array.isArray(body.error)
    ? body.error as Record<string, unknown> : null;
  if (!response.ok || error) {
    const safeInt = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "none";
    const code = `meta_http_${response.status}_code_${safeInt(error?.code)}_sub_${safeInt(error?.error_subcode)}`;
    throw new InstagramGraphPostError(code, response.status >= 400 && response.status < 500);
  }
  if (!body || typeof body.id !== "string" || !/^\d{5,32}$/.test(body.id)) {
    throw new InstagramGraphPostError(`meta_post_invalid_id_http_${response.status}`, false);
  }
  return body;
}

async function waitForContainerFinished(containerId: string, token: string): Promise<void> {
  const maxChecks = 8;
  for (let check = 0; check < maxChecks; check += 1) {
    const state = await safeGraphRead(containerId, token, "status_code", 4000);
    if (state.httpStatus !== 200 || !state.body) {
      throw new InstagramContainerError(`container_status_unavailable_http_${state.httpStatus}_code_${state.errorCode ?? "none"}`);
    }
    const status = state.body.status_code;
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED" || status === "PUBLISHED") {
      throw new InstagramContainerError(`container_status_${String(status).toLowerCase()}`);
    }
    if (status !== "IN_PROGRESS") throw new InstagramContainerError("container_status_unrecognized");
    if (check < maxChecks - 1) await new Promise<void>((resolve) => setTimeout(resolve, 1800));
  }
  throw new InstagramContainerError("container_not_ready_within_wait");
}

async function requireAdmin(userId: string) {
  const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
  const access = await resolveAdminAccess(userId);
  if (!access.isAdmin) throw new Error("Administrator permission required");
}

export async function reserveSecondInstagramAttempt(sql: Sql, input: {
  attemptId: string;
  clientId: string;
  reference: string;
  adminUserId: string;
  externalAccountId: string;
  tokenCiphertext: string;
  tokenHash: string;
}): Promise<{ id: string } | null> {
  const reserved = await sql<{ id: string }>`
    insert into instagram_test_publication_attempts
      (id, client_id, admin_user_id, instagram_account_id, token_hash, status)
    select ${input.attemptId}, c.id, ${input.adminUserId}, sa.external_account_id,
      ${input.tokenHash}, 'reserved'
    from clients c
    join client_subscriptions s on s.client_id = c.id and s.status in ('trial','active')
    join social_accounts sa on sa.client_id = c.id and sa.platform = 'instagram'
    join instagram_test_publications first_attempt
      on first_attempt.client_id = c.id
     and first_attempt.status = 'uncertain'
     and first_attempt.container_id is not null
     and first_attempt.instagram_account_id = sa.external_account_id
    where c.id = ${input.clientId}
      and c.reference_code = ${input.reference}
      and c.approval_status = 'approved'
      and sa.status = 'connected'
      and sa.external_account_id = ${input.externalAccountId}
      and sa.token_ciphertext = ${input.tokenCiphertext}
      and sa.publish_permission = 'confirmed'
      and sa.publish_permission_token_hash = ${input.tokenHash}
    on conflict do nothing
    returning id
  `;
  return reserved[0] ?? null;
}

export class SecondAttemptStateError extends Error {
  readonly safeCode: string;
  constructor() {
    super("second_attempt_state_not_persisted");
    this.name = "SecondAttemptStateError";
    this.safeCode = "second_attempt_state_not_persisted";
  }
}

export async function recordSecondAttempt(sql: Sql, attemptId: string, clientId: string, status: string, fields?: {
  containerId?: string;
  mediaId?: string;
  permalink?: string;
  errorCode?: string;
}): Promise<void> {
  const updated = await sql<{ id: string }>`
    update instagram_test_publication_attempts
    set status = ${status},
        container_id = coalesce(${fields?.containerId ?? null}, container_id),
        media_id = coalesce(${fields?.mediaId ?? null}, media_id),
        permalink = coalesce(${fields?.permalink ?? null}, permalink),
        error_code = ${fields?.errorCode ?? null},
        updated_at = now()
    where id = ${attemptId} and client_id = ${clientId}
    returning id
  `;
  if (updated.length !== 1 || updated[0]?.id !== attemptId) {
    throw new SecondAttemptStateError();
  }
}

export const publishSecondInstagramTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => {
    if (!value || typeof value !== "object" ||
      (value as { confirmation?: unknown }).confirmation !== SECOND_CONFIRMATION) {
      throw new Error("Exact second publication confirmation required");
    }
    return { confirmation: SECOND_CONFIRMATION };
  })
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    if (!process.env.DATABASE_URL?.trim() || !process.env.TOKEN_ENCRYPTION_KEY?.trim()) {
      return { ok: false as const, code: "production_secrets_missing" };
    }
    const sql = await getSql();
    const row = (await sql<TestRow>`
      select c.id, c.approval_status, s.status as subscription_status, sa.status,
        sa.external_account_id, sa.token_ciphertext, sa.publish_permission,
        sa.publish_permission_token_hash
      from clients c
      left join client_subscriptions s on s.client_id = c.id
      left join social_accounts sa on sa.client_id = c.id and sa.platform = 'instagram'
      where c.reference_code = ${TEST_REFERENCE}
      limit 1
    `)[0];
    if (!row || row.approval_status !== "approved") return { ok: false as const, code: "not_ready" };
    if (row.subscription_status !== "trial" && row.subscription_status !== "active") return { ok: false as const, code: "not_ready" };
    if (row.status !== "connected" || !row.external_account_id || !row.token_ciphertext) return { ok: false as const, code: "not_ready" };
    const hash = tokenHash(row.token_ciphertext);
    if (row.publish_permission !== "confirmed" || row.publish_permission_token_hash !== hash) {
      return { ok: false as const, code: "not_ready" };
    }

    let token = "";
    try {
      const { openSecret } = await import("@/lib/crypto/tokens.server");
      const { liveInstagramGraph } = await import("@/lib/oauth/instagram.server");
      const saved = JSON.parse(await openSecret(row.token_ciphertext)) as Record<string, unknown>;
      if (saved.v !== 2 || saved.igUserId !== row.external_account_id ||
          saved.username !== TEST_USERNAME || typeof saved.userToken !== "string" || !saved.userToken) {
        return { ok: false as const, code: "stored_identity_mismatch" };
      }
      token = saved.userToken;
      const profile = await liveInstagramGraph.profile(token);
      const identity = resolveInstagramAccount({
        tokenUserId: row.external_account_id,
        profileUserId: profile.userId,
        profileAppScopedId: profile.appScopedId,
        appIds: configuredAppIds(),
      });
      if (!identity.ok || identity.userId !== row.external_account_id ||
          profile.username !== TEST_USERNAME || !instagramAccountEligible(profile.accountType)) {
        return { ok: false as const, code: "live_identity_mismatch" };
      }
    } catch {
      return { ok: false as const, code: "identity_check_failed" };
    }

    try {
      const image = await fetch(TEST_IMAGE_URL, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      if (!image.ok || !/^image\/jpeg\b/i.test(image.headers.get("content-type") ?? "")) {
        return { ok: false as const, code: "test_image_unavailable" };
      }
    } catch {
      return { ok: false as const, code: "test_image_unavailable" };
    }

    const reserved = await reserveSecondInstagramAttempt(sql, {
      attemptId: randomUUID(),
      clientId: row.id,
      reference: TEST_REFERENCE,
      adminUserId: context.userId,
      externalAccountId: row.external_account_id,
      tokenCiphertext: row.token_ciphertext,
      tokenHash: hash,
    });
    if (!reserved) return { ok: false as const, code: "already_attempted_or_gates_changed" };

    let stage = "reserved";
    let containerId = "";
    let publishedMediaId = "";
    try {
      stage = "container_requested";
      await recordSecondAttempt(sql, reserved.id, row.id, stage);
      const container = await graphPost(`${row.external_account_id}/media`, {
        image_url: TEST_IMAGE_URL,
        caption: CAPTION,
        access_token: token,
      });
      containerId = String(container.id);
      const prior = await sql<{ container_id: string | null }>`
        select container_id from instagram_test_publications where client_id = ${row.id}
      `;
      if (reusedTestContainer(prior.map((item) => item.container_id), containerId)) {
        stage = "container_created";
        await recordSecondAttempt(sql, reserved.id, row.id, "failed_before_request", { errorCode: "reused_container" });
        return { ok: false as const, code: "no_publish_request_sent_locked" };
      }
      stage = "container_created";
      await recordSecondAttempt(sql, reserved.id, row.id, stage, { containerId });
      await waitForContainerFinished(containerId, token);
      stage = "publish_requested";
      await recordSecondAttempt(sql, reserved.id, row.id, stage);
      const published = await graphPost(`${row.external_account_id}/media_publish`, {
        creation_id: containerId,
        access_token: token,
      });
      publishedMediaId = String(published.id);
      stage = "publish_confirmed";
      await recordSecondAttempt(sql, reserved.id, row.id, "published", { containerId, mediaId: publishedMediaId });
      return { ok: true as const, code: "published", mediaId: publishedMediaId };
    } catch (error) {
      const stateNotPersisted = error instanceof SecondAttemptStateError;
      const safeCode = stateNotPersisted
        ? error.safeCode
        : error instanceof InstagramGraphPostError
        ? error.safeCode
        : error instanceof InstagramContainerError
          ? error.safeCode
          : stage === "publish_confirmed"
            ? "database_persist_failed_after_meta_success"
            : stage === "publish_requested"
              ? "publish_result_unknown"
              : stage === "container_requested"
                ? "container_result_unknown"
                : "internal_error_before_publish";
      const definitelyNoPublish = (stateNotPersisted && stage !== "publish_confirmed")
        || (stage === "container_created" && error instanceof InstagramContainerError)
        || (stage === "container_requested" && error instanceof InstagramGraphPostError && error.definitive);
      try {
        await recordSecondAttempt(sql, reserved.id, row.id, definitelyNoPublish ? "failed_before_request" : "uncertain", {
          containerId: containerId || undefined,
          mediaId: publishedMediaId || undefined,
          errorCode: safeCode,
        });
      } catch {
        // The unique reservation remains and blocks another POST.
      }
      if (stage === "publish_confirmed") return { ok: false as const, code: "published_but_database_confirmation_failed_no_retry" };
      if (definitelyNoPublish) return { ok: false as const, code: "no_publish_request_sent_locked" };
      if (error instanceof InstagramGraphPostError && error.definitive) return { ok: false as const, code: "meta_rejected_no_retry" };
      return { ok: false as const, code: "uncertain_check_instagram_no_retry" };
    }
  });
