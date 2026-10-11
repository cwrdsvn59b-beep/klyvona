import { createFileRoute } from "@tanstack/react-router";
import { listPendingAccounts } from "@/lib/oauth/meta.server";

export const Route = createFileRoute("/api/oauth/meta/accounts")({
  server: {
    handlers: {
      POST: ({ request }) => listPendingAccounts(request),
    },
  },
});
