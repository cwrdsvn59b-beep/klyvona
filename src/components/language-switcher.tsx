import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/he";

const NATIVE: Record<Locale, MessageKey> = {
  he: "language.native.he",
  ru: "language.native.ru",
  en: "language.native.en",
};

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("language.group")} className={`flex flex-wrap gap-1 ${className}`}>
      {LOCALES.map((code) => {
        const selected = locale === code;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={selected}
            onClick={() => setLocale(code)}
            className={
              selected
                ? "min-h-11 rounded-full bg-primary px-3 text-sm font-medium text-primary-ink"
                : "min-h-11 rounded-full bg-surface px-3 text-sm font-medium text-ink shadow-card"
            }
          >
            {t(NATIVE[code])}
          </button>
        );
      })}
    </div>
  );
}
