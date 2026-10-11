import { createFileRoute } from "@tanstack/react-router";
import { oauthDisabledResponse } from "@/lib/oauth/respond.server";

export const Route = createFileRoute("/api/oauth/$provider/start")({
  server: {
    handlers: {
      GET: ({ params }) => oauthDisabledResponse(params.provider),
      POST: ({ params }) => oauthDisabledResponse(params.provider),
    },
  },
});
