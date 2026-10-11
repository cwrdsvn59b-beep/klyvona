import { createFileRoute } from "@tanstack/react-router";
import { finishMetaOAuth } from "@/lib/oauth/meta.server";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/callback")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        if (params.provider === "facebook" || params.provider === "instagram") {
          return finishMetaOAuth(request, params.provider);
        }
        return oauthDisabledResponse(params.provider);
      },
    },
  },
});
