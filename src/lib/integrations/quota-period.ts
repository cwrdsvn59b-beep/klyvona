import type { Sql } from "@/lib/db";
import {
  RULES,
  checkQuota,
  isWorkday,
  paidPeriodAllowed,
  postingWindow,
  type Decision,
  type Plan,
  type Status,
} from "@/lib/subscription-policy";

export type QuotaCode = "schema_unavailable" | "not_entitled" | "not_connected" | "weekend" | "expired" | "quota" | "daily" | "subscription" | "invalid";

export type DispatchState = "never_attempted" | "attempted_unknown" | "confirmed_not_started" | "confirmed_generated";

export type QuotaView = {
  ledger: "period" | "unopened" | "unavailable";
  consumed: number;
  reserved: number;
  available: number;
  periodStart: string | null;
  periodLast: string | null;
  plan: string | null;
  status: string | null;
};

type PeriodRow = {
  id: string;
  plan_code: Plan;
  status: Status;
  period_start: string;
  period_last: string;
  posts_quota: number;
  daily_quota: number;
};

type CountRow = { consumed: number; reserved: number; today_consumed: number; today_reserved: number };

/** Server-built attestation. A client-supplied string is not this type. */
export type PaymentEvidence = {
  paymentId: string;
  amountIls: number;
  currency: string;
  source: "admin_attestation";
  confirmedBy: string;
};

export type ReconcileAudit = {
  actorId: string;
  reason: string;
  acknowledgeSpendRisk: boolean;
};

export type ReconcileOutcome =
  | "closed"
  | "kept"
  | "missing"
  | "spend_unknown"
  | "pending_decision"
  | "legacy_unclassified"
  | "invalid"
  | "schema_unavailable";

const PAYMENT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const ACTOR_ID = /^[A-Za-z0-9:_-]{1,80}$/;

export function jerusalemToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
}

export function quotaSchemaError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "42P01" || code === "42703";
}

function uniqueViolation(error: unknown): boolean {
  return errorCode(error) === "23505";
}

function emptyView(ledger: QuotaView["ledger"]): QuotaView {
  return {
    ledger,
    consumed: 0,
    reserved: 0,
    available: 0,
    periodStart: null,
    periodLast: null,
    plan: null,
    status: null,
  };
}

/**
 * Manual admin attestation is not a payment-provider settlement.
 * Amount, currency, and a server-authenticated actor are required.
 */
export function paymentEvidenceAccepted(evidence: PaymentEvidence): boolean {
  if (!paidPeriodAllowed(evidence.source === "admin_attestation")) return false;
  return evidence.currency === "ILS"
    && evidence.amountIls === RULES.monthly.priceIls
    && PAYMENT_ID.test(evidence.paymentId)
    && ACTOR_ID.test(evidence.confirmedBy);
}

async function counts(sql: Sql, clientId: string, periodId: string, today: string): Promise<CountRow> {
  const rows = await sql<CountRow>`
    select
      (select count(*)::int from instagram_generation_results r
        where r.client_id = ${clientId}
          and r.subscription_period_id = ${periodId}
          and r.status = 'generated') as consumed,
      (select count(*)::int from publishing_jobs j
        where j.client_id = ${clientId}
          and j.subscription_period_id = ${periodId}
          and j.platform = 'instagram'
          and j.status = 'queued'
          and j.awaiting_generation is true
          and not exists (select 1 from instagram_generation_results r where r.job_id = j.id)) as reserved,
      (select count(*)::int from instagram_generation_results r
        where r.client_id = ${clientId}
          and r.subscription_period_id = ${periodId}
          and r.status = 'generated'
          and (r.created_at at time zone 'Asia/Jerusalem')::date = ${today}::date) as today_consumed,
      (select count(*)::int from publishing_jobs j
        where j.client_id = ${clientId}
          and j.subscription_period_id = ${periodId}
          and j.platform = 'instagram'
          and j.status = 'queued'
          and j.awaiting_generation is true
          and not exists (select 1 from instagram_generation_results r where r.job_id = j.id)
          and (j.created_at at time zone 'Asia/Jerusalem')::date = ${today}::date) as today_reserved
  `;
  const row = rows[0];
  return {
    consumed: Number(row?.consumed ?? 0),
    reserved: Number(row?.reserved ?? 0),
    today_consumed: Number(row?.today_consumed ?? 0),
    today_reserved: Number(row?.today_reserved ?? 0),
  };
}

