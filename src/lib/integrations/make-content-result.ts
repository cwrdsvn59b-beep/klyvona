import { normalizeManualCaption, normalizePublicJpegUrl } from "@/lib/instagram-manual-publish";

/** Documented sample ids. They are never a production client or job. */
export const SAMPLE_MAKE_JOB_ID = "test_photo_001";
export const SAMPLE_MAKE_CLIENT_ID = "client_test_001";

export type MakeContentPayload = {
  jobId: string;
  clientId: string;
  platform: "instagram";
  contentType: "photo";
  caption: string;
  imageUrl: string;
  status: "generated";
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function parseMakeContentResult(
  input: unknown,
): { ok: true; value: MakeContentPayload } | { ok: false; code: "invalid" | "test_fixture_rejected" } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "invalid" };
  const body = input as Record<string, unknown>;
  const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  if (!ID_PATTERN.test(jobId) || !ID_PATTERN.test(clientId)) return { ok: false, code: "invalid" };
  if (jobId === SAMPLE_MAKE_JOB_ID || clientId === SAMPLE_MAKE_CLIENT_ID) {
    return { ok: false, code: "test_fixture_rejected" };
  }
  if (body.platform !== "instagram" || body.content_type !== "photo" || body.status !== "generated") {
    return { ok: false, code: "invalid" };
  }
  const caption = normalizeManualCaption(body.caption);
  const imageUrl = normalizePublicJpegUrl(body.image_url);
  if (!caption || !imageUrl) return { ok: false, code: "invalid" };
  return {
    ok: true,
    value: { jobId, clientId, platform: "instagram", contentType: "photo", caption, imageUrl, status: "generated" },
  };
}
