import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { parseOnboarding, type OnboardingData } from "@/lib/onboarding-schema";
import { CUSTOMER_CONNECT_PLATFORMS } from "@/lib/oauth/customer-flow";
import { newConnectSecret } from "@/lib/oauth/meta.server";

export type SubmitResult =
  | {
      ok: true;
      reference: string;
      webhook: "skipped" | "sent" | "failed";
      webhookDetail: string;
      connectSecret: string;
      plan: {
        code: string;
        nameHe: string;
        priceIlsInclVat: number;
        photoPosts: number;
        businessDays: number;
        includesVideo: boolean;
        subscriptionStatus: string;
      };
    }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function referenceCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = "KV-";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as { code?: string }).code === "23505";
  }
  return error instanceof Error && /unique|duplicate/i.test(error.message);
}

type InsertedPlan = {
  plan_code: string;
  subscription_status: string;
  posts_quota: number;
  name_he: string;
  price_ils_incl_vat: number;
  photo_posts: number;
  business_days: number;
  includes_video: boolean;
};

async function insertClient(data: OnboardingData, reference: string): Promise<InsertedPlan> {
  const sql = await getSql();
  const rows = await sql.query<InsertedPlan>(
    `
    with new_client as (
      insert into clients (
        id, reference_code, contact_name, email, phone, onboarding_status, publishing_status
      )
      values ($1, $2, $3, $4, $5, 'completed', 'waiting_connection')
      returning id
    ),
    new_profile as (
      insert into business_profiles (
        id, client_id, business_name, industry, description,
        target_audience, brand_voice, services, visual_style
      )
      select $6, id, $7, $8, $9, $10, $11, $12, $13
      from new_client
      returning client_id
    ),
    new_sub as (
      insert into client_subscriptions (id, client_id, plan_code, status, posts_quota)
      select $14, c.id, p.code,
        case when p.code = 'trial' then 'trial' else 'awaiting_billing' end,
        p.photo_posts
      from new_client c
      join subscription_plans p on p.code = $15
      returning client_id, plan_code, status, posts_quota
    ),
    new_social as (
      insert into social_accounts (id, client_id, platform, status)
      select $16, c.id, $17, 'awaiting_setup'
      from new_client c
      returning client_id
    ),
    new_events as (
      insert into onboarding_events (id, client_id, step, status, detail)
      select v.id, c.id, v.step, v.status, v.detail
      from new_client c
      cross join (
        values
          ($18::text, 'details', 'saved', 'פרטי העסק נשמרו'),
          ($19::text, 'social', 'awaiting_setup', 'הלקוח אישר שלא מוסרים סיסמה. Instagram ממתין לחיבור'),
          ($20::text, 'preferences', 'saved', 'העדפות התוכן והמסלול נשמרו'),
          ($21::text, 'completed', 'completed', 'ההצטרפות הושלמה')
      ) as v(id, step, status, detail)
      returning client_id
    )
    select
      s.plan_code,
      s.status as subscription_status,
      s.posts_quota,
      p.name_he,
      p.price_ils_incl_vat::int as price_ils_incl_vat,
      p.photo_posts::int as photo_posts,
      p.business_days::int as business_days,
      p.includes_video
    from new_client c
    join new_sub s on s.client_id = c.id
    join subscription_plans p on p.code = s.plan_code
    where exists (select 1 from new_profile)
      and exists (select 1 from new_social)
      and exists (select 1 from new_events)
    `,
    [
      crypto.randomUUID(),
      reference,
      data.contactName,
      data.email,
      data.phone,
      crypto.randomUUID(),
      data.businessName,
      data.industry,
      data.description,
      data.targetAudience,
      data.brandVoice,
      data.services,
      data.visualStyle,
      crypto.randomUUID(),
      data.planCode,
      crypto.randomUUID(),
      CUSTOMER_CONNECT_PLATFORMS[0],
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("plan-missing");
  return row;
}

export const submitOnboarding = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<SubmitResult> => {
    const parsed = parseOnboarding(data);
    if (!parsed.ok) return parsed;

    let reference = referenceCode();
    let inserted: InsertedPlan | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        inserted = await insertClient(parsed.data, reference);
        break;
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 2) {
          reference = referenceCode();
          continue;
        }
        if (error instanceof Error && error.message === "plan-missing") {
          return { ok: false, message: "המסלול לא זמין כרגע. נסו שוב.", fieldErrors: {} };
        }
        console.error("[onboarding] insert failed", error instanceof Error ? error.message : "error");
        return {
          ok: false,
          message: "לא הצלחנו לשמור את הפנייה. נסו שוב בעוד רגע.",
          fieldErrors: {},
        };
      }
    }
    if (!inserted) {
      return { ok: false, message: "לא הצלחנו לשמור את הפנייה. נסו שוב.", fieldErrors: {} };
    }

    const clientRows = await (await getSql())<{ id: string }>`
      select id from clients where reference_code = ${reference} limit 1
    `;
    const clientId = clientRows[0]?.id;
    if (!clientId) {
      return { ok: false, message: "הפנייה נשמרה חלקית. פנו לצוות עם הפרטים שמלאתם.", fieldErrors: {} };
    }
    const connectSecret = newConnectSecret();
    await (await getSql())`
      update clients set connect_secret_hash = ${connectSecret.hash} where id = ${clientId}
    `;

    const { notifyMake } = await import("@/lib/integrations/make.server");
    const webhook = await notifyMake({
      event: "onboarding.completed",
      client_id: clientId,
      reference,
      plan_code: inserted.plan_code,
      industry: parsed.data.industry,
      platforms: [...CUSTOMER_CONNECT_PLATFORMS],
      social_status: "awaiting_setup",
      onboarding_status: "completed",
      publishing_status: "waiting_connection",
      subscription_status: inserted.subscription_status,
      video_included: false,
      occurred_at: new Date().toISOString(),
    });

    try {
      const sql = await getSql();
      await sql`
        insert into webhook_deliveries (id, client_id, destination, status, http_status, detail)
        values (
          ${crypto.randomUUID()},
          ${clientId},
          'make',
          ${webhook.status},
          ${webhook.httpStatus},
          ${webhook.detail}
        )
      `;
      await sql`
        insert into onboarding_events (id, client_id, step, status, detail)
        values (
          ${crypto.randomUUID()},
          ${clientId},
          'make',
          ${webhook.status},
          ${webhook.detail}
        )
      `;
    } catch (error) {
      console.error("[onboarding] webhook log failed", error instanceof Error ? error.message : "error");
    }

    return {
      ok: true,
      reference,
      webhook: webhook.status,
      webhookDetail: webhook.detail,
      connectSecret: connectSecret.raw,
      plan: {
        code: inserted.plan_code,
        nameHe: inserted.name_he,
        priceIlsInclVat: Number(inserted.price_ils_incl_vat),
        photoPosts: Number(inserted.photo_posts),
        businessDays: Number(inserted.business_days),
        includesVideo: Boolean(inserted.includes_video),
        subscriptionStatus: inserted.subscription_status,
      },
    };
  });