function subscriptionEntitled(plan: string, status: string): boolean {
  return (plan === "trial" && status === "trial") || (plan === "monthly" && status === "active");
}

function decisionFor(period: PeriodRow, tally: CountRow, today: string): Decision {
  return checkQuota({
    plan: period.plan_code,
    status: period.status,
    start: String(period.period_start).slice(0, 10),
    today,
    consumed: tally.consumed,
    reserved: tally.reserved,
    todayConsumed: tally.today_consumed,
    todayReserved: tally.today_reserved,
  });
}

export async function readQuotaView(sql: Sql, clientId: string, today = jerusalemToday()): Promise<QuotaView> {
  try {
    const period = (await sql<PeriodRow>`
      select id, plan_code, status, period_start::text as period_start, period_last::text as period_last,
        posts_quota::int as posts_quota, daily_quota::int as daily_quota
      from subscription_periods
      where client_id = ${clientId} and status in ('trial', 'active')
      limit 1
    `)[0] ?? null;
    if (!period) return { ...emptyView("unopened"), available: 0 };
    const tally = await counts(sql, clientId, period.id, today);
    const available = Math.max(0, Number(period.posts_quota) - tally.consumed - tally.reserved);
    return {
      ledger: "period",
      consumed: tally.consumed,
      reserved: tally.reserved,
      available,
      periodStart: String(period.period_start).slice(0, 10),
      periodLast: String(period.period_last).slice(0, 10),
      plan: period.plan_code,
      status: period.status,
    };
  } catch (error) {
    if (quotaSchemaError(error)) return emptyView("unavailable");
    throw error;
  }
}

export type Reservation =
  | { ok: true; jobId: string; duplicate: boolean; dispatch: "send" | "held" }
  | { ok: false; code: QuotaCode };

/**
 * Lock the client subscription and open period, then insert at most one
 * in-flight Instagram photo job bound to that period. The caller dispatches
 * Make only when `dispatch` is `send` and the delivery row is still unclaimed.
 */
