import { createServerFn } from "@tanstack/react-start";
import {
  authorizeConnectClient,
  decidePhotoReview,
  listPhotoReviews,
  savePhotoCaption,
} from "@/lib/integrations/photo-review.server";

function credentials(data: unknown): { reference: string; connectSecret: string } | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { reference?: unknown; connectSecret?: unknown };
  if (typeof body.reference !== "string" || typeof body.connectSecret !== "string") return null;
  return { reference: body.reference.trim(), connectSecret: body.connectSecret };
}

async function ownClient(data: unknown) {
  const creds = credentials(data);
  if (!creds) return null;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const client = await authorizeConnectClient(sql, creds.reference, creds.connectSecret);
  return client ? { sql, clientId: client.id } : null;
}

export const listOwnPhotoReviews = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const own = await ownClient(data);
    if (!own) return { ok: false as const, code: "unauthorized" as const };
    const items = await listPhotoReviews(own.sql, own.clientId);
    if (!Array.isArray(items)) return items;
    const { readQuotaView } = await import("@/lib/integrations/quota-period");
    return { ok: true as const, items, quota: await readQuotaView(own.sql, own.clientId) };
  });

export const saveOwnPhotoCaption = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const own = await ownClient(data);
    if (!own) return { ok: false as const, code: "unauthorized" as const, published: false as const };
    const body = data as { jobId?: unknown; caption?: unknown };
    return savePhotoCaption(own.sql, own.clientId, typeof body.jobId === "string" ? body.jobId : "", body.caption);
  });

export const decideOwnPhotoReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const own = await ownClient(data);
    if (!own) return { ok: false as const, code: "unauthorized" as const, published: false as const };
    const body = data as { jobId?: unknown; decision?: unknown };
    return decidePhotoReview(own.sql, own.clientId, typeof body.jobId === "string" ? body.jobId : "", body.decision);
  });
