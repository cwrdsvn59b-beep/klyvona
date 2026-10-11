import { z } from "zod";
import { INDUSTRIES, PLANS, VISUALS, VOICES } from "@/lib/labels";

function idsOf<const T extends readonly { id: string }[]>(
  items: T,
): [T[number]["id"], ...T[number]["id"][]] {
  return items.map((item) => item.id) as [T[number]["id"], ...T[number]["id"][]];
}

const planCodes = PLANS.map((item) => item.code) as [
  (typeof PLANS)[number]["code"],
  ...(typeof PLANS)[number]["code"][],
];

const industryEnum = z.enum(idsOf(INDUSTRIES), { error: "בחרו תחום" });
const voiceEnum = z.enum(idsOf(VOICES), { error: "בחרו טון דיבור" });
const visualEnum = z.enum(idsOf(VISUALS), { error: "בחרו סגנון ויזואלי" });
const planEnum = z.enum(planCodes, { error: "בחרו מסלול" });

function isIsraeliPhone(value: string): boolean {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.startsWith("972") && digits.length >= 11 && digits.length <= 13;
  }
  return digits.startsWith("0") && digits.length >= 9 && digits.length <= 10;
}

export const onboardingSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, { error: "נא למלא את שם העסק" })
    .max(80, { error: "שם העסק ארוך מדי" }),
  contactName: z
    .string()
    .trim()
    .min(2, { error: "נא למלא שם איש קשר" })
    .max(80, { error: "השם ארוך מדי" }),
  email: z
    .string()
    .trim()
    .max(120, { error: "האימייל ארוך מדי" })
    .email({ error: "כתובת האימייל לא תקינה" }),
  phone: z
    .string()
    .trim()
    .refine(isIsraeliPhone, { error: "הזינו מספר ישראלי, למשל 050-0000000" }),
  industry: industryEnum,
  description: z
    .string()
    .trim()
    .min(10, { error: "תארו את העסק בכמה משפטים" })
    .max(600, { error: "התיאור ארוך מדי" }),
  targetAudience: z
    .string()
    .trim()
    .min(2, { error: "מי קהל היעד?" })
    .max(300, { error: "התיאור ארוך מדי" }),
  brandVoice: voiceEnum,
  services: z
    .string()
    .trim()
    .min(2, { error: "אילו שירותים העסק מציע?" })
    .max(400, { error: "הרשימה ארוכה מדי" }),
  visualStyle: visualEnum,
  planCode: planEnum,
  acknowledgedNoPassword: z.literal(true, {
    error: "צריך לאשר שלא מזינים כאן סיסמה",
  }),
});

export type OnboardingData = z.infer<typeof onboardingSchema>;

export const STEP_FIELDS: Record<number, string[]> = {
  0: [],
  1: ["businessName", "contactName", "email", "phone", "industry", "description"],
  2: ["acknowledgedNoPassword"],
  3: ["targetAudience", "brandVoice", "services", "visualStyle", "planCode"],
};

function issueText(issue: { message?: string }): string {
  return issue.message || "שדה לא תקין";
}

export function errorsForStep(input: unknown, step: number): Record<string, string> {
  const keys = new Set(STEP_FIELDS[step] ?? []);
  if (keys.size === 0) return {};
  const result = onboardingSchema.safeParse(input);
  if (result.success) return {};
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (keys.has(key) && !fieldErrors[key]) fieldErrors[key] = issueText(issue);
  }
  return fieldErrors;
}

export function parseOnboarding(
  input: unknown,
):
  | { ok: true; data: OnboardingData }
  | { ok: false; message: string; fieldErrors: Record<string, string> } {
  const result = onboardingSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issueText(issue);
  }
  return { ok: false, message: "יש שדות שצריך לתקן לפני השליחה", fieldErrors };
}

export function stepForField(key: string): number {
  for (const step of [1, 2, 3]) {
    if (STEP_FIELDS[step]?.includes(key)) return step;
  }
  return 1;
}
