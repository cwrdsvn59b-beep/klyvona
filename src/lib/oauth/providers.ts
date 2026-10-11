/**
 * OAuth architecture for Meta (Facebook + Instagram) and TikTok.
 * Production exchange stays off until credentials, approved permissions and
 * the callback are configured and separately verified. This module lists
 * public endpoints and the names of server env vars. It does not read secrets.
 */

export const SOCIAL_PROVIDERS = [
  {
    id: "facebook" as const,
    label: "Facebook",
    owner: "Meta",
    authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v26.0/oauth/access_token",
    scopes: [
      "pages_show_list",
      "pages_manage_posts",
      "pages_read_engagement",
      "instagram_basic",
      "instagram_content_publish",
    ],
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    callbackPath: "/api/oauth/facebook/callback",
  },
  {
    id: "instagram" as const,
    label: "Instagram",
    owner: "Meta",
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    clientIdEnv: "INSTAGRAM_APP_ID",
    clientSecretEnv: "INSTAGRAM_APP_SECRET",
    callbackPath: "/api/oauth/instagram/callback",
  },
  {
    id: "tiktok" as const,
    label: "TikTok",
    owner: "TikTok",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.list"],
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    callbackPath: "/api/oauth/tiktok/callback",
  },
] as const;

export type SocialPlatform = (typeof SOCIAL_PROVIDERS)[number]["id"];

export function findProvider(id: string) {
  return SOCIAL_PROVIDERS.find((provider) => provider.id === id) ?? null;
}
