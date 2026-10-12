import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { IntegrationHealth } from "@/lib/integrations/health.server";

const SUBSCRIPTION_STATUSES = ["trial", "awaiting_billing", "active", "past_due", "cancelled"] as const;
const PUBLISHING_STATUSES = ["waiting_connection", "scheduled", "publishing", "paused", "error"] as const;

export type SocialSnap = {
  platform: string;
  status: string;
  lastError: string | null;
  tokenExpiresAt: string | null;
};

export type ClientListItem = {
  id: string;
  reference: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  industry: string;
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  publishingStatus: string;
  postsUsed: number;
  postsQuota: number;
  createdAt: string;
  socials: SocialSnap[];
};

export type WarningItem = {
  id: string;
  clientId: string;
  businessName: string;
  reference: string;
  kind: "social" | "job" | "webhook";
  message: string;
};

export type DashboardData = {
  stats: { clients: number; waiting: number; issues: number; subscriptions: number };
  warnings: WarningItem[];
  integrations: IntegrationHealth[];
  clients: ClientListItem[];
};

export type ClientProfile = ClientListItem & {
  description: string;
  targetAudience: string;
  brandVoice: string;
  services: string;
  visualStyle: string;
  priceIlsInclVat: number;
  events: Array<{ id: string; step: string; status: string; detail: string | null; createdAt: string }>;
  jobs: Array<{ id: string; platform: string | null; status: string; errorMessage: string | null; createdAt: string }>;
  webhooks: Array<{ id: string; destination: string; status: string; httpStatus: number | null; detail: string | null; createdAt: string }>;
};

async function requireAdmin(userId: string): Promise<void> {
  const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
  const access = await resolveAdminAccess(userId);
  if (!access.isAdmin) throw new Error("אין הרשאת ניהול");
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

type ClientRow = {
  id: string;
  reference_code: string;
  contact_name: string;
  email: string;
  phone: string;
  industry: string;
  business_name: string;
  description: string;
  target_audience: string;
  brand_voice: string;
  services: string;
  visual_style: string;
  plan_code: string;
  plan_name: string;
  price_ils_incl_vat: number;
  subscription_status: string;
  publishing_status: string;
  posts_used: number;
  posts_quota: number;
  created_at: string;
};

function toListItem(row: ClientRow, socials: SocialSnap[]): ClientListItem {
  return {
    id: row.id,
    reference: row.reference_code,
    businessName: row.business_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    planCode: row.plan_code,
    planName: row.plan_name,
    subscriptionStatus: row.subscription_status,
    publishingStatus: row.publishing_status,
    postsUsed: Number(row.posts_used),
    postsQuota: Number(row.posts_quota),
    createdAt: row.created_at,
    socials,
  };
}

const CLIENT_SELECT = `
  select
    c.id,
    c.reference_code,
    c.contact_name,
    c.email,
    c.phone,
    c.publishing_status,
    c.created_at::text as created_at,
    b.business_name,
    b.industry,
    b.description,
    b.target_audience,
    b.brand_voice,
    b.services,
    b.visual_style,
    s.plan_code,
    s.status as subscription_status,
    s.posts_used::int as posts_used,
    s.posts_quota::int as posts_quota,
    p.name_he as plan_name,
    p.price_ils_incl_vat::int as price_ils_incl_vat
  from clients c
  join business_profiles b on b.client_id = c.id
  join client_subscriptions s on s.client_id = c.id
  join subscription_plans p on p.code = s.plan_code
`;

async function socialsFor(ids: string[]): Promise<Map<string, SocialSnap[]>> {
  const map = new Map<string, SocialSnap[]>();
  if (ids.length === 0) return map;
  const sql = await getSql();
  const rows = await sql.query<{
    client_id: string;
    platform: string;
    status: string;
    last_error: string | null;
    token_expires_at: string | null;
  }>(
    `
    select client_id, platform, status, last_error, token_expires_at::text as token_expires_at
    from social_accounts
    where client_id = any($1::text[])
    `,
    [ids],
  );
  for (const row of rows) {
    const list = map.get(row.client_id) ?? [];
    list.push({
      platform: row.platform,
      status: row.status,
      lastError: row.last_error,
      tokenExpiresAt: row.token_expires_at,
    });
    map.set(row.client_id, list);
  }
  return map;
}

export const getAdminAccess = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
    return resolveAdminAccess(context.userId);
  });

