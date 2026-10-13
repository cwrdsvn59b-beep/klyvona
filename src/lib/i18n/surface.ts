import { he, type MessageKey } from "@/lib/i18n/he";
import type { Locale } from "@/lib/i18n/locale";
import { hasMessage, translate } from "@/lib/i18n/translate";

const byHebrew = new Map<string, MessageKey>();
for (const key of Object.keys(he) as MessageKey[]) {
  if (!byHebrew.has(he[key])) byHebrew.set(he[key], key);
}

const PLATFORM = /^(instagram|facebook|tiktok)$/i;

/** Show a stored Hebrew system sentence in the active interface language. Customer text is left unchanged. */
export function translateKnown(locale: Locale, text: string): string {
  const exact = byHebrew.get(text);
  if (exact) return translate(locale, exact);
  const expired = text.match(/^([^:]+): תוקף החיבור עומד לפוג או פג$/);
  if (expired && PLATFORM.test(expired[1])) {
    return translate(locale, "admin.warn.expired", { platform: expired[1] });
  }
  const prefixed = text.match(/^([^:]+): (.+)$/);
  if (prefixed && PLATFORM.test(prefixed[1])) {
    return translate(locale, "admin.warn.connection", {
      platform: prefixed[1],
      detail: translateKnown(locale, prefixed[2]),
    });
  }
  const subscription = text.match(/^מנוי: (.+)$/);
  if (subscription) return translate(locale, "admin.event.subscription", { status: subscription[1] });
  const publishing = text.match(/^פרסום: (.+)$/);
  if (publishing) return translate(locale, "admin.event.publishing", { status: publishing[1] });
  return text;
}

export function showNotice(locale: Locale, text: string): string {
  if (text.startsWith("key:")) {
    const key = text.slice(4);
    return hasMessage(key) ? translate(locale, key) : translate(locale, "common.missing");
  }
  return translateKnown(locale, text);
}

export function eventStepLabel(locale: Locale, step: string): string {
  const key = `event.step.${step}`;
  return hasMessage(key) ? translate(locale, key) : step;
}
