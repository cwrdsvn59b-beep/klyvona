function secretKey(key) {
  return (
    key === "DATABASE_URL" ||
    key.startsWith("NEON") ||
    key.startsWith("META_") ||
    key.startsWith("INSTAGRAM_") ||
    key.startsWith("TIKTOK_") ||
    key.startsWith("BETTER_AUTH") ||
    key.startsWith("GROK_AUTH") ||
    key.startsWith("KLYVONA_") ||
    key === "TOKEN_ENCRYPTION_KEY" ||
    key.includes("SECRET") ||
    key.includes("TOKEN")
  );
}

/** Blank secrets so Vite's env-file merge cannot restore a production database URL. */
export function isolatedServerEnv(baseEnv, fileEnv = {}) {
  const env = { ...baseEnv };
  for (const key of new Set([...Object.keys(env), ...Object.keys(fileEnv)])) {
    if (secretKey(key)) env[key] = "";
  }
  const merged = { ...fileEnv };
  for (const key of Object.keys(env)) merged[key] = env[key];
  return merged;
}
