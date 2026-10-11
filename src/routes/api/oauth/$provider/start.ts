import { createFileRoute } from "@tanstack/react-router";
import { startMetaOAuth } from "@/lib/oauth/meta.server";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/start")({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        if (params.provider === "facebook" || params.provider === "instagram") {
          return startMetaOAuth(request, params.provider);
        }
        return oauthDisabledResponse(params.provider);
      },
      GET: ({ params }) => oauthDisabledResponse(params.provider),
    },
  },
});
