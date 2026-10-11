import { createFileRoute } from "@tanstack/react-router";
import { selectPendingAccount } from "@/lib/oauth/meta.server";

export const Route = createFileRoute("/api/oauth/meta/select")({
  server: {
    handlers: {
      POST: ({ request }) => selectPendingAccount(request),
    },
  },
});
