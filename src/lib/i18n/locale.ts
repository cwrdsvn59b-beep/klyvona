/**
 * Interface language only. This is not the language of Instagram posts.
 * The preference lives in a browser cookie so server-rendered HTML matches
 * the visitor, including anonymous onboarding. It is not written to the
 * customer record and is not sent to Make.
 *
 * A later Make scenario could accept an optional `ui_locale` field beside
 * the current payload. Do not add it until that scenario is updated: the
 * existing webhook body stays id, plan, industry and statuses only.
 */
export const LOCALES = ["he", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = "klyvona_ui_locale";
export const LOCALE_STORAGE = "klyvona_ui_locale";
export const DEFAULT_LOCALE: Locale = "he";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "he" || value === "ru" || value === "en";
}

export function parseLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

export function langFor(locale: Locale): Locale {
  return locale;
}

export function intlLocale(locale: Locale): string {
  if (locale === "ru") return "ru-RU";
  if (locale === "en") return "en-GB";
  return "he-IL";
}

export function readCookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function readBrowserLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  return parseLocale(readCookieValue(document.cookie, LOCALE_COOKIE));
}

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try {
    localStorage.setItem(LOCALE_STORAGE, locale);
  } catch {
    /* private mode can reject storage; the cookie still holds the preference */
  }
}
