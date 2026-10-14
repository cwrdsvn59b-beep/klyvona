import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/server-version")({
  server: {
    handlers: {
      GET: async () => {
        const { instagramPublishVersionResponse } = await import("@/lib/instagram-publish-version.server");
        return instagramPublishVersionResponse();
      },
    },
  },
});
