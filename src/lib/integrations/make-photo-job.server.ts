import type { Sql } from "@/lib/db";
import { parsePhotoContentType } from "@/lib/integrations/make-photo-job";
import { releaseUnsentReservation, reservePhotoSlot, quotaSchemaError } from "@/lib/integrations/quota-period";
import { secretMatches } from "@/lib/oauth/meta-guards";

export type PhotoJobNotice = {
  event: "content.generation_requested";
  job_id: string;
  client_id: string;
  platform: "instagram";
  content_type: "photo";
  occurred_at: string;
};

export type PhotoDispatchResult = {
  status: "skipped" | "sent" | "failed";
  httpStatus: number | null;
  attempted: boolean;
};

const CONTENT_DESTINATION = "make-content";

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function jobDetail(jobId: string): string {
  return `job:${jobId}`;
}

function safeWebhookUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost"
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "169.254.169.254"
    || /^(127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) return null;
  return url;
}

/** Outbound photo request. This is not the onboarding webhook. */
export async function dispatchPhotoGeneration(notice: PhotoJobNotice): Promise<PhotoDispatchResult> {
  const raw = process.env.MAKE_CONTENT_WEBHOOK_URL?.trim();
  if (!raw) return { status: "skipped", httpStatus: null, attempted: false };
  const url = safeWebhookUrl(raw);
  if (!url) return { status: "failed", httpStatus: null, attempted: false };
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", "user-agent": "KLYVONA-Connect" },
      body: JSON.stringify(notice),
    });
    return { status: response.ok ? "sent" : "failed", httpStatus: response.status, attempted: true };
  } catch {
    return { status: "failed", httpStatus: null, attempted: true };
  }
}

type Delivery = { id: string; status: string; http_status: number | null; dispatch_state: string | null };

function uniqueViolation(error: unknown): boolean {
  return errorCode(error) === "23505";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
}

async function deliveryFor(sql: Sql, jobId: string): Promise<Delivery | null> {
  const rows = await sql<Delivery>`
    select id, status, http_status, dispatch_state
    from webhook_deliveries
    where destination = ${CONTENT_DESTINATION} and detail = ${jobDetail(jobId)}
    limit 1
  `;
  return rows[0] ?? null;
}

/** Mark the chargeable attempt before the network call so a crash cannot retry it. */
async function claimSend(sql: Sql, clientId: string, jobId: string): Promise<"send" | "busy"> {
  const detail = jobDetail(jobId);
  return sql.transaction(async (tx) => {
    await tx`
      insert into webhook_deliveries (id, client_id, destination, status, detail, dispatch_state)
      values (${crypto.randomUUID()}, ${clientId}, ${CONTENT_DESTINATION}, 'skipped', ${detail}, null)
      on conflict (detail) where destination = 'make-content' do nothing
    `;
    const claimed = await tx<{ id: string }>`
      update webhook_deliveries
      set http_status = 0, dispatch_state = 'attempted_unknown'
      where destination = ${CONTENT_DESTINATION}
        and detail = ${detail}
        and client_id = ${clientId}
        and status = 'skipped'
        and http_status is null
        and (dispatch_state is null or dispatch_state = 'never_attempted')
      returning id
    `;
    return claimed[0] ? "send" : "busy";
  });
}

async function finishSend(sql: Sql, jobId: string, result: PhotoDispatchResult): Promise<void> {
  await sql`
    update webhook_deliveries
    set status = ${result.status}, http_status = ${result.httpStatus}
    where destination = ${CONTENT_DESTINATION}
      and detail = ${jobDetail(jobId)}
      and http_status = 0
      and dispatch_state = 'attempted_unknown'
  `;
}

async function recordNeverAttempted(sql: Sql, clientId: string, jobId: string): Promise<void> {
  const detail = jobDetail(jobId);
  try {
    await sql`
      insert into webhook_deliveries (id, client_id, destination, status, detail, dispatch_state)
      values (${crypto.randomUUID()}, ${clientId}, ${CONTENT_DESTINATION}, 'skipped', ${detail}, 'never_attempted')
    `;
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
  }
}

async function authenticatedClient(sql: Sql, reference: string, connectSecret: string): Promise<{ id: string; approvalStatus: string } | null> {
  if (!/^KV-[A-Z0-9]{6}$/.test(reference) || connectSecret.length < 20 || connectSecret.length > 200) return null;
  const rows = await sql<{ id: string; connect_secret_hash: string | null; approval_status: string | null }>`
    select id, connect_secret_hash, approval_status
    from clients
    where reference_code = ${reference}
    limit 1
  `;
  const row = rows[0];
  if (!row || !secretMatches(connectSecret, row.connect_secret_hash)) return null;
  return { id: row.id, approvalStatus: row.approval_status ?? "pending_approval" };
}

