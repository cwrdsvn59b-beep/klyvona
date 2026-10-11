/**
 * Production must use Neon. A published app is one the platform marked with
 * GROK_PROJECT_ID, or a Vercel production runtime. Those must not open
 * in-memory PGLite when DATABASE_URL is missing. Preview and local dev may.
 */

export function isProductionRuntime(env = process.env) {
  const id = env.GROK_PROJECT_ID;
  if (typeof id === "string" && id.trim()) return true;
  return env.VERCEL_ENV === "production";
}

export function configuredDatabaseUrl(env = process.env) {
  const raw = env.DATABASE_URL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

export function productionDatabaseProblem(env = process.env) {
  if (!isProductionRuntime(env)) return null;
  if (configuredDatabaseUrl(env)) return null;
  return "Production database is not configured. Set DATABASE_URL to Neon. In-memory PGLite is disabled for a published app.";
}
