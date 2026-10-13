/**
 * Outbound Make notification. Sends an id and statuses only.
 * Never includes contact details, OAuth tokens, or the interface language.
 * UI language is a browser preference and is not a content language.
 * A future optional `ui_locale` field can be added without removing current
 * fields, but only after the Make scenario is updated to ignore unknown keys
 * safely. Do not add it here yet.
 * The webhook URL stays in
 * the server environment and is not returned to the browser.
 */

export type MakeNotice = {
  event: "onboarding.completed";
  client_id: string;
  reference: string;
  plan_code: string;
  industry: string;
  platforms: Array<"facebook" | "instagram" | "tiktok">;
  social_status: "awaiting_setup";
  onboarding_status: "completed";
  publishing_status: "waiting_connection";
  subscription_status: string;
  video_included: false;
  occurred_at: string;
};

export type MakeResult = {
  status: "skipped" | "sent" | "failed";
  httpStatus: number | null;
  detail: string;
};

function isSafeWebhookUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "169.254.169.254" ||
    host === "::1"
  ) {
    return null;
  }
  if (/^(127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(host)) return null;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
  if (host.includes(":")) return null;
  return url;
}

export function makeWebhookConfigured(): boolean {
  const raw = process.env.MAKE_WEBHOOK_URL;
  return Boolean(raw && isSafeWebhookUrl(raw));
}

export async function notifyMake(notice: MakeNotice): Promise<MakeResult> {
  const raw = process.env.MAKE_WEBHOOK_URL?.trim();
  if (!raw) {
    return {
      status: "skipped",
      httpStatus: null,
      detail: "כתובת Make לא הוגדרה בשרת",
    };
  }
  const url = isSafeWebhookUrl(raw);
  if (!url) {
    console.warn("[make] webhook url rejected");
    return {
      status: "failed",
      httpStatus: null,
      detail: "הכתובת שהוגדרה בשרת אינה https ציבורי",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "content-type": "application/json",
        "user-agent": "KLYVONA-Connect",
      },
      body: JSON.stringify(notice),
    });
    if (!response.ok) {
      console.warn(`[make] webhook status ${response.status}`);
      return {
        status: "failed",
        httpStatus: response.status,
        detail: "Make החזיר שגיאה. הפרטים לא כללו אסימונים.",
      };
    }
    return {
      status: "sent",
      httpStatus: response.status,
      detail: "נשלחו מזהה וסטטוסים בלבד",
    };
  } catch (error) {
    console.warn("[make] webhook request failed", error instanceof Error ? error.name : "error");
    return {
      status: "failed",
      httpStatus: null,
      detail: "לא הצלחנו להגיע ל-Make. אסימונים לא נשלחו.",
    };
  }
}
