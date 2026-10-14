import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { tokenHash } from "@/lib/approval.server";
import { permissionConfirmedForToken } from "@/lib/approval";
import { INSTAGRAM_GRAPH_URL, configuredAppIds, instagramAccountEligible, resolveInstagramAccount } from "@/lib/oauth/meta-guards";

const TEST_REFERENCE = "KV-EKBXGL";
const TEST_USERNAME = "klyvona_business";
const CONFIRMATION = "PUBLISH KV-EKBXGL";
const CAPTION = "בדיקת פרסום ראשונה של KLYVONA 🚀";
// Public HTTPS JPEG; no user-controlled URL, token, caption or target.
const TEST_IMAGE_URL = "https://placehold.co/640x640/ffffff/40337a.jpg?text=KLYVONA+TEST";

type TestRow = {
  id: string;
  client_id: string;
  reference_code: string;
  approval_status: string;
  subscription_status: string | null;
  status: string | null;
  external_account_id: string | null;
  token_ciphertext: string | null;
  publish_permission: string | null;
  publish_permission_token_hash: string | null;
};
type Attempt = {
  status: string;
  container_id: string | null;
  media_id: string | null;
  permalink: string | null;
  error_code: string | null;
  created_at: string;
};
export type TestPublishStatus = {
  reference: typeof TEST_REFERENCE;
  username: typeof TEST_USERNAME;
  ready: boolean;
  block: string | null;
  attempt: Attempt | null;
};

async function requireAdmin(userId: string) {
  const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
  const access = await resolveAdminAccess(userId);
  if (!access.isAdmin) throw new Error("Administrator permission required");
}

async function readTarget(sql: Sql): Promise<TestRow | null> {
  const rows = await sql<TestRow>`
    select c.id, c.id as client_id, c.reference_code, c.approval_status,
      s.status as subscription_status, sa.status, sa.external_account_id,
      sa.token_ciphertext, sa.publish_permission, sa.publish_permission_token_hash
    from clients c
    left join client_subscriptions s on s.client_id = c.id
    left join social_accounts sa on sa.client_id = c.id and sa.platform = 'instagram'
    where c.reference_code = ${TEST_REFERENCE}
    limit 1
  `;
  return rows[0] ?? null;
}

function readiness(row: TestRow | null): { ready: boolean; block: string | null } {
  if (!row) return { ready: false, block: "client_missing" };
  if (row.approval_status !== "approved") return { ready: false, block: "approval" };
  if (row.subscription_status !== "trial" && row.subscription_status !== "active") return { ready: false, block: "subscription" };
  if (row.status !== "connected" || !row.external_account_id || !row.token_ciphertext) return { ready: false, block: "instagram" };
  if (!permissionConfirmedForToken({
    permission: row.publish_permission,
    storedHash: row.publish_permission_token_hash,
    currentHash: tokenHash(row.token_ciphertext),
  })) return { ready: false, block: "permission" };
  return { ready: true, block: null };
}

async function readAttempt(sql: Sql, clientId: string): Promise<Attempt | null> {
  const rows = await sql<Attempt>`
    select status, container_id, media_id, permalink, error_code,
      created_at::text as created_at
    from instagram_test_publications where client_id = ${clientId} limit 1
  `;
  return rows[0] ?? null;
}

export const inspectInstagramTestPublish = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TestPublishStatus> => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const row = await readTarget(sql);
    const gate = readiness(row);
    return {
      reference: TEST_REFERENCE,
      username: TEST_USERNAME,
      ...gate,
      attempt: row ? await readAttempt(sql, row.id) : null,
    };
  });

/** Read-only investigation of the FIRST attempt; does not unlock or retry it. */
export type InstagramTestDiagnosis = {
  attemptStatus: string;
  containerPresent: boolean;
  containerStatus: string | null;
  containerHttpStatus: number | null;
  containerErrorCode: number | null;
  containerErrorSubcode: number | null;
  recentPostMatched: boolean | null;
  matchedMediaId: string | null;
  matchedPermalink: string | null;
  recentMediaHttpStatus: number | null;
  recentMediaErrorCode: number | null;
  check: "complete" | "partial" | "not_available";
};

