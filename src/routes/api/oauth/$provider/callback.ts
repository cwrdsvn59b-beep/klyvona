import { createFileRoute } from "@tanstack/react-router";
import { finishInstagramOAuth } from "@/lib/oauth/instagram.server";
import { customerOAuthProvider } from "@/lib/oauth/customer-flow";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/callback")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        if (customerOAuthProvider(params.provider) === "instagram") return finishInstagramOAuth(request);
        return oauthDisabledResponse(params.provider);
      },
    },
  },
});
