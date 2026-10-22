import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/make/photo-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getSql } = await import("@/lib/db");
        const { createPhotoGenerationJob } = await import("@/lib/integrations/make-photo-job.server");
        let body: { reference?: unknown; connectSecret?: unknown; content_type?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: { "cache-control": "no-store" } });
        }
        return createPhotoGenerationJob({
          sql: await getSql(),
          reference: typeof body.reference === "string" ? body.reference : "",
          connectSecret: typeof body.connectSecret === "string" ? body.connectSecret : "",
          contentType: body.content_type,
        });
      },
    },
  },
});
