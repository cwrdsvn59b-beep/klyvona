import { createHash, timingSafeEqual } from "node:crypto";
import type { Sql } from "@/lib/db";
import { parseMakeContentResult } from "@/lib/integrations/make-content-result";
import { acceptGeneratedPhoto } from "@/lib/integrations/quota-period";

export const MAKE_CONTENT_RESULT_SECRET_ENV = "MAKE_CONTENT_RESULT_SECRET";
const HEADER = "authorization";
const MIN_SECRET_LENGTH = 24;
const MAX_BODY_BYTES = 16_000;

function digest(value: string): Buffer {
  return Buffer.from(createHash("sha256").update(value).digest("hex"));
}

export function makeContentSecretState(env: NodeJS.ProcessEnv = process.env): "ok" | "missing" {
  const secret = env[MAKE_CONTENT_RESULT_SECRET_ENV]?.trim() ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? "ok" : "missing";
}

export function makeContentRequestAuthorized(header: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env[MAKE_CONTENT_RESULT_SECRET_ENV]?.trim() ?? "";
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const matches = timingSafeEqual(digest(presented), digest(secret));
  return matches && secret.length >= MIN_SECRET_LENGTH;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function missingTable(error: unknown): boolean {
  const code = errorCode(error);
  return code === "42P01";
}

function missingColumn(error: unknown): boolean {
  return errorCode(error) === "42703";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
}

async function readyForReview(sql: Sql, jobId: string): Promise<void> {
  try {
    await sql`
      update publishing_jobs
      set awaiting_generation = false
      where id = ${jobId} and awaiting_generation is true
    `;
  } catch (error) {
    if (missingColumn(error)) return;
    throw error;
  }
}

function stored(jobId: string, duplicate: boolean): Response {
  return json(200, {
    ok: true,
    job_id: jobId,
    status: "generated",
    review: "ready",
    duplicate,
    published: false,
  });
}

/**
 * Accept one generated Instagram photo for an existing queued job.
 * Does not create clients, does not publish, and does not call Make or Meta.
 */
export async function receiveMakeContentResult(
  request: Request,
  sql: Sql,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, code: "method_not_allowed" });
  if (makeContentSecretState(env) === "missing") return json(503, { ok: false, code: "integration_not_configured" });
  if (!makeContentRequestAuthorized(request.headers.get(HEADER), env)) return json(401, { ok: false, code: "unauthorized" });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return json(400, { ok: false, code: "invalid" });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { ok: false, code: "payload_too_large" });

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return json(400, { ok: false, code: "invalid" });
  }
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return json(400, { ok: false, code: "invalid" });
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: "invalid" });
  }
  const parsed = parseMakeContentResult(parsedBody);
  if (!parsed.ok) return json(parsed.code === "test_fixture_rejected" ? 403 : 400, { ok: false, code: parsed.code });
  const value = parsed.value;

  try {
    const accepted = await acceptGeneratedPhoto(sql, {
      jobId: value.jobId,
      clientId: value.clientId,
      caption: value.caption,
      imageUrl: value.imageUrl,
    });
    if (!accepted.ok) {
      const status = accepted.code === "schema_unavailable" ? 503
        : accepted.code === "not_found" ? 404
          : accepted.code === "not_awaiting" ? 409
            : accepted.code === "conflict" ? 409
              : 403;
      return json(status, { ok: false, code: accepted.code });
    }
    await readyForReview(sql, value.jobId);
    return stored(value.jobId, accepted.duplicate);
  } catch (error) {
    if (missingTable(error)) return json(503, { ok: false, code: "schema_unavailable" });
    console.warn("[make-content] rejected", error instanceof Error ? error.name : "error");
    return json(500, { ok: false, code: "unavailable" });
  }
}