async function safeGraphRead(path: string, token: string, fields: string): Promise<{
  httpStatus: number;
  body: Record<string, unknown> | null;
  errorCode: number | null;
  errorSubcode: number | null;
}> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(12000) });
    const data = await response.json() as unknown;
    const body = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown> : null;
    const error = body?.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? body.error as Record<string, unknown> : null;
    const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      httpStatus: response.status,
      body: response.ok ? body : null,
      errorCode: numberOrNull(error?.code),
      errorSubcode: numberOrNull(error?.error_subcode),
    };
  } catch {
    return { httpStatus: 0, body: null, errorCode: null, errorSubcode: null };
  }
}

export const diagnoseInstagramTestAttempt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<InstagramTestDiagnosis> => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const row = await readTarget(sql);
    if (!row || !row.external_account_id || !row.token_ciphertext) {
      throw new Error("Instagram account unavailable");
    }
    const attempt = await readAttempt(sql, row.id);
    if (!attempt) throw new Error("No existing test attempt");
    const { openSecret } = await import("@/lib/crypto/tokens.server");
    const stored = JSON.parse(await openSecret(row.token_ciphertext)) as Record<string, unknown>;
    if (stored.v !== 2 || stored.igUserId !== row.external_account_id ||
        stored.username !== TEST_USERNAME || typeof stored.userToken !== "string" || !stored.userToken) {
      throw new Error("Stored Instagram identity mismatch");
    }
    // An account refresh changes ciphertext; historical attempt must remain
    // locked and never be confused with another account's media.
    const token = stored.userToken;
    const container = attempt.container_id
      ? await safeGraphRead(attempt.container_id, token, "status_code")
      : null;
    const containerStatus = typeof container?.body?.status_code === "string"
      ? container.body.status_code.slice(0, 60) : null;
    const recent = await safeGraphRead(`${row.external_account_id}/media`, token, "id,caption,permalink,timestamp");
    const items = Array.isArray(recent.body?.data) ? recent.body.data.slice(0, 25) : [];
    const matched = items.find((item): item is Record<string, unknown> => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.caption === "string" && entry.caption.trim() === CAPTION;
    });
    const match = matched && typeof matched.id === "string" ? matched : null;
    const permalink = match && typeof match.permalink === "string" &&
      /^https:\/\/(?:www\.)?instagram\.com\//.test(match.permalink) ? match.permalink : null;
    return {
      attemptStatus: attempt.status,
      containerPresent: Boolean(attempt.container_id),
      containerStatus,
      containerHttpStatus: container?.httpStatus ?? null,
      containerErrorCode: container?.errorCode ?? null,
      containerErrorSubcode: container?.errorSubcode ?? null,
      recentPostMatched: recent.body ? Boolean(match) : null,
      matchedMediaId: match ? String(match.id) : null,
      matchedPermalink: permalink,
      recentMediaHttpStatus: recent.httpStatus,
      recentMediaErrorCode: recent.errorCode,
      check: recent.body && (!container || container.body) ? "complete" : recent.body || container?.body ? "partial" : "not_available",
    };
  });

type GraphResult = { id?: unknown; permalink?: unknown };

/** Only safe numeric Meta error fields are persisted; never tokens or API messages. */
class InstagramGraphPostError extends Error {
  constructor(
    readonly safeCode: string,
    readonly definitive: boolean,
  ) {
    super(safeCode);
    this.name = "InstagramGraphPostError";
  }
}

