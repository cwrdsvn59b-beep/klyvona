import { createFileRoute } from "@tanstack/react-router";
import { startInstagramOAuth } from "@/lib/oauth/instagram.server";
import { startMetaOAuth } from "@/lib/oauth/meta.server";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/start")({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        if (params.provider === "facebook") return startMetaOAuth(request, "facebook");
        if (params.provider === "instagram") return startInstagramOAuth(request);
        return oauthDisabledResponse(params.provider);
      },
      GET: ({ params }) => oauthDisabledResponse(params.provider),
    },
  },
});