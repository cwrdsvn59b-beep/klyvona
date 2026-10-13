import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { I18nProvider } from "@/lib/i18n/context";
import { readBrowserLocale } from "@/lib/i18n/locale";
import { useI18n } from "@/lib/i18n/context";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function ErrorBody({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-ink">
      <LanguageSwitcher />
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">{t("error.title")}</h1>
      <p className="max-w-md text-sm break-words text-muted">{errorMessage(error, t("error.fallback"))}</p>
    </main>
  );
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const locale = typeof document === "undefined" ? "he" : readBrowserLocale();
  return (
    <I18nProvider initialLocale={locale}>
      <ErrorBody error={error} />
    </I18nProvider>
  );
}
