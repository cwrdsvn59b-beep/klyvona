import { createHash } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { secretMatches } from "@/lib/oauth/meta-guards";
import {
  approvalTransition,
  automationDecision,
  isApprovalStatus,
  permissionConfirmedForToken,
  subscriptionAllowsService,
  type ApprovalStatus,
} from "@/lib/approval";

export function tokenHash(ciphertext: string): string {
  return createHash("sha256").update(ciphertext).digest("hex");
}

type ApprovalRow = {
  id: string;
  reference_code: string;
  approval_status: string;
  subscription_status: string | null;
  ig_status: string | null;
  external_account_id: string | null;
  token_ciphertext: string | null;
  publish_permission: string | null;
  publish_permission_token_hash: string | null;
};

async function readClient(sql: Sql, clientId: string): Promise<ApprovalRow | null> {
  const rows = await sql<ApprovalRow>`
    select
      c.id,
      c.reference_code,
      c.approval_status,
      s.status as subscription_status,
      sa.status as ig_status,
      sa.external_account_id,
      sa.token_ciphertext,
      sa.publish_permission,
      sa.publish_permission_token_hash
    from clients c
    left join client_subscriptions s on s.client_id = c.id
    left join social_accounts sa on sa.client_id = c.id and sa.platform = ${"instagram"}
    where c.id = ${clientId}
    limit 1
  `;
  return rows[0] ?? null;
}

export function decisionForRow(row: ApprovalRow): ReturnType<typeof automationDecision> {
  const connected = row.ig_status === "connected" && Boolean(row.external_account_id) && Boolean(row.token_ciphertext);
  const currentHash = row.token_ciphertext ? tokenHash(row.token_ciphertext) : null;
  return automationDecision({
    approvalStatus: row.approval_status,
    subscriptionStatus: row.subscription_status,
    instagramConnected: connected,
    permissionConfirmedForToken: permissionConfirmedForToken({
      permission: row.publish_permission,
      storedHash: row.publish_permission_token_hash,
      currentHash,
    }),
  });
}

/** Read-only customer-scoped activation diagnostics; never exposes token material. */
export async function automationReadinessForConnect(input: { reference: string; connectSecret: string }): Promise<{
  ready: boolean;
  block: "approval" | "subscription" | "instagram" | "permission" | null;
  approval: boolean;
  subscription: boolean;
  instagram: boolean;
  permission: boolean;
} | null> {
  const client = await clientForConnectSecret(input.reference.trim(), input.connectSecret);
  if (!client) return null;
  const row = await readClient(await getSql(), client.id);
  if (!row) return null;
  const connected = row.ig_status === "connected" && Boolean(row.external_account_id) && Boolean(row.token_ciphertext);
  const confirmed = permissionConfirmedForToken({
    permission: row.publish_permission,
    storedHash: row.publish_permission_token_hash,
    currentHash: row.token_ciphertext ? tokenHash(row.token_ciphertext) : null,
  });
  const decision = decisionForRow(row);
  return {
    ready: decision.ok,
    block: decision.ok ? null : decision.block,
    approval: row.approval_status === "approved",
    subscription: subscriptionAllowsService(row.subscription_status),
    instagram: connected,
    permission: confirmed,
  };
}

export async function automationAllowed(clientId: string): Promise<boolean> {
  const row = await readClient(await getSql(), clientId);
  return Boolean(row && decisionForRow(row).ok);
}

/** Stop queued or in-flight publishing flags. Safe to call more than once. */
export async function stopAutomation(clientId: string, sql?: Sql): Promise<void> {
  const db = sql ?? (await getSql());
  await db`
    update publishing_jobs
    set status = 'blocked', error_message = 'approval_revoked'
    where client_id = ${clientId} and status in ('queued', 'scheduled')
  `;
  await db`
    update clients
    set publishing_status = 'paused', updated_at = now()
    where id = ${clientId} and publishing_status in ('scheduled', 'publishing')
  `;
}

export async function publishingActivationAllowed(clientId: string, nextSubscription?: string): Promise<boolean> {
  if (nextSubscription && !subscriptionAllowsService(nextSubscription)) return false;
  const row = await readClient(await getSql(), clientId);
  if (!row) return false;
  return decisionForRow({
    ...row,
    subscription_status: nextSubscription ?? row.subscription_status,
  }).ok;
}

/** Writes a starting publishing status only while every gate still matches. */
export async function activatePublishing(clientId: string, status: "scheduled" | "publishing"): Promise<boolean> {
  const sql = await getSql();
  const row = await readClient(sql, clientId);
  if (!row?.token_ciphertext || !decisionForRow(row).ok) return false;
  const updated = await sql<{ id: string }>`
    update clients
    set publishing_status = ${status}, updated_at = now()
    where id = ${clientId}
      and approval_status = 'approved'
      and exists (
        select 1 from client_subscriptions s
        where s.client_id = clients.id and s.status in ('trial', 'active')
      )
      and exists (
        select 1 from social_accounts sa
        where sa.client_id = clients.id
          and sa.platform = 'instagram'
          and sa.status = 'connected'
          and sa.external_account_id is not null
          and sa.token_ciphertext = ${row.token_ciphertext}
          and sa.publish_permission = 'confirmed'
          and sa.publish_permission_token_hash = ${tokenHash(row.token_ciphertext)}
      )
    returning id
  `;
  return Boolean(updated[0]);
}

