import { isProductionRuntime } from "./db-mode.mjs";

/** Shared preview client. It is not a production administrator identity. */
const PREVIEW_CLIENT_ID = "grok_preview";

/**
 * Why production admin APIs must refuse the request.
 * Returns null when this process is not production, or when production auth
 * is explicitly configured. Never includes secret values.
 */
export function productionAdminAuthProblem(env = process.env) {
  if (!isProductionRuntime(env)) return null;
  if (env.VITE_AUTH_ENABLED === "false") {
    return "Authentication is disabled. Production admin APIs are closed.";
  }
  const id = typeof env.GROK_AUTH_CLIENT_ID === "string" ? env.GROK_AUTH_CLIENT_ID.trim() : "";
  const secret =
    typeof env.GROK_AUTH_CLIENT_SECRET === "string" ? env.GROK_AUTH_CLIENT_SECRET.trim() : "";
  if (!id || !secret || id === PREVIEW_CLIENT_ID) {
    return "Production admin sign-in is not configured. Admin APIs are closed.";
  }
  return null;
}

/** @param {string | null | undefined} userId */
export function adminIdentityDenied(userId) {
  return userId === "dev-user" || typeof userId !== "string" || !userId.trim();
}
