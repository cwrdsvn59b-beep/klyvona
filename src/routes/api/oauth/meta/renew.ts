import { createFileRoute } from "@tanstack/react-router";
import { renewInstagram } from "@/lib/oauth/instagram.server";
import { renewMeta } from "@/lib/oauth/meta.server";
import { renewTarget } from "@/lib/oauth/instagram-renew";

async function renew(request: Request): Promise<Response> {
  const preview = request.clone();
  let platform: unknown = "";
  try {
    const body = (await preview.json()) as { platform?: unknown };
    platform = body.platform;
  } catch {
    platform = "";
  }
  if (renewTarget(platform) === "instagram") return renewInstagram(request);
  return renewMeta(request);
}

export const Route = createFileRoute("/api/oauth/meta/renew")({
  server: {
    handlers: {
      POST: ({ request }) => renew(request),
    },
  },
});