export async function reservePhotoSlot(sql: Sql, clientId: string, today: string): Promise<Reservation> {
  try {
    return await sql.transaction(async (tx) => {
      const subscription = (await tx<{ plan_code: string; status: string }>`
        select plan_code, status from client_subscriptions where client_id = ${clientId} limit 1 for update
      `)[0] ?? null;
      if (!subscription) return { ok: false, code: "not_entitled" };

      const open = await tx<{ id: string; subscription_period_id: string | null }>`
        select id, subscription_period_id from publishing_jobs
        where client_id = ${clientId} and platform = 'instagram' and status = 'queued' and awaiting_generation is true
        limit 1
      `;
      if (open[0]) {
        if (!open[0].subscription_period_id) {
          return { ok: true, jobId: open[0].id, duplicate: true, dispatch: "held" };
        }
        const delivery = (await tx<{ dispatch_state: DispatchState | null }>`
          select dispatch_state from webhook_deliveries
          where client_id = ${clientId} and destination = 'make-content' and detail = ${`job:${open[0].id}`}
          limit 1
        `)[0] ?? null;
        if (!delivery || delivery.dispatch_state === "never_attempted") {
          return { ok: true, jobId: open[0].id, duplicate: true, dispatch: "send" };
        }
        return { ok: true, jobId: open[0].id, duplicate: true, dispatch: "held" };
      }

      let period = (await tx<PeriodRow>`
        select id, plan_code, status, period_start::text as period_start, period_last::text as period_last,
          posts_quota::int as posts_quota, daily_quota::int as daily_quota
        from subscription_periods
        where client_id = ${clientId} and status in ('trial', 'active')
        limit 1
        for update
      `)[0] ?? null;

      if (!period) {
        if (!subscriptionEntitled(subscription.plan_code, subscription.status) || subscription.plan_code !== "trial") {
          return { ok: false, code: "not_entitled" };
        }
        const priorTrial = await tx<{ id: string }>`
          select id from subscription_periods where client_id = ${clientId} and plan_code = 'trial' limit 1
        `;
        if (priorTrial[0]) return { ok: false, code: "expired" };
        const connected = await tx<{ status: string }>`
          select status from social_accounts where client_id = ${clientId} and platform = 'instagram' limit 1
        `;
        if (connected[0]?.status !== "connected") return { ok: false, code: "not_connected" };
        if (!isWorkday(today)) return { ok: false, code: "weekend" };
        const window = postingWindow(today, RULES.trial.days);
        if (!window) return { ok: false, code: "invalid" };
        const id = crypto.randomUUID();
        await tx`
          insert into subscription_periods (
            id, client_id, plan_code, status, period_start, period_last, posts_quota, daily_quota
          ) values (
            ${id}, ${clientId}, 'trial', 'trial', ${window.first}, ${window.last}, ${RULES.trial.total}, ${RULES.trial.daily}
          )
        `;
        period = {
          id,
          plan_code: "trial",
          status: "trial",
          period_start: window.first,
          period_last: window.last,
          posts_quota: RULES.trial.total,
          daily_quota: RULES.trial.daily,
        };
      }

      if (!subscriptionEntitled(subscription.plan_code, subscription.status)) return { ok: false, code: "not_entitled" };
      const tally = await counts(tx, clientId, period.id, today);
      if (tally.consumed + tally.reserved >= Number(period.posts_quota)) return { ok: false, code: "quota" };
      if (tally.today_consumed + tally.today_reserved >= Number(period.daily_quota)) return { ok: false, code: "daily" };
      const decision = decisionFor(period, tally, today);
      if (!decision.ok) {
        if (decision.reason === "quota" || decision.reason === "daily" || decision.reason === "weekend" || decision.reason === "expired") {
          return { ok: false, code: decision.reason };
        }
        return { ok: false, code: "not_entitled" };
      }

      const jobId = crypto.randomUUID();
      await tx`
        insert into publishing_jobs (
          id, client_id, platform, status, awaiting_generation, created_at, subscription_period_id
        ) values (
          ${jobId}, ${clientId}, 'instagram', 'queued', true, ${`${today}T12:00:00Z`}, ${period.id}
        )
      `;
      return { ok: true, jobId, duplicate: false, dispatch: "send" };
    });
  } catch (error) {
    if (quotaSchemaError(error)) return { ok: false, code: "schema_unavailable" };
    if (!uniqueViolation(error)) throw error;
    const raced = await sql<{ id: string }>`
      select id from publishing_jobs
      where client_id = ${clientId} and platform = 'instagram' and status = 'queued' and awaiting_generation is true
      limit 1
    `;
    if (!raced[0]) return { ok: false, code: "quota" };
    return { ok: true, jobId: raced[0].id, duplicate: true, dispatch: "held" };
  }
}

