import { createFileRoute } from "@tanstack/react-router";
import { finishInstagramOAuth } from "@/lib/oauth/instagram.server";
import { finishMetaOAuth } from "@/lib/oauth/meta.server";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/callback")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        if (params.provider === "facebook") return finishMetaOAuth(request, "facebook");
        if (params.provider === "instagram") return finishInstagramOAuth(request);
        return oauthDisabledResponse(params.provider);
      },
    },
  },
});