import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/make/content-result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getSql } = await import("@/lib/db");
        const { receiveMakeContentResult } = await import("@/lib/integrations/make-content-result.server");
        return receiveMakeContentResult(request, await getSql());
      },
    },
  },
});