class InstagramContainerError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
    this.name = "InstagramContainerError";
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
    // Request may have reached Meta before a network timeout.
    throw new InstagramGraphPostError("meta_post_transport_unknown", false);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Even a 2xx with an unreadable response is an ambiguous POST outcome.
    throw new InstagramGraphPostError(`meta_post_unreadable_http_${response.status}`, false);
  }

  const error = body?.error && typeof body.error === "object" && !Array.isArray(body.error)
    ? body.error as Record<string, unknown> : null;
  if (!response.ok || error) {
    const safeInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : "none";
    const code = `meta_http_${response.status}_code_${safeInt(error?.code)}_sub_${safeInt(error?.error_subcode)}`;
    // A 4xx API rejection is explicit; 5xx remains ambiguous.
    throw new InstagramGraphPostError(code, response.status >= 400 && response.status < 500);
  }
  if (!body || typeof body.id !== "string" || !/^\\d{5,32}$/.test(body.id)) {
    throw new InstagramGraphPostError(`meta_post_invalid_id_http_${response.status}`, false);
  }
  return body;
}

/** Poll only GET /{containerId}?fields=status_code. Never retries a POST. */
async function waitForContainerFinished(containerId: string, token: string): Promise<void> {
  const maxChecks = 8;
  for (let check = 0; check < maxChecks; check += 1) {
    const state = await safeGraphRead(containerId, token, "status_code");
    if (state.httpStatus !== 200 || !state.body) {
      throw new InstagramContainerError(
        `container_status_unavailable_http_${state.httpStatus}_code_${state.errorCode ?? "none"}`,
      );
    }
    const status = state.body.status_code;
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED" || status === "PUBLISHED") {
      throw new InstagramContainerError(`container_status_${status.toLowerCase()}`);
    }
    if (status !== "IN_PROGRESS") {
      throw new InstagramContainerError("container_status_unrecognized");
    }
    if (check < maxChecks - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1800));
    }
  }
  throw new InstagramContainerError("container_not_ready_within_wait");
}

async function recordStage(sql: Sql, clientId: string, status: string, fields?: {
  containerId?: string; mediaId?: string; permalink?: string; errorCode?: string;
}) {
  await sql`
    update instagram_test_publications
    set status = ${status},
        container_id = coalesce(${fields?.containerId ?? null}, container_id),
        media_id = coalesce(${fields?.mediaId ?? null}, media_id),
        permalink = coalesce(${fields?.permalink ?? null}, permalink),
        error_code = ${fields?.errorCode ?? null},
        updated_at = now()
    where client_id = ${clientId}
  `;
}

