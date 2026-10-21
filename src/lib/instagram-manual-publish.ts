export const MANUAL_CONFIRMATION = "PUBLISH INSTAGRAM PHOTO";

export type ManualPhase = "preparation" | "publishing" | "success" | "error";

const OPEN_STATUSES = [
  "reserved",
  "container_requested",
  "container_created",
  "publish_requested",
  "uncertain",
] as const;

export function manualPhase(status: string | null | undefined): ManualPhase {
  if (!status) return "preparation";
  if (
    status === "reserved"
    || status === "container_requested"
    || status === "container_created"
    || status === "publish_requested"
  ) return "publishing";
  if (status === "published") return "success";
  return "error";
}

/** A later explicit post is allowed. This never means an automatic retry. */
export function anotherExplicitPostAllowed(status: string | null | undefined): boolean {
  return !status || status === "published" || status === "failed_before_request";
}

export function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  return normalizeClientId(value);
}

export function normalizeManualCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\u0000/g, "").normalize("NFC");
  if (text.trim().length === 0 || text.length > 2200) return null;
  return text;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "metadata.google.internal"
  ) return true;
  if (host.includes(":")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return true;
}

/** Public HTTPS URL Meta can fetch. No credentials, local hosts, or IP literals. */
export function normalizePublicJpegUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (blockedHost(url.hostname)) return null;
  url.hash = "";
  return url.toString();
}

export function instagramPermalink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "www.instagram.com" && url.hostname !== "instagram.com") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

export function isOpenManualStatus(status: string | null | undefined): boolean {
  return OPEN_STATUSES.some((item) => item === status);
}
