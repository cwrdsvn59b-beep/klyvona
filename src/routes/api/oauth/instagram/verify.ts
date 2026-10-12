import { createFileRoute } from "@tanstack/react-router";
import { verifyInstagramIdentity } from "@/lib/oauth/instagram.server";

export const Route = createFileRoute("/api/oauth/instagram/verify")({
  server: {
    handlers: {
      POST: ({ request }) => verifyInstagramIdentity(request),
    },
  },
});
