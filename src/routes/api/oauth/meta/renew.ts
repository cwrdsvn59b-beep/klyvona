import { createFileRoute } from "@tanstack/react-router";
import { renewMeta } from "@/lib/oauth/meta.server";

export const Route = createFileRoute("/api/oauth/meta/renew")({
  server: {
    handlers: {
      POST: ({ request }) => renewMeta(request),
    },
  },
});
