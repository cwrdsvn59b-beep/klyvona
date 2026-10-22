import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 8_000;

function json(status: number, code: string): Response {
  return Response.json({ ok: false, code }, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/integrations/make/photo-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, "payload_too_large");
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("application/json")) return json(400, "invalid");
        let raw = "";
        try {
          raw = await request.text();
        } catch {
          return json(400, "invalid");
        }
        if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return json(raw.length > MAX_BODY_BYTES ? 413 : 400, raw.length > MAX_BODY_BYTES ? "payload_too_large" : "invalid");
        let body: { reference?: unknown; connectSecret?: unknown; content_type?: unknown };
        try {
          body = JSON.parse(raw) as { reference?: unknown; connectSecret?: unknown; content_type?: unknown };
        } catch {
          return json(400, "invalid");
        }
        if (body === null || typeof body !== "object" || Array.isArray(body)) return json(400, "invalid");
        const { getSql } = await import("@/lib/db");
        const { createPhotoGenerationJob } = await import("@/lib/integrations/make-photo-job.server");
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