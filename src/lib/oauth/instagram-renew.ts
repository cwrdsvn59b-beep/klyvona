import { readStoredInstagramGrant, type InstagramGrantStatus } from "./meta-guards.ts";

export type InstagramGrantSource = "oauth_exchange" | "preserved_on_refresh";

export type InstagramRenewPayload = {
  v: 2;
  userToken: string;
  igUserId: string;
  username?: string;
  grantStatus?: InstagramGrantStatus;
  grantSource?: InstagramGrantSource;
  grantedPermissions?: string[];
};

export function instagramTokenPayload(input: {
  accessToken: string;
  igUserId: string;
  username?: string | null;
  grant?: { status: InstagramGrantStatus; granted: readonly string[]; source: InstagramGrantSource };
}): InstagramRenewPayload {
  const payload: InstagramRenewPayload = { v: 2, userToken: input.accessToken, igUserId: input.igUserId };
  const username = input.username?.trim().replace(/^@/, "") ?? "";
  if (/^[A-Za-z0-9._]{1,30}$/.test(username) && /[A-Za-z]/.test(username)) payload.username = username;
  if (input.grant) {
    payload.grantStatus = input.grant.status;
    payload.grantSource = input.grant.source;
    if (input.grant.status !== "permissions_unknown") payload.grantedPermissions = [...input.grant.granted];
  }
  return payload;
}

/** Fields written to social_accounts after a successful Instagram refresh. */
export function instagramRenewWrite(input: {
  accessToken: string;
  igUserId: string;
  expiresIn: number | null;
  now: number;
  username?: string | null;
  previous?: unknown;
}): { tokenPayload: InstagramRenewPayload; expiresAt: string | null } {
  const tokenPayload = instagramTokenPayload({
    accessToken: input.accessToken,
    igUserId: input.igUserId,
    username: input.username,
  });
  if (input.previous && typeof input.previous === "object" && ("grantStatus" in input.previous || "grantedPermissions" in input.previous)) {
    const stored = readStoredInstagramGrant(input.previous);
    tokenPayload.grantStatus = stored.status;
    tokenPayload.grantSource = "preserved_on_refresh";
    if (stored.status !== "permissions_unknown") tokenPayload.grantedPermissions = stored.granted;
  }
  return {
    tokenPayload,
    expiresAt: input.expiresIn == null ? null : new Date(input.now + input.expiresIn * 1000).toISOString(),
  };
}

export function renewTarget(platform: unknown): "instagram" | "meta" {
  return platform === "instagram" ? "instagram" : "meta";
}
