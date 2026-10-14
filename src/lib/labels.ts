import type { Locale } from "@/lib/i18n/locale";
import { catalogLabel } from "@/lib/i18n/translate";

export const INDUSTRIES = [
  { id: "food", label: "מסעדה ואוכל" },
  { id: "beauty", label: "מספרה ויופי" },
  { id: "garage", label: "מוסך ורכב" },
  { id: "electrician", label: "חשמלאי" },
  { id: "carpentry", label: "נגרות ושיפוצים" },
  { id: "contractor", label: "קבלן בנייה" },
  { id: "fitness", label: "כושר ואימון" },
  { id: "retail", label: "חנות" },
  { id: "professional", label: "שירותים מקצועיים" },
  { id: "other", label: "אחר" },
] as const;

export const VOICES = [
  { id: "professional", label: "מקצועי ורגוע" },
  { id: "friendly", label: "חברי וקרוב" },
  { id: "premium", label: "יוקרתי ומאופק" },
  { id: "direct", label: "ישיר וענייני" },
  { id: "warm", label: "חם ואותנטי" },
] as const;

export const VISUALS = [
  { id: "minimal", label: "נקי ומינימלי" },
  { id: "field", label: "צילום אותנטי מהשטח" },
  { id: "luxury", label: "יוקרתי כהה" },
  { id: "vivid", label: "צבעוני ואנרגטי" },
] as const;

export const PLANS = [
  {
    code: "trial" as const,
    name: "ניסיון",
    price: 0,
    posts: 22,
    days: 22,
    detail: "22 פוסטים עם תמונה לאורך 22 ימי עסקים. בלי עלות.",
  },
  {
    code: "monthly" as const,
    name: "חודשי",
    price: 600,
    posts: 44,
    days: 22,
    detail: "44 פוסטים עם תמונה לאורך 22 ימי עסקים. 600 ₪ לחודש, כולל מע״מ.",
  },
];

export const VIDEO_NOTE = "הפקת וידאו אינה כלולה במסלולים ומתומחרת בנפרד.";

export const PLATFORMS = [
  { id: "facebook" as const, label: "Facebook", owner: "Meta" },
  { id: "instagram" as const, label: "Instagram", owner: "Meta" },
  { id: "tiktok" as const, label: "TikTok", owner: "TikTok" },
];

export const INDUSTRY_IDS = INDUSTRIES.map((item) => item.id);
export const VOICE_IDS = VOICES.map((item) => item.id);
export const VISUAL_IDS = VISUALS.map((item) => item.id);
export const PLAN_CODES = PLANS.map((item) => item.code);

const STATUS_LABELS: Record<string, string> = {
  awaiting_setup: "ממתין להגדרה",
  pending: "בטיפול",
  connected: "מחובר",
  expired: "פג תוקף",
  error: "שגיאה",
  trial: "ניסיון",
  awaiting_billing: "ממתין לחיוב",
  active: "פעיל",
  past_due: "חוב",
  cancelled: "בוטל",
  waiting_connection: "ממתין לחיבור",
  scheduled: "מתוזמן",
  publishing: "בפרסום",
  paused: "מושהה",
  completed: "הושלם",
  in_progress: "בתהליך",
  saved: "נשמר",
  skipped: "לא נשלח",
  sent: "נשלח",
  failed: "נכשל",
  configured: "כתובת מוגדרת",
  queued: "בתור",
  published: "פורסם",
  blocked: "חסום",
  updated: "עודכן",
};

export function statusLabel(code: string, locale: Locale = "he"): string {
  return catalogLabel("status", code, locale, STATUS_LABELS[code] ?? code);
}

export function industryLabel(code: string, locale: Locale = "he"): string {
  return catalogLabel("industry", code, locale, INDUSTRIES.find((item) => item.id === code)?.label ?? code);
}

export function voiceLabel(code: string, locale: Locale = "he"): string {
  return catalogLabel("voice", code, locale, VOICES.find((item) => item.id === code)?.label ?? code);
}

export function visualLabel(code: string, locale: Locale = "he"): string {
  return catalogLabel("visual", code, locale, VISUALS.find((item) => item.id === code)?.label ?? code);
}

export function planLabel(code: string, locale: Locale = "he"): string {
  return catalogLabel("plan", `${code}.name`, locale, PLANS.find((item) => item.code === code)?.name ?? code);
}

export function toneFor(code: string): "primary" | "warn" | "danger" | "ok" | "muted" {
  if (["error", "expired", "failed", "rejected", "suspended"].includes(code)) return "danger";
  if (["awaiting_billing", "past_due", "paused", "pending", "pending_approval"].includes(code)) return "warn";
  if (["active", "sent", "completed", "published", "configured", "approved"].includes(code)) return "ok";
  if (["cancelled", "blocked"].includes(code)) return "muted";
  return "primary";
}
