/** Public marker for the second-attempt build. It does not read the database or Meta. */
export const INSTAGRAM_PUBLISH_VERSION = "instagram-second-attempt-v2";

export function instagramPublishVersion() {
  const labeled = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  const commit = /^[0-9a-f]{7,40}$/i.test(labeled) ? labeled.slice(0, 12) : "source-tree";
  return { version: INSTAGRAM_PUBLISH_VERSION, commit };
}

export function instagramPublishVersionResponse(): Response {
  return Response.json(instagramPublishVersion(), {
    headers: { "cache-control": "no-store" },
  });
}
