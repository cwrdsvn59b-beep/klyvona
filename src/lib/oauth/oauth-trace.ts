import { readStoredInstagramGrant, type InstagramGrantStatus } from "./meta-guards.ts";

export const OAUTH_TRACE_LIMIT = 40;
export const OAUTH_TRACE_TTL_MS = 2 * 60 * 60 * 1000;

export const OAUTH_TRACE_OPERATIONS = [
  "instagram_callback",
  "permissions_field",
  "pending_saved",
  "authorization_confirmed",
  "payload_transferred",
  "instagram_renew",
  "permissions_checked",
] as const;

export type OAuthTraceOperation = (typeof OAUTH_TRACE_OPERATIONS)[number];
export type OAuthTraceGrantStatus = InstagramGrantStatus | "not_stored";
export type OAuthTraceGrantSource = "oauth_exchange" | "preserved_on_refresh" | "not_stored";

export type OAuthTraceEntry = {
  at: string;
  operation: OAuthTraceOperation;
  result: "success" | "error";
  grantStatus: OAuthTraceGrantStatus;
  grantSource: OAuthTraceGrantSource;
  permissionsPresent: boolean;
};

const OPERATIONS = new Set<string>(OAUTH_TRACE_OPERATIONS);
const GRANT_STATUSES = new Set<string>(["permissions_confirmed", "permissions_missing", "permissions_unknown", "not_stored"]);
const GRANT_SOURCES = new Set<string>(["oauth_exchange", "preserved_on_refresh", "not_stored"]);

const entries: OAuthTraceEntry[] = [];

export function emptyOAuthTraceGrant(): Pick<OAuthTraceEntry, "grantStatus" | "grantSource" | "permissionsPresent"> {
  return { grantStatus: "not_stored", grantSource: "not_stored", permissionsPresent: false };
}

export function traceFromStored(payload: unknown): Pick<OAuthTraceEntry, "grantStatus" | "grantSource" | "permissionsPresent"> {
  const stored = readStoredInstagramGrant(payload);
  return {
    grantStatus: stored.status,
    grantSource: stored.source,
    permissionsPresent: stored.granted.length > 0,
  };
}

function prune(now: number): void {
  const cutoff = now - OAUTH_TRACE_TTL_MS;
  while (entries.length > 0 && Date.parse(entries[0]?.at ?? "") < cutoff) entries.shift();
  while (entries.length > OAUTH_TRACE_LIMIT) entries.shift();
}

/** Keeps only the safe diagnostic fields. Extra properties are dropped. */
export function recordOAuthTrace(
  input: {
    operation: OAuthTraceOperation;
    result: "success" | "error";
    grantStatus: OAuthTraceGrantStatus;
    grantSource: OAuthTraceGrantSource;
    permissionsPresent: boolean;
  },
  now = new Date(),
): OAuthTraceEntry | null {
  if (!OPERATIONS.has(input.operation)) return null;
  const entry: OAuthTraceEntry = {
    at: now.toISOString(),
    operation: input.operation,
    result: input.result === "success" ? "success" : "error",
    grantStatus: GRANT_STATUSES.has(input.grantStatus) ? input.grantStatus : "permissions_unknown",
    grantSource: GRANT_SOURCES.has(input.grantSource) ? input.grantSource : "not_stored",
    permissionsPresent: input.permissionsPresent === true,
  };
  entries.push(entry);
  prune(now.getTime());
  return entry;
}

export function readOAuthTrace(now = new Date()): OAuthTraceEntry[] {
  prune(now.getTime());
  return entries.map((entry) => ({ ...entry }));
}

export function clearOAuthTrace(): void {
  entries.length = 0;
}

export function oauthTraceForAdmin(access: { isAdmin: boolean }, now = new Date()): OAuthTraceEntry[] {
  if (!access.isAdmin) throw new Error("forbidden");
  return readOAuthTrace(now);
}