/** Store a callback on the job's own period. `posts_used` and the current open period are ignored. */
export async function acceptGeneratedPhoto(
  sql: Sql,
  input: { jobId: string; clientId: string; caption: string; imageUrl: string },
): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: "not_found" | "mismatch" | "not_awaiting" | "not_entitled" | "conflict" | "schema_unavailable" }> {
  try {
    return await sql.transaction(async (tx) => {
      const existing = (await tx<{ client_id: string; caption: string; image_url: string; status: string; subscription_period_id: string | null }>`
        select client_id, caption, image_url, status, subscription_period_id
        from instagram_generation_results where job_id = ${input.jobId} limit 1
      `)[0] ?? null;
      if (existing) {
        if (existing.client_id !== input.clientId) return { ok: false, code: "mismatch" };
        const same = existing.caption === input.caption && existing.image_url === input.imageUrl && existing.status === "generated";
        return same ? { ok: true, duplicate: true } : { ok: false, code: "conflict" };
      }
      const job = (await tx<{ client_id: string; status: string; platform: string | null; approval_status: string; awaiting_generation: boolean | null; subscription_period_id: string | null }>`
        select j.client_id, j.status, j.platform, c.approval_status, j.awaiting_generation, j.subscription_period_id
        from publishing_jobs j
        join clients c on c.id = j.client_id
        where j.id = ${input.jobId}
        limit 1
        for update
      `)[0] ?? null;
      if (!job) return { ok: false, code: "not_found" };
      if (job.client_id !== input.clientId) return { ok: false, code: "mismatch" };
      if (job.approval_status !== "approved") return { ok: false, code: "not_entitled" };
      if ((job.platform !== null && job.platform !== "instagram") || (job.status !== "queued" && job.status !== "failed")) {
        return { ok: false, code: "not_awaiting" };
      }
      if (!job.subscription_period_id) return { ok: false, code: "not_entitled" };
      const period = (await tx<PeriodRow>`
        select id, plan_code, status, period_start::text as period_start, period_last::text as period_last,
          posts_quota::int as posts_quota, daily_quota::int as daily_quota
        from subscription_periods
        where id = ${job.subscription_period_id} and client_id = ${input.clientId}
        limit 1
        for update
      `)[0] ?? null;
      if (!period) return { ok: false, code: "not_entitled" };
      const used = Number((await tx<{ consumed: number }>`
        select count(*)::int as consumed from instagram_generation_results
        where client_id = ${input.clientId} and subscription_period_id = ${period.id} and status = 'generated'
      `)[0]?.consumed ?? 0);
      if (job.awaiting_generation !== true && used >= Number(period.posts_quota)) return { ok: false, code: "not_entitled" };
      const inserted = await tx<{ job_id: string }>`
        insert into instagram_generation_results (
          job_id, client_id, platform, content_type, caption, image_url, status, created_at, subscription_period_id
        )
        select j.id, j.client_id, 'instagram', 'photo', ${input.caption}, ${input.imageUrl}, 'generated', j.created_at, j.subscription_period_id
        from publishing_jobs j
        join clients c on c.id = j.client_id
        where j.id = ${input.jobId} and j.client_id = ${input.clientId} and j.status in ('queued', 'failed')
          and j.subscription_period_id = ${period.id}
          and c.approval_status = 'approved'
          and not exists (select 1 from instagram_generation_results existing where existing.job_id = j.id)
        on conflict (job_id) do nothing
        returning job_id
      `;
      if (!inserted[0]) return { ok: false, code: "conflict" };
      await tx`
        update publishing_jobs set awaiting_generation = false
        where id = ${input.jobId} and client_id = ${input.clientId} and subscription_period_id = ${period.id}
      `;
      await tx`
        update webhook_deliveries
        set dispatch_state = 'confirmed_generated', status = 'sent'
        where client_id = ${input.clientId} and destination = 'make-content' and detail = ${`job:${input.jobId}`}
      `;
      return { ok: true, duplicate: false };
    });
  } catch (error) {
    if (quotaSchemaError(error)) return { ok: false, code: "schema_unavailable" };
    throw error;
  }
}

export async function releaseUnsentReservation(sql: Sql, clientId: string, jobId: string): Promise<void> {
  await sql`
    update publishing_jobs
    set awaiting_generation = false, status = 'failed', error_message = 'dispatch_not_attempted'
    where id = ${jobId} and client_id = ${clientId} and awaiting_generation is true
      and not exists (select 1 from instagram_generation_results r where r.job_id = publishing_jobs.id)
      and not exists (
        select 1 from webhook_deliveries d
        where d.client_id = ${clientId}
          and d.destination = 'make-content'
          and d.detail = ${`job:${jobId}`}
          and d.dispatch_state in ('attempted_unknown', 'confirmed_generated', 'confirmed_not_started')
      )
  `;
}

