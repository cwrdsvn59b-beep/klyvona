import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { resolveAdminAccess } from "@/lib/admin-grant.server";
import { getSql, type Sql } from "@/lib/db";
import { tokenHash } from "@/lib/approval.server";
import { openSecret } from "@/lib/crypto/tokens.server";
import { permissionConfirmedForToken } from "@/lib/approval";
import { INSTAGRAM_GRAPH_URL, configuredAppIds, instagramAccountEligible, resolveInstagramAccount } from "@/lib/oauth/meta-guards";
import { liveInstagramGraph } from "@/lib/oauth/instagram.server";

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

type GraphResult = { id?: unknown; permalink?: unknown };
async function graphPost(path: string, fields: Record<string, string>): Promise<GraphResult> {
  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof body.error === "object" || typeof body.id !== "string") {
    // No token, URL with credentials or response body in logs or admin UI.
    throw new Error("instagram_api_rejected");
  }
  return body;
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
    const sql = await getSql();
    const row = await readTarget(sql);
    if (!row || !readiness(row).ready || !row.token_ciphertext || !row.external_account_id) {
      return { ok: false as const, code: "not_ready" };
    }

    // Identity is rechecked live before reserving the only permitted attempt.
    let token = "";
    try {
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
      on conflict (client_id) do nothing
      returning id
    `;
    if (!reserved[0]) return { ok: false as const, code: "already_attempted_or_gates_changed" };

    let stage = "reserved";
    let containerId = "";
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

      stage = "publish_requested";
      await recordStage(sql, row.id, stage);
      const published = await graphPost(`${row.external_account_id}/media_publish`, {
        creation_id: containerId,
        access_token: token,
      });
      const mediaId = String(published.id);
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
    } catch {
      // A network timeout or DB failure may occur after Meta accepted a call.
      // Fail closed and never retry; admin must inspect Instagram manually.
      try {
        await recordStage(sql, row.id, "uncertain", {
          containerId: containerId || undefined,
          errorCode: stage === "publish_requested" ? "publish_result_unknown" : "container_result_unknown",
        });
      } catch { /* Reservation remains in place even if status update fails. */ }
      return { ok: false as const, code: "uncertain_check_instagram_no_retry" };
    }
  });