export const publishOneInstagramTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((value: unknown) => {
    if (!value || typeof value !== "object" ||
      (value as { confirmation?: unknown }).confirmation !== CONFIRMATION) {
      throw new Error("Exact publication confirmation required");
    }
    return { confirmation: CONFIRMATION };
  })
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    if (!process.env.DATABASE_URL?.trim() || !process.env.TOKEN_ENCRYPTION_KEY?.trim()) {
      return { ok: false as const, code: "production_secrets_missing" };
    }
    const sql = await getSql();
    const row = await readTarget(sql);
    if (!row || !readiness(row).ready || !row.token_ciphertext || !row.external_account_id) {
      return { ok: false as const, code: "not_ready" };
    }

    // Identity is rechecked live before reserving the only permitted attempt.
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

    // Validate the public JPEG before consuming the single-use reservation.
    // This is a read-only request without Meta credentials.
    try {
      const image = await fetch(TEST_IMAGE_URL, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      if (!image.ok || !/^image\/jpeg\b/i.test(image.headers.get("content-type") ?? "")) {
        return { ok: false as const, code: "test_image_unavailable" };
      }
    } catch {
      return { ok: false as const, code: "test_image_unavailable" };
    }

    // Atomic reservation, one per client forever. All four gates and the exact
    // ciphertext are checked AGAIN in the same INSERT statement. Concurrent
    // clicks or HTTP retries cannot issue a second Meta request.
    const reserved = await sql<{ id: string }>`
      insert into instagram_test_publications
        (id, client_id, admin_user_id, instagram_account_id, token_hash, status)
      select ${randomUUID()}, c.id, ${context.userId}, sa.external_account_id,
        ${tokenHash(row.token_ciphertext)}, 'reserved'
      from clients c
      join client_subscriptions s on s.client_id = c.id and s.status in ('trial','active')
      join social_accounts sa on sa.client_id = c.id and sa.platform = 'instagram'
      where c.id = ${row.id} and c.reference_code = ${TEST_REFERENCE}
        and c.approval_status = 'approved'
        and sa.status = 'connected'
        and sa.external_account_id = ${row.external_account_id}
        and sa.token_ciphertext = ${row.token_ciphertext}
        and sa.publish_permission = 'confirmed'
        and sa.publish_permission_token_hash = ${tokenHash(row.token_ciphertext)}
      on conflict do nothing
      returning id
    `;
    if (!reserved[0]) return { ok: false as const, code: "already_attempted_or_gates_changed" };

    let stage = "reserved";
    let containerId = "";
    let publishedMediaId = "";
    try {
      stage = "container_requested";
      await recordStage(sql, row.id, stage);
      const container = await graphPost(`${row.external_account_id}/media`, {
        image_url: TEST_IMAGE_URL,
        caption: CAPTION,
        access_token: token,
      });
      containerId = String(container.id);
      stage = "container_created";
      await recordStage(sql, row.id, stage, { containerId });

      // The container must be FINISHED before /media_publish. Read-only GET
      // polling is bounded; if not ready, fail closed without any publish call.
      await waitForContainerFinished(containerId, token);

      stage = "publish_requested";
      await recordStage(sql, row.id, stage);
      const published = await graphPost(`${row.external_account_id}/media_publish`, {
        creation_id: containerId,
        access_token: token,
      });
      const mediaId = String(published.id);
      publishedMediaId = mediaId;
      stage = "publish_confirmed";
      // The publish response confirms an ID; permalink lookup is optional and
      // must never cause a second publish call.
      await recordStage(sql, row.id, "published", { containerId, mediaId });
      let permalink: string | null = null;
      try {
        const url = new URL(`${INSTAGRAM_GRAPH_URL}/${mediaId}`);
        url.searchParams.set("fields", "id,permalink");
        url.searchParams.set("access_token", token);
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (response.ok) {
          const body = await response.json() as GraphResult;
          if (typeof body.permalink === "string" && /^https:\/\/www\.instagram\.com\//.test(body.permalink)) {
            permalink = body.permalink;
            await recordStage(sql, row.id, "published", { containerId, mediaId, permalink });
          }
        }
      } catch { /* Publication already succeeded; do not retry. */ }
      return { ok: true as const, code: "published", mediaId, permalink };
    } catch (error) {
      // Never unlock the reservation. Distinguish explicit Meta rejection,
      // container processing, ambiguous transport, and DB persistence failures.
      const safeCode = error instanceof InstagramGraphPostError
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
      const definitelyNoPublish = stage === "container_created" &&
        error instanceof InstagramContainerError ||
        stage === "container_requested" &&
        error instanceof InstagramGraphPostError && error.definitive;
      try {
        await recordStage(sql, row.id, definitelyNoPublish ? "failed_before_request" : "uncertain", {
          containerId: containerId || undefined,
          mediaId: publishedMediaId || undefined,
          errorCode: safeCode,
        });
      } catch {
        // Even if DB update fails, unique reservation remains and prevents retry.
      }
      if (stage === "publish_confirmed") {
        return { ok: false as const, code: "published_but_database_confirmation_failed_no_retry" };
      }
      if (definitelyNoPublish) {
        return { ok: false as const, code: "no_publish_request_sent_locked" };
      }
      if (error instanceof InstagramGraphPostError && error.definitive) {
        return { ok: false as const, code: "meta_rejected_no_retry" };
      }
      return { ok: false as const, code: "uncertain_check_instagram_no_retry" };
    }
  });