function queued(
  jobId: string,
  duplicate: boolean,
  make: PhotoDispatchResult["status"],
  dispatchState: string | null,
): Response {
  return json(200, {
    ok: true,
    job_id: jobId,
    status: "queued",
    duplicate,
    make,
    dispatch_state: dispatchState,
    published: false,
  });
}

async function releaseIfUnclaimed(sql: Sql, clientId: string, jobId: string): Promise<void> {
  await sql`
    update publishing_jobs
    set awaiting_generation = false, status = 'failed', error_message = 'schema_unavailable'
    where id = ${jobId} and client_id = ${clientId} and awaiting_generation is true
      and not exists (
        select 1 from webhook_deliveries d
        where d.client_id = ${clientId}
          and d.destination = ${CONTENT_DESTINATION}
          and d.detail = ${jobDetail(jobId)}
      )
      and not exists (select 1 from instagram_generation_results r where r.job_id = publishing_jobs.id)
  `;
}

/**
 * Open one queued Instagram photo job for the authenticated client, then ask
 * Make to generate it. A repeat reuses that job and does not spend another slot.
 * Nothing is published.
 */
export async function createPhotoGenerationJob(input: {
  sql: Sql;
  reference: string;
  connectSecret: string;
  contentType: unknown;
  today?: string;
  dispatch?: (notice: PhotoJobNotice) => Promise<PhotoDispatchResult>;
}): Promise<Response> {
  const contentType = parsePhotoContentType(input.contentType);
  if (!contentType) return json(400, { ok: false, code: "invalid" });
  const client = await authenticatedClient(input.sql, input.reference, input.connectSecret);
  if (!client) return json(401, { ok: false, code: "unauthorized" });
  if (client.approvalStatus !== "approved") return json(403, { ok: false, code: "not_entitled" });
  const { jerusalemToday } = await import("@/lib/integrations/quota-period");
  const today = input.today ?? jerusalemToday();
  const reserved = await reservePhotoSlot(input.sql, client.id, today);
  if (!reserved.ok) return json(reserved.code === "schema_unavailable" ? 503 : 403, { ok: false, code: reserved.code });
  try {
    return await deliver(
      input.sql,
      client.id,
      reserved.jobId,
      reserved.duplicate,
      reserved.dispatch === "send",
      input.dispatch ?? dispatchPhotoGeneration,
    );
  } catch (error) {
    if (quotaSchemaError(error)) {
      try {
        await releaseIfUnclaimed(input.sql, client.id, reserved.jobId);
      } catch {
        // The delivery table may be missing too. Do not turn that into a second send.
      }
      return json(503, { ok: false, code: "schema_unavailable" });
    }
    throw error;
  }
}

function preflightWebhook(): PhotoDispatchResult | null {
  const raw = process.env.MAKE_CONTENT_WEBHOOK_URL?.trim();
  if (!raw) return { status: "skipped", httpStatus: null, attempted: false };
  if (!safeWebhookUrl(raw)) return { status: "failed", httpStatus: null, attempted: false };
  return null;
}

async function deliver(
  sql: Sql,
  clientId: string,
  jobId: string,
  duplicate: boolean,
  shouldSend: boolean,
  dispatch: (notice: PhotoJobNotice) => Promise<PhotoDispatchResult>,
): Promise<Response> {
  if (!shouldSend) {
    const prior = await deliveryFor(sql, jobId);
    const make = prior?.status === "sent" ? "sent" : prior?.status === "failed" || prior?.dispatch_state === "attempted_unknown" ? "failed" : "skipped";
    return queued(jobId, true, make, prior?.dispatch_state ?? null);
  }
  if (dispatch === dispatchPhotoGeneration) {
    const blocked = preflightWebhook();
    if (blocked) {
      await recordNeverAttempted(sql, clientId, jobId);
      await releaseUnsentReservation(sql, clientId, jobId);
      return queued(jobId, duplicate, blocked.status, "never_attempted");
    }
  }
  const claim = await claimSend(sql, clientId, jobId);
  if (claim !== "send") {
    const prior = await deliveryFor(sql, jobId);
    const make = prior?.status === "sent" ? "sent" : "failed";
    return queued(jobId, true, make, prior?.dispatch_state ?? "attempted_unknown");
  }
  let result: PhotoDispatchResult;
  try {
    result = await dispatch({
      event: "content.generation_requested",
      job_id: jobId,
      client_id: clientId,
      platform: "instagram",
      content_type: "photo",
      occurred_at: new Date().toISOString(),
    });
  } catch {
    return queued(jobId, true, "failed", "attempted_unknown");
  }
  if (!result.attempted) {
    await finishSend(sql, jobId, { status: "failed", httpStatus: result.httpStatus, attempted: true });
    return queued(jobId, true, "failed", "attempted_unknown");
  }
  await finishSend(sql, jobId, result);
  return queued(jobId, duplicate, result.status, "attempted_unknown");
}
