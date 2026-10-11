import { findProvider } from "@/lib/oauth/providers";

/** Production OAuth is intentionally disabled. Never exchange a code here. */
export function oauthDisabledResponse(platform: string | undefined): Response {
  const known = platform ? findProvider(platform) : null;
  if (!known) {
    return Response.json({ error: "unknown_platform" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return Response.json(
    {
      platform: known.id,
      connectionStatus: "awaiting_setup",
      oauthActivated: false,
      message:
        "Production OAuth is disabled until developer credentials, approved permissions, and the callback are configured and verified.",
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
