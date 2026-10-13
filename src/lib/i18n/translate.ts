import { en } from "@/lib/i18n/en";
import { he, type MessageKey } from "@/lib/i18n/he";
import type { Locale } from "@/lib/i18n/locale";
import { ru } from "@/lib/i18n/ru";

const catalogs: Record<Locale, Record<MessageKey, string>> = { he, ru, en };

export type TranslateVars = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const localized = catalogs[locale]?.[key];
  const template = localized || catalogs.he[key] || catalogs.he["common.missing"];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined ? "" : String(value);
  });
}

export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(he, key);
}

export function catalogLabel(prefix: string, code: string, locale: Locale, fallback = code): string {
  const key = `${prefix}.${code}`;
  if (!hasMessage(key)) return fallback || code;
  return translate(locale, key);
}
