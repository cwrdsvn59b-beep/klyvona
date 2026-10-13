import { createIsomorphicFn } from "@tanstack/react-start";
import { LOCALE_COOKIE, parseLocale, readBrowserLocale } from "@/lib/i18n/locale";

export const readRequestLocale = createIsomorphicFn()
  .server(async () => {
    const { getCookie } = await import("@tanstack/react-start/server");
    return parseLocale(getCookie(LOCALE_COOKIE));
  })
  .client(() => readBrowserLocale());
