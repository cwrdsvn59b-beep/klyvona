import { createFileRoute } from "@tanstack/react-router";
import { renewInstagram } from "@/lib/oauth/instagram.server";

export const Route = createFileRoute("/api/oauth/instagram/renew")({
  server: {
    handlers: {
      POST: ({ request }) => renewInstagram(request),
    },
  },
});
