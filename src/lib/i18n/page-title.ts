import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { Locale } from "@/lib/i18n/locale";

export function localeFromMatches(matches: ReadonlyArray<{ context: unknown }>): Locale {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const context = matches[index]?.context as { locale?: Locale } | undefined;
    if (context?.locale === "he" || context?.locale === "ru" || context?.locale === "en") return context.locale;
  }
  return "he";
}

export function usePageTitle(title: string) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    if (typeof document !== "undefined") document.title = title;
  }, [title, pathname]);
}
