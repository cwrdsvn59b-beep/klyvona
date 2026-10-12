import { createFileRoute } from "@tanstack/react-router";
import { checkInstagramPublishPermission } from "@/lib/oauth/instagram.server";

export const Route = createFileRoute("/api/oauth/instagram/permissions")({
  server: {
    handlers: {
      POST: ({ request }) => checkInstagramPublishPermission(request),
    },
  },
});