/**
 * Compare-and-swap approval change. A lost race retries from the new row.
 * An unchanged status does not write an audit row or a webhook.
 */
export async function changeClientApproval(input: {
  clientId: string;
  next: ApprovalStatus;
  adminUserId: string;
  reason: string | null;
}): Promise<
  | { ok: true; unchanged: boolean; status: ApprovalStatus; webhookStatus: "sent" | "failed" | "skipped" | null }
  | { ok: false; code: "missing" | "invalid" | "conflict" }
> {
  const next = input.next;
  if (next === "pending_approval") return { ok: false, code: "invalid" };
  const sql = await getSql();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readClient(sql, input.clientId);
    if (!current || !isApprovalStatus(current.approval_status)) {
      return current ? { ok: false, code: "invalid" } : { ok: false, code: "missing" };
    }
    const transition = approvalTransition(current.approval_status, next);
    if (transition === "noop") return { ok: true, unchanged: true, status: current.approval_status, webhookStatus: null };
    if (transition === "invalid") return { ok: false, code: "invalid" };

    const updated = await sql<{ id: string }>`
      update clients
      set approval_status = ${next},
          publishing_status = case
            when ${next} in ('rejected', 'suspended') and publishing_status in ('scheduled', 'publishing') then 'paused'
            else publishing_status
          end,
          updated_at = now()
      where id = ${input.clientId} and approval_status = ${current.approval_status}
      returning id
    `;
    if (!updated[0]) continue;

    if (next === "rejected" || next === "suspended") await stopAutomation(input.clientId, sql);
    await sql`
      insert into client_approval_events (id, client_id, previous_status, new_status, admin_user_id, reason)
      values (
        ${crypto.randomUUID()},
        ${input.clientId},
        ${current.approval_status},
        ${next},
        ${input.adminUserId},
        ${input.reason}
      )
    `;
    const webhookStatus = await notifyApproval(input.clientId, current.reference_code, next);
    return { ok: true, unchanged: false, status: next, webhookStatus };
  }
  return { ok: false, code: "conflict" };
}

async function notifyApproval(clientId: string, reference: string, status: Exclude<ApprovalStatus, "pending_approval">): Promise<"sent" | "failed" | "skipped"> {
  const event = status === "approved" ? "client.approved" : status === "rejected" ? "client.rejected" : "client.suspended";
  const allowed = status === "approved" ? await automationAllowed(clientId) : false;
  try {
    const { notifyMake } = await import("@/lib/integrations/make.server");
    const result = await notifyMake({
      event,
      client_id: clientId,
      reference,
      approval_status: status,
      automation_allowed: allowed,
      occurred_at: new Date().toISOString(),
    });
    const sql = await getSql();
    await sql`
      insert into webhook_deliveries (id, client_id, destination, status, http_status, detail)
      values (
        ${crypto.randomUUID()},
        ${clientId},
        'make',
        ${result.status},
        ${result.httpStatus},
        ${result.detail}
      )
    `;
    return result.status;
  } catch (error) {
    console.error("[approval] webhook failed", error instanceof Error ? error.name : "error");
    return "failed";
  }
}

export async function clientForConnectSecret(reference: string, connectSecret: string): Promise<{ id: string; approvalStatus: ApprovalStatus } | null> {
  if (!/^KV-[A-Z0-9]{6}$/.test(reference) || connectSecret.length < 20 || connectSecret.length > 200) return null;
  const sql = await getSql();
  const rows = await sql<{ id: string; connect_secret_hash: string | null; approval_status: string | null }>`
    select id, connect_secret_hash, approval_status
    from clients
    where reference_code = ${reference}
    limit 1
  `;
  const row = rows[0];
  if (!row || !secretMatches(connectSecret, row.connect_secret_hash)) return null;
  return { id: row.id, approvalStatus: isApprovalStatus(row.approval_status) ? row.approval_status : "pending_approval" };
}

/** Store a non-secret result of the existing read-only permission check. */
export async function rememberCheckedPermission(input: {
  reference: string;
  connectSecret: string;
  permission: string;
}): Promise<void> {
  if (input.permission !== "permission_confirmed" && input.permission !== "permission_missing" && input.permission !== "app_review_required") {
    return;
  }
  const client = await clientForConnectSecret(input.reference.trim(), input.connectSecret);
  if (!client) return;
  const sql = await getSql();
  const rows = await sql<{ token_ciphertext: string | null }>`
    select token_ciphertext from social_accounts
    where client_id = ${client.id} and platform = ${"instagram"}
    limit 1
  `;
  const ciphertext = rows[0]?.token_ciphertext;
  if (!ciphertext) return;
  if (input.permission === "permission_confirmed") {
    await sql`
      update social_accounts
      set publish_permission = 'confirmed',
          publish_permission_token_hash = ${tokenHash(ciphertext)},
          publish_permission_at = now()
      where client_id = ${client.id} and platform = ${"instagram"} and token_ciphertext = ${ciphertext}
    `;
    return;
  }
  await sql`
    update social_accounts
    set publish_permission = 'missing',
        publish_permission_token_hash = null,
        publish_permission_at = now()
    where client_id = ${client.id} and platform = ${"instagram"} and token_ciphertext = ${ciphertext}
  `;
}

export function cleanReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let reason = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) reason += char;
  }
  reason = reason.trim().slice(0, 400);
  return reason || null;
}
