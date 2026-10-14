import { createFileRoute } from "@tanstack/react-router";
import { rememberCheckedPermission } from "@/lib/approval.server";
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
        return response;
      },
    },
  },
});
