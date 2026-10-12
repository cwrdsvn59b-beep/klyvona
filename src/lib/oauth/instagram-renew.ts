export type InstagramRenewPayload = {
  v: 2;
  userToken: string;
  igUserId: string;
};

/** Fields written to social_accounts after a successful Instagram refresh. */
export function instagramRenewWrite(input: {
  accessToken: string;
  igUserId: string;
  expiresIn: number | null;
  now: number;
}): { tokenPayload: InstagramRenewPayload; expiresAt: string | null } {
  return {
    tokenPayload: { v: 2, userToken: input.accessToken, igUserId: input.igUserId },
    expiresAt: input.expiresIn == null ? null : new Date(input.now + input.expiresIn * 1000).toISOString(),
  };
}

export function renewTarget(platform: unknown): "instagram" | "meta" {
  return platform === "instagram" ? "instagram" : "meta";
}
