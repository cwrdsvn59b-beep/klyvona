export type InstagramRenewPayload = {
  v: 2;
  userToken: string;
  igUserId: string;
  username?: string;
};

export function instagramTokenPayload(input: {
  accessToken: string;
  igUserId: string;
  username?: string | null;
}): InstagramRenewPayload {
  const payload: InstagramRenewPayload = { v: 2, userToken: input.accessToken, igUserId: input.igUserId };
  const username = input.username?.trim().replace(/^@/, "") ?? "";
  if (/^[A-Za-z0-9._]{1,30}$/.test(username) && /[A-Za-z]/.test(username)) payload.username = username;
  return payload;
}

/** Fields written to social_accounts after a successful Instagram refresh. */
export function instagramRenewWrite(input: {
  accessToken: string;
  igUserId: string;
  expiresIn: number | null;
  now: number;
  username?: string | null;
}): { tokenPayload: InstagramRenewPayload; expiresAt: string | null } {
  return {
    tokenPayload: instagramTokenPayload(input),
    expiresAt: input.expiresIn == null ? null : new Date(input.now + input.expiresIn * 1000).toISOString(),
  };
}

export function renewTarget(platform: unknown): "instagram" | "meta" {
  return platform === "instagram" ? "instagram" : "meta";
}
