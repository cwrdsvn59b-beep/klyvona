import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, dirFor, langFor, parseLocale, readBrowserLocale, writeLocaleCookie, type Locale } from "@/lib/i18n/locale";
import { translate, type TranslateVars } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/he";

type I18nValue = {
  locale: Locale;
  dir: "rtl" | "ltr";
  lang: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: TranslateVars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    const parsed = parseLocale(next);
    setLocaleState(parsed);
    writeLocaleCookie(parsed);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: dirFor(locale),
      lang: langFor(locale),
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value) return value;
  const locale = typeof document === "undefined" ? DEFAULT_LOCALE : readBrowserLocale();
  return {
    locale,
    dir: dirFor(locale),
    lang: langFor(locale),
    setLocale: (next) => {
      writeLocaleCookie(parseLocale(next));
    },
    t: (key, vars) => translate(locale, key, vars),
  };
}
