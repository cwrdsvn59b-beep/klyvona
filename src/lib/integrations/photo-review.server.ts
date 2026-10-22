import type { Sql } from "@/lib/db";
import { normalizeManualCaption, normalizePublicJpegUrl } from "@/lib/instagram-manual-publish";
import { secretMatches } from "@/lib/oauth/meta-guards";

export type ReviewStatus = "pending" | "approved" | "rejected";
export type ReviewDecision = "approved" | "rejected";

export type PhotoReview = {
  jobId: string;
  caption: string;
  imageUrl: string | null;
  generationStatus: "generated";
  reviewStatus: ReviewStatus;
  createdAt: string;
};

export type ReviewFailure = "invalid" | "not_found" | "locked" | "conflict" | "unavailable" | "forbidden" | "unauthorized";

type ReviewRow = {
  job_id: string;
  client_id: string;
  caption: string;
  image_url: string;
  status: string;
  review_status: string;
  created_at: string | Date;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
}

function schemaMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "42P01" || code === "42703";
}

function stamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function reviewStatus(value: string): ReviewStatus | null {
  return value === "pending" || value === "approved" || value === "rejected" ? value : null;
}

function view(row: ReviewRow): PhotoReview | null {
  const status = reviewStatus(row.review_status);
  if (row.status !== "generated" || !status) return null;
  return {
    jobId: row.job_id,
    caption: row.caption,
    imageUrl: normalizePublicJpegUrl(row.image_url),
    generationStatus: "generated",
    reviewStatus: status,
    createdAt: stamp(row.created_at),
  };
}

export function parseReviewJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export async function authorizeConnectClient(
  sql: Sql,
  reference: string,
  connectSecret: string,
): Promise<{ id: string } | null> {
  if (!/^KV-[A-Z0-9]{6}$/.test(reference) || connectSecret.length < 20 || connectSecret.length > 200) return null;
  const rows = await sql<{ id: string; connect_secret_hash: string | null }>`
    select id, connect_secret_hash from clients where reference_code = ${reference} limit 1
  `;
  const row = rows[0];
  if (!row || !secretMatches(connectSecret, row.connect_secret_hash)) return null;
  return { id: row.id };
}

async function readJob(sql: Sql, jobId: string): Promise<ReviewRow | null> {
  const rows = await sql<ReviewRow>`
    select job_id, client_id, caption, image_url, status, review_status, created_at
    from instagram_generation_results
    where job_id = ${jobId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listPhotoReviews(sql: Sql, clientId: string): Promise<PhotoReview[] | { ok: false; code: "unavailable" }> {
  try {
    const rows = await sql<ReviewRow>`
      select job_id, client_id, caption, image_url, status, review_status, created_at
      from instagram_generation_results
      where client_id = ${clientId}
      order by created_at desc
      limit 50
    `;
    return rows.flatMap((row) => {
      const item = view(row);
      return item ? [item] : [];
    });
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, code: "unavailable" };
    throw error;
  }
}

export async function savePhotoCaption(
  sql: Sql,
  clientId: string,
  jobId: string,
  caption: unknown,
): Promise<{ ok: true; item: PhotoReview; published: false } | { ok: false; code: ReviewFailure; published: false }> {
  const next = normalizeManualCaption(caption);
  if (!parseReviewJobId(jobId) || !next) return { ok: false, code: "invalid", published: false };
  try {
    const updated = await sql<ReviewRow>`
      update instagram_generation_results
      set caption = ${next}, updated_at = now()
      where job_id = ${jobId} and client_id = ${clientId} and review_status = 'pending'
      returning job_id, client_id, caption, image_url, status, review_status, created_at
    `;
    const saved = updated[0] ? view(updated[0]) : null;
    if (saved) return { ok: true, item: saved, published: false };
    const current = await readJob(sql, jobId);
    if (!current || current.client_id !== clientId) return { ok: false, code: "not_found", published: false };
    return { ok: false, code: "locked", published: false };
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, code: "unavailable", published: false };
    throw error;
  }
}

export async function decidePhotoReview(
  sql: Sql,
  clientId: string,
  jobId: string,
  decision: unknown,
): Promise<{ ok: true; item: PhotoReview; unchanged: boolean; published: false } | { ok: false; code: ReviewFailure; published: false }> {
  if (decision !== "approved" && decision !== "rejected") return { ok: false, code: "invalid", published: false };
  if (!parseReviewJobId(jobId)) return { ok: false, code: "invalid", published: false };
  try {
    const updated = await sql<ReviewRow>`
      update instagram_generation_results
      set review_status = ${decision}, updated_at = now()
      where job_id = ${jobId} and client_id = ${clientId} and review_status = 'pending'
      returning job_id, client_id, caption, image_url, status, review_status, created_at
    `;
    const saved = updated[0] ? view(updated[0]) : null;
    if (saved) return { ok: true, item: saved, unchanged: false, published: false };
    const current = await readJob(sql, jobId);
    if (!current || current.client_id !== clientId) return { ok: false, code: "not_found", published: false };
    if (current.review_status === decision) {
      const item = view(current);
      return item ? { ok: true, item, unchanged: true, published: false } : { ok: false, code: "conflict", published: false };
    }
    return { ok: false, code: "conflict", published: false };
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, code: "unavailable", published: false };
    throw error;
  }
}

export async function reviewForActor(
  sql: Sql,
  actor: { role: "client"; clientId: string } | { role: "admin"; isAdmin: boolean; clientId: string },
  action:
    | { type: "caption"; jobId: string; caption: unknown }
    | { type: "decision"; jobId: string; decision: unknown },
): Promise<{ ok: true; item: PhotoReview; unchanged?: boolean; published: false } | { ok: false; code: ReviewFailure; published: false }> {
  const clientId = actor.role === "admin" ? (actor.isAdmin ? actor.clientId : null) : actor.clientId;
  if (!clientId) return { ok: false, code: "forbidden", published: false };
  if (action.type === "caption") return savePhotoCaption(sql, clientId, action.jobId, action.caption);
  return decidePhotoReview(sql, clientId, action.jobId, action.decision);
}
