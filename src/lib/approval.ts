export const APPROVAL_STATUSES = ["pending_approval", "approved", "rejected", "suspended"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ACTIVATING_PUBLISHING = ["scheduled", "publishing"] as const;

export function isApprovalStatus(value: string | null | undefined): value is ApprovalStatus {
  return value === "pending_approval" || value === "approved" || value === "rejected" || value === "suspended";
}

/** Same status is a no-op. Approval can be granted again after a rejection or suspension. */
export function approvalTransition(from: ApprovalStatus, to: ApprovalStatus): "noop" | "ok" | "invalid" {
  if (from === to) return "noop";
  if (to === "approved" && (from === "pending_approval" || from === "rejected" || from === "suspended")) return "ok";
  if (to === "rejected" && from === "pending_approval") return "ok";
  if (to === "suspended" && from === "approved") return "ok";
  return "invalid";
}

export function subscriptionAllowsService(status: string | null | undefined): boolean {
  return status === "trial" || status === "active";
}

export function publishingWouldStart(status: string | null | undefined): status is "scheduled" | "publishing" {
  return status === "scheduled" || status === "publishing";
}

export type AutomationBlock = "approval" | "subscription" | "instagram" | "permission";

/**
 * Every condition is required. Administrator approval does not replace a
 * missing Meta permission, and a verified permission does not replace approval.
 */
export function automationDecision(input: {
  approvalStatus: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  instagramConnected: boolean;
  permissionConfirmedForToken: boolean;
}): { ok: true } | { ok: false; block: AutomationBlock } {
  if (input.approvalStatus !== "approved") return { ok: false, block: "approval" };
  if (!subscriptionAllowsService(input.subscriptionStatus)) return { ok: false, block: "subscription" };
  if (!input.instagramConnected) return { ok: false, block: "instagram" };
  if (!input.permissionConfirmedForToken) return { ok: false, block: "permission" };
  return { ok: true };
}

export function permissionConfirmedForToken(input: {
  permission: string | null | undefined;
  storedHash: string | null | undefined;
  currentHash: string | null | undefined;
}): boolean {
  return input.permission === "confirmed" && Boolean(input.storedHash) && input.storedHash === input.currentHash;
}

export function metaPermissionView(input: {
  permission: string | null | undefined;
  storedHash: string | null | undefined;
  currentHash: string | null | undefined;
  connected: boolean;
}): "unknown" | "confirmed" | "missing" | "stale" {
  if (!input.connected) return input.permission === "missing" ? "missing" : "unknown";
  if (input.permission === "confirmed") {
    return permissionConfirmedForToken(input) ? "confirmed" : "stale";
  }
  if (input.permission === "missing") return "missing";
  return "unknown";
}
