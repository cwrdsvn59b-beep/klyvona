import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { type ApprovalStatus } from "@/lib/approval";
import { changeClientApproval, cleanReason, clientForConnectSecret } from "@/lib/approval.server";

export const getOwnApproval = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<{ ok: true; approvalStatus: ApprovalStatus } | { ok: false }> => {
    if (!data || typeof data !== "object") return { ok: false };
    const body = data as { reference?: unknown; connectSecret?: unknown };
    if (typeof body.reference !== "string" || typeof body.connectSecret !== "string") return { ok: false };
    const client = await clientForConnectSecret(body.reference.trim(), body.connectSecret);
    if (!client) return { ok: false };
    return { ok: true, approvalStatus: client.approvalStatus };
  });

export const setClientApproval = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("בקשה לא תקינה");
    const body = input as { clientId?: unknown; status?: unknown; reason?: unknown; isAdmin?: unknown };
    if ("isAdmin" in body) throw new Error("בקשה לא תקינה");
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error("מזהה לא תקין");
    const status = typeof body.status === "string" ? body.status : "";
    if (status !== "approved" && status !== "rejected" && status !== "suspended") {
      throw new Error("סטטוס אישור לא תקין");
    }
    return { clientId, status, reason: cleanReason(body.reason) };
  })
  .handler(async ({ context, data }) => {
    const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
    const access = await resolveAdminAccess(context.userId);
    if (!access.isAdmin) throw new Error("אין הרשאת ניהול");
    const next = data.status;
    if (next !== "approved" && next !== "rejected" && next !== "suspended") {
      return { ok: false as const, message: "key:admin.approvalInvalid" };
    }
    const result = await changeClientApproval({
      clientId: data.clientId,
      next,
      adminUserId: context.userId,
      reason: data.reason,
    });
    if (!result.ok && result.code === "missing") return { ok: false as const, message: "הלקוח לא נמצא" };
    if (!result.ok && result.code === "invalid") return { ok: false as const, message: "key:admin.approvalInvalid" };
    if (!result.ok) return { ok: false as const, message: "key:admin.approvalConflict" };
    if (result.unchanged) return { ok: true as const, unchanged: true, message: "key:admin.approvalUnchanged" };
    return { ok: true as const, unchanged: false, message: "key:admin.approvalSaved", webhookStatus: result.webhookStatus };
  });