export const getOAuthTrace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
    const { oauthTraceForAdmin } = await import("@/lib/oauth/oauth-trace");
    const access = await resolveAdminAccess(context.userId);
    return oauthTraceForAdmin(access);
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const query =
      typeof input === "object" &&
      input !== null &&
      "query" in input &&
      typeof (input as { query: unknown }).query === "string"
        ? (input as { query: string }).query.trim().slice(0, 80)
        : "";
    return { query };
  })
  .handler(async ({ context, data }): Promise<DashboardData> => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const pattern = data.query ? likePattern(data.query) : null;
    const rows = pattern
      ? await sql.query<ClientRow>(
          `${CLIENT_SELECT}
           where b.business_name ilike $1 escape '\\'
              or c.contact_name ilike $1 escape '\\'
              or c.email ilike $1 escape '\\'
              or c.phone ilike $1 escape '\\'
              or c.reference_code ilike $1 escape '\\'
              or b.industry ilike $1 escape '\\'
           order by c.created_at desc
           limit 100`,
          [pattern],
        )
      : await sql.query<ClientRow>(`${CLIENT_SELECT} order by c.created_at desc limit 100`);

    const socialMap = await socialsFor(rows.map((row) => row.id));
    const statsRows = await sql<{
      clients: number;
      waiting: number;
      issues: number;
      subscriptions: number;
    }>`
      select
        (select count(*)::int from clients) as clients,
        (select count(*)::int from clients where publishing_status = 'waiting_connection') as waiting,
        (
          select count(*)::int from social_accounts
          where status in ('error', 'expired') or last_error is not null
        ) as issues,
        (select count(*)::int from client_subscriptions where status in ('trial', 'active', 'awaiting_billing')) as subscriptions
    `;
    const stats = statsRows[0] ?? { clients: 0, waiting: 0, issues: 0, subscriptions: 0 };

    const socialWarnings = await sql<{
      id: string;
      client_id: string;
      business_name: string;
      reference_code: string;
      platform: string;
      status: string;
      last_error: string | null;
    }>`
      select sa.id, sa.client_id, b.business_name, c.reference_code, sa.platform, sa.status, sa.last_error
      from social_accounts sa
      join clients c on c.id = sa.client_id
      join business_profiles b on b.client_id = c.id
      where sa.status in ('error', 'expired')
         or sa.last_error is not null
         or (
           sa.status = 'connected'
           and sa.token_expires_at is not null
           and sa.token_expires_at < now() + interval '7 days'
         )
      order by c.created_at desc
      limit 20
    `;
    const jobWarnings = await sql<{
      id: string;
      client_id: string;
      business_name: string;
      reference_code: string;
      error_message: string | null;
    }>`
      select j.id, j.client_id, b.business_name, c.reference_code, j.error_message
      from publishing_jobs j
      join clients c on c.id = j.client_id
      join business_profiles b on b.client_id = c.id
      where j.status = 'failed'
      order by j.created_at desc
      limit 20
    `;
    const hookWarnings = await sql<{
      id: string;
      client_id: string;
      business_name: string;
      reference_code: string;
      detail: string | null;
    }>`
      select w.id, w.client_id, b.business_name, c.reference_code, w.detail
      from webhook_deliveries w
      join clients c on c.id = w.client_id
      join business_profiles b on b.client_id = c.id
      where w.status = 'failed'
      order by w.created_at desc
      limit 20
    `;

    const warnings: WarningItem[] = [
      ...socialWarnings.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        businessName: row.business_name,
        reference: row.reference_code,
        kind: "social" as const,
        message:
          row.status === "expired"
            ? `${row.platform}: תוקף החיבור עומד לפוג או פג`
            : `${row.platform}: ${row.last_error ?? "שגיאת חיבור"}`,
      })),
      ...jobWarnings.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        businessName: row.business_name,
        reference: row.reference_code,
        kind: "job" as const,
        message: row.error_message ?? "פרסום נכשל",
      })),
      ...hookWarnings.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        businessName: row.business_name,
        reference: row.reference_code,
        kind: "webhook" as const,
        message: row.detail ?? "התראת Make נכשלה",
      })),
    ];

    const { integrationHealth } = await import("@/lib/integrations/health.server");

    return {
      stats: {
        clients: Number(stats.clients),
        waiting: Number(stats.waiting),
        issues: Number(stats.issues) + jobWarnings.length + hookWarnings.length,
        subscriptions: Number(stats.subscriptions),
      },
      warnings,
      integrations: integrationHealth(),
      clients: rows.map((row) => toListItem(row, socialMap.get(row.id) ?? [])),
    };
  });

