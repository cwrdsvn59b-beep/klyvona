import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { decidePhotoReview, listPhotoReviews, parseReviewJobId, savePhotoCaption } from "@/lib/integrations/photo-review.server";

function clientIdOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { clientId?: unknown }).clientId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function staff(userId: string): Promise<boolean> {
  const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
  const access = await resolveAdminAccess(userId);
  return access.isAdmin;
}

export const listAdminPhotoReviews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    if (!(await staff(context.userId))) return { ok: false as const, code: "forbidden" as const };
    const clientId = clientIdOf(data);
    if (!clientId) return { ok: false as const, code: "invalid" as const };
    const { getSql } = await import("@/lib/db");
    const items = await listPhotoReviews(await getSql(), clientId);
    if (!Array.isArray(items)) return items;
    return { ok: true as const, items };
  });

export const saveAdminPhotoCaption = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    if (!(await staff(context.userId))) return { ok: false as const, code: "forbidden" as const, published: false as const };
    const clientId = clientIdOf(data);
    const body = data as { jobId?: unknown; caption?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!clientId || !parseReviewJobId(jobId)) return { ok: false as const, code: "invalid" as const, published: false as const };
    const { getSql } = await import("@/lib/db");
    return savePhotoCaption(await getSql(), clientId, jobId, body.caption);
  });

export const decideAdminPhotoReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    if (!(await staff(context.userId))) return { ok: false as const, code: "forbidden" as const, published: false as const };
    const clientId = clientIdOf(data);
    const body = data as { jobId?: unknown; decision?: unknown };
    if (!clientId) return { ok: false as const, code: "invalid" as const, published: false as const };
    const { getSql } = await import("@/lib/db");
    return decidePhotoReview(await getSql(), clientId, typeof body.jobId === "string" ? body.jobId : "", body.decision);
  });