/**
 * Separate three decisions that must not be collapsed:
 * close the operational retry, release the client's quota, and confirm spend.
 * Unknown Make spend stays reserved. Compensation is not invented here.
 */
export async function reconcileFailedReservation(
  sql: Sql,
  clientId: string,
  jobId: string,
  audit: ReconcileAudit,
): Promise<{ outcome: ReconcileOutcome; spendWarning: boolean }> {
  if (!ACTOR_ID.test(audit.actorId) || audit.reason.trim().length < 8) {
    return { outcome: "invalid", spendWarning: false };
  }
  try {
    return await sql.transaction(async (tx) => {
      const job = (await tx<{ id: string; subscription_period_id: string | null }>`
        select id, subscription_period_id from publishing_jobs
        where id = ${jobId} and client_id = ${clientId}
        limit 1
        for update
      `)[0] ?? null;
      if (!job) return { outcome: "missing", spendWarning: false };
      if (!job.subscription_period_id) return { outcome: "legacy_unclassified", spendWarning: true };
      const result = (await tx<{ job_id: string }>`
        select job_id from instagram_generation_results where job_id = ${jobId} and client_id = ${clientId} limit 1
      `)[0] ?? null;
      if (result) return { outcome: "kept", spendWarning: false };
      const delivery = (await tx<{ dispatch_state: DispatchState | null; status: string }>`
        select dispatch_state, status from webhook_deliveries
        where client_id = ${clientId} and destination = 'make-content' and detail = ${`job:${jobId}`}
        limit 1
      `)[0] ?? null;
      const prior = delivery?.dispatch_state ?? "never_attempted";
      if (prior === "confirmed_generated") return { outcome: "kept", spendWarning: false };
      if (delivery && prior !== "never_attempted") {
        if (!audit.acknowledgeSpendRisk) return { outcome: "spend_unknown", spendWarning: true };
        const recorded = (await tx<{ id: string }>`
          select id from quota_reconciliations
          where client_id = ${clientId} and job_id = ${jobId} and outcome = 'pending_decision'
          limit 1
        `)[0] ?? null;
        if (!recorded) {
          await tx`
            insert into quota_reconciliations (
              id, client_id, job_id, actor_id, reason, prior_state, outcome, spend_warning
            ) values (
              ${crypto.randomUUID()}, ${clientId}, ${jobId}, ${audit.actorId}, ${audit.reason.trim()},
              ${prior ?? "unknown"}, 'pending_decision', true
            )
          `;
        }
        return { outcome: "pending_decision", spendWarning: true };
      }
      const updated = await tx<{ id: string }>`
        update publishing_jobs
        set awaiting_generation = false, status = 'failed', error_message = 'reconciled_no_regeneration'
        where id = ${jobId} and client_id = ${clientId} and status = 'queued' and awaiting_generation is true
          and subscription_period_id = ${job.subscription_period_id}
          and not exists (select 1 from instagram_generation_results r where r.job_id = publishing_jobs.id)
        returning id
      `;
      if (!updated[0]) return { outcome: "missing", spendWarning: false };
      await tx`
        insert into quota_reconciliations (
          id, client_id, job_id, actor_id, reason, prior_state, outcome, spend_warning
        ) values (
          ${crypto.randomUUID()}, ${clientId}, ${jobId}, ${audit.actorId}, ${audit.reason.trim()},
          ${prior}, 'closed', false
        )
      `;
      return { outcome: "closed", spendWarning: false };
    });
  } catch (error) {
    if (quotaSchemaError(error)) return { outcome: "schema_unavailable", spendWarning: false };
    throw error;
  }
}

export type PaidPeriodResult =
  | { ok: true; start: string; last: string; duplicate: boolean; periodId: string }
  | { ok: false; code: "invalid" | "not_found" | "conflict" | "renewal_blocked" | "schema_unavailable" };

/**
 * Open one monthly period from verified server-side evidence.
 * Does not call a payment provider and does not treat a bare reference as payment.
 */
