export type ConnectPlatform = "facebook" | "instagram";

/** Returns the platform to start, or null when another OAuth start is already in flight. */
export function claimOAuthStart(
  current: ConnectPlatform | null,
  next: ConnectPlatform,
): ConnectPlatform | null {
  if (current) return null;
  return next;
}

/** Only the platform that is starting shows a loading state. */
export function oauthButtonBusy(current: ConnectPlatform | null, platform: ConnectPlatform): boolean {
  return current === platform;
}