export const getClientProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("מזהה לא תקין");
    return id;
  })
  .handler(async ({ context, data: clientId }): Promise<ClientProfile | null> => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql.query<ClientRow>(`${CLIENT_SELECT} where c.id = $1 limit 1`, [clientId]);
    const row = rows[0];
    if (!row) return null;
    const socialMap = await socialsFor([clientId]);
    const events = await sql<{
      id: string;
      step: string;
      status: string;
      detail: string | null;
      created_at: string;
    }>`
      select id, step, status, detail, created_at::text as created_at
      from onboarding_events
      where client_id = ${clientId}
      order by created_at asc
    `;
    const jobs = await sql<{
      id: string;
      platform: string | null;
      status: string;
      error_message: string | null;
      created_at: string;
    }>`
      select id, platform, status, error_message, created_at::text as created_at
      from publishing_jobs
      where client_id = ${clientId}
      order by created_at desc
    `;
    const webhooks = await sql<{
      id: string;
      destination: string;
      status: string;
      http_status: number | null;
      detail: string | null;
      created_at: string;
    }>`
      select id, destination, status, http_status, detail, created_at::text as created_at
      from webhook_deliveries
      where client_id = ${clientId}
      order by created_at desc
    `;
    return {
      ...toListItem(row, socialMap.get(clientId) ?? []),
      description: row.description,
      targetAudience: row.target_audience,
      brandVoice: row.brand_voice,
      services: row.services,
      visualStyle: row.visual_style,
      priceIlsInclVat: Number(row.price_ils_incl_vat),
      events: events.map((event) => ({
        id: event.id,
        step: event.step,
        status: event.status,
        detail: event.detail,
        createdAt: event.created_at,
      })),
      jobs: jobs.map((job) => ({
        id: job.id,
        platform: job.platform,
        status: job.status,
        errorMessage: job.error_message,
        createdAt: job.created_at,
      })),
      webhooks: webhooks.map((hook) => ({
        id: hook.id,
        destination: hook.destination,
        status: hook.status,
        httpStatus: hook.http_status === null ? null : Number(hook.http_status),
        detail: hook.detail,
        createdAt: hook.created_at,
      })),
    };
  });

export const updateClientOps = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (typeof input !== "object" || input === null) throw new Error("בקשה לא תקינה");
    const body = input as {
      clientId?: unknown;
      subscriptionStatus?: unknown;
      publishingStatus?: unknown;
    };
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error("מזהה לא תקין");
    const subscriptionStatus =
      body.subscriptionStatus === undefined
        ? undefined
        : SUBSCRIPTION_STATUSES.find((status) => status === body.subscriptionStatus);
    const publishingStatus =
      body.publishingStatus === undefined
        ? undefined
        : PUBLISHING_STATUSES.find((status) => status === body.publishingStatus);
    if (body.subscriptionStatus !== undefined && !subscriptionStatus) throw new Error("סטטוס מנוי לא תקין");
    if (body.publishingStatus !== undefined && !publishingStatus) throw new Error("סטטוס פרסום לא תקין");
    if (!subscriptionStatus && !publishingStatus) throw new Error("אין מה לעדכן");
    return { clientId, subscriptionStatus, publishingStatus };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const found = await sql<{ id: string }>`select id from clients where id = ${data.clientId} limit 1`;
    if (!found[0]) return { ok: false as const, message: "הלקוח לא נמצא" };
    if (data.subscriptionStatus) {
      await sql`
        update client_subscriptions
        set status = ${data.subscriptionStatus}
        where client_id = ${data.clientId}
      `;
    }
    if (data.publishingStatus) {
      await sql`
        update clients
        set publishing_status = ${data.publishingStatus}, updated_at = now()
        where id = ${data.clientId}
      `;
    } else {
      await sql`update clients set updated_at = now() where id = ${data.clientId}`;
    }
    const detail = [
      data.subscriptionStatus ? `מנוי: ${data.subscriptionStatus}` : null,
      data.publishingStatus ? `פרסום: ${data.publishingStatus}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    await sql`
      insert into onboarding_events (id, client_id, step, status, detail)
      values (${crypto.randomUUID()}, ${data.clientId}, 'admin', 'updated', ${detail})
    `;
    return { ok: true as const };
  });
