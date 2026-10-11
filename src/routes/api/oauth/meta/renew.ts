import { createFileRoute } from "@tanstack/react-router";
import { renewInstagram } from "@/lib/oauth/instagram.server";
import { renewMeta } from "@/lib/oauth/meta.server";

async function renew(request: Request): Promise<Response> {
  const preview = request.clone();
  let platform = "";
  try {
    const body = (await preview.json()) as { platform?: unknown };
    if (body.platform === "instagram") platform = "instagram";
  } catch {
    platform = "";
  }
  if (platform === "instagram") return renewInstagram(request);
  return renewMeta(request);
}

export const Route = createFileRoute("/api/oauth/meta/renew")({
  server: {
    handlers: {
      POST: ({ request }) => renew(request),
    },
  },
});