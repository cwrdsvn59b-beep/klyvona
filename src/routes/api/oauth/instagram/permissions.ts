import { createFileRoute } from "@tanstack/react-router";
import { automationReadinessForConnect, rememberCheckedPermission } from "@/lib/approval.server";
import { checkInstagramPublishPermission } from "@/lib/oauth/instagram.server";

export const Route = createFileRoute("/api/oauth/instagram/permissions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.clone().text();
        const response = await checkInstagramPublishPermission(request);
        try {
          const sent = JSON.parse(raw) as { reference?: unknown; connectSecret?: unknown };
          const body = (await response.clone().json()) as { permission?: unknown };
          if (typeof sent.reference === "string" && typeof sent.connectSecret === "string" && typeof body.permission === "string") {
            await rememberCheckedPermission({
              reference: sent.reference,
              connectSecret: sent.connectSecret,
              permission: body.permission,
            });
          }
        } catch (error) {
          console.error("[approval] permission record failed", error instanceof Error ? error.name : "error");
        }
        // The readiness snapshot is read-only and scoped by the same client secret.
        // A historical OAuth grant alone never satisfies the activation gate.
        if (!response.ok) return response;
        try {
          const sent = JSON.parse(raw) as { reference?: unknown; connectSecret?: unknown };
          if (typeof sent.reference !== "string" || typeof sent.connectSecret !== "string") return response;
          const readiness = await automationReadinessForConnect({ reference: sent.reference, connectSecret: sent.connectSecret });
          if (!readiness) return response;
          const body = (await response.clone().json()) as Record<string, unknown>;
          return Response.json({ ...body, readiness }, { status: response.status, headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("[approval] readiness read failed", error instanceof Error ? error.name : "error");
          return response;
        }
      },
    },
  },
});