export async function openPaidPeriod(
  sql: Sql,
  clientId: string,
  evidence: PaymentEvidence,
  today = jerusalemToday(),
): Promise<PaidPeriodResult> {
  if (!paymentEvidenceAccepted(evidence)) return { ok: false, code: "invalid" };
  const window = postingWindow(today, RULES.monthly.days);
  if (!window) return { ok: false, code: "invalid" };
  try {
    return await sql.transaction(async (tx) => {
      const client = await tx<{ id: string }>`select id from clients where id = ${clientId} limit 1 for update`;
      if (!client[0]) return { ok: false, code: "not_found" };
      const subscription = await tx<{ id: string }>`select client_id as id from client_subscriptions where client_id = ${clientId} limit 1 for update`;
      if (!subscription[0]) return { ok: false, code: "not_found" };
      const existing = (await tx<{ client_id: string; period_id: string | null; amount_ils: number; currency: string }>`
        select client_id, period_id, amount_ils::int as amount_ils, currency
        from payment_confirmations
        where payment_id = ${evidence.paymentId}
        limit 1
        for update
      `)[0] ?? null;
      if (existing) {
        if (existing.client_id !== clientId || existing.amount_ils !== RULES.monthly.priceIls || existing.currency !== "ILS") {
          return { ok: false, code: "conflict" };
        }
        if (!existing.period_id) return { ok: false, code: "renewal_blocked" };
        const period = (await tx<{ period_start: string; period_last: string }>`
          select period_start::text as period_start, period_last::text as period_last
          from subscription_periods
          where id = ${existing.period_id} and client_id = ${clientId}
          limit 1
        `)[0] ?? null;
        if (!period) return { ok: false, code: "conflict" };
        return {
          ok: true,
          start: String(period.period_start).slice(0, 10),
          last: String(period.period_last).slice(0, 10),
          duplicate: true,
          periodId: existing.period_id,
        };
      }
      const openMonthly = (await tx<{ id: string }>`
        select id from subscription_periods
        where client_id = ${clientId} and plan_code = 'monthly' and status = 'active'
        limit 1
        for update
      `)[0] ?? null;
      if (openMonthly) {
        await tx`
          insert into payment_confirmations (
            id, payment_id, client_id, amount_ils, currency, source, confirmed_by, period_id, note
          ) values (
            ${crypto.randomUUID()}, ${evidence.paymentId}, ${clientId}, ${evidence.amountIls}, ${evidence.currency},
            ${evidence.source}, ${evidence.confirmedBy}, null,
            ${"recorded_without_period"}
          )
        `;
        return { ok: false, code: "renewal_blocked" };
      }
      const periodId = crypto.randomUUID();
      const confirmationId = crypto.randomUUID();
      await tx`
        update subscription_periods
        set status = 'cancelled'
        where client_id = ${clientId} and status = 'trial'
      `;
      await tx`
        update client_subscriptions
        set plan_code = 'monthly', status = 'active', posts_quota = ${RULES.monthly.total}
        where client_id = ${clientId}
      `;
      await tx`
        insert into subscription_periods (
          id, client_id, plan_code, status, period_start, period_last, posts_quota, daily_quota, payment_reference
        ) values (
          ${periodId}, ${clientId}, 'monthly', 'active', ${window.first}, ${window.last},
          ${RULES.monthly.total}, ${RULES.monthly.daily}, ${evidence.paymentId}
        )
      `;
      await tx`
        insert into payment_confirmations (
          id, payment_id, client_id, amount_ils, currency, source, confirmed_by, period_id
        ) values (
          ${confirmationId}, ${evidence.paymentId}, ${clientId}, ${evidence.amountIls}, ${evidence.currency},
          ${evidence.source}, ${evidence.confirmedBy}, ${periodId}
        )
      `;
      return { ok: true, start: window.first, last: window.last, duplicate: false, periodId };
    });
  } catch (error) {
    if (quotaSchemaError(error)) return { ok: false, code: "schema_unavailable" };
    if (uniqueViolation(error)) return { ok: false, code: "conflict" };
    throw error;
  }
}
