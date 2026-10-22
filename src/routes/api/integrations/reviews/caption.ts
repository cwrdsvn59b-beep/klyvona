import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/reviews/caption")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getSql } = await import("@/lib/db");
        const { authorizeConnectClient, savePhotoCaption } = await import("@/lib/integrations/photo-review.server");
        let body: { reference?: unknown; connectSecret?: unknown; job_id?: unknown; caption?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, code: "invalid", published: false }, { status: 400, headers: { "cache-control": "no-store" } });
        }
        const sql = await getSql();
        const client = await authorizeConnectClient(
          sql,
          typeof body.reference === "string" ? body.reference.trim() : "",
          typeof body.connectSecret === "string" ? body.connectSecret : "",
        );
        if (!client) return Response.json({ ok: false, code: "unauthorized", published: false }, { status: 401, headers: { "cache-control": "no-store" } });
        const result = await savePhotoCaption(sql, client.id, typeof body.job_id === "string" ? body.job_id : "", body.caption);
        const status = result.ok ? 200 : result.code === "not_found" ? 404 : result.code === "locked" ? 409 : 400;
        return Response.json(result.ok
          ? { ok: true, job_id: result.item.jobId, review_status: result.item.reviewStatus, published: false }
          : { ok: false, code: result.code, published: false }, { status, headers: { "cache-control": "no-store" } });
      },
    },
  },
});
