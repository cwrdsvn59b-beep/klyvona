import { intlLocale, type Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

export function formatIls(amount: number, locale: Locale = "he"): string {
  if (amount === 0) return translate(locale, "price.free");
  return `${new Intl.NumberFormat(intlLocale(locale)).format(amount)} ₪`;
}

export function formatWhen(value: string | null | undefined, locale: Locale = "he"): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}
