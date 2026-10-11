import { createFileRoute } from "@tanstack/react-router";
import { disconnectMeta } from "@/lib/oauth/meta.server";

export const Route = createFileRoute("/api/oauth/meta/disconnect")({
  server: {
    handlers: {
      POST: ({ request }) => disconnectMeta(request),
    },
  },
});
