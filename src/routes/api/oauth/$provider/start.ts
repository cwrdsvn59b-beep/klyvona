import { createFileRoute } from "@tanstack/react-router";
import { startInstagramOAuth } from "@/lib/oauth/instagram.server";
import { customerOAuthProvider } from "@/lib/oauth/customer-flow";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/start")({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        if (customerOAuthProvider(params.provider) === "instagram") return startInstagramOAuth(request);
        return oauthDisabledResponse(params.provider);
      },
      GET: ({ params }) => oauthDisabledResponse(params.provider),
    },
  },
});
