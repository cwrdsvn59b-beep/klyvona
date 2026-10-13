import { Link, createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalLinks } from "@/components/legal-links";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { translate } from "@/lib/i18n/translate";
import { LEGAL_UPDATED } from "@/lib/legal";

export const Route = createFileRoute("/data-deletion")({
  head: ({ matches }) => {
    const locale = localeFromMatches(matches);
    return {
      meta: [
        { title: translate(locale, "meta.deletionTitle") },
        { name: "description", content: translate(locale, "meta.deletionDescription") },
      ],
    };
  },
  component: DataDeletionPage,
});

function DataDeletionPage() {
  const { locale, t } = useI18n();
  usePageTitle(t("meta.deletionTitle"));
  const updated = locale === "he" ? LEGAL_UPDATED : t("legal.updatedDate");

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="h-12 w-12 rounded-xl" />
          <div>
            <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
            <p className="text-sm text-muted">{t("deletion.kicker")}</p>
          </div>
        </div>
        <LanguageSwitcher />
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t("deletion.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("legal.updated", { date: updated })}</p>
      <div className="mt-8 space-y-3 text-sm leading-relaxed">
        <p>{t("deletion.lead")}</p>
        <h2 className="pt-2 text-lg font-semibold">{t("deletion.disconnect.title")}</h2>
        <p>
          {t("deletion.disconnect.before")}{" "}
          <Link to="/connect" className="underline-offset-4 hover:underline">
            {t("deletion.disconnect.link")}
          </Link>
          {t("deletion.disconnect.after")}
        </p>
        <h2 className="pt-2 text-lg font-semibold">{t("deletion.request.title")}</h2>
        <p>
          {t("deletion.request.body")}{" "}
          <Link to="/privacy" className="underline-offset-4 hover:underline">
            {t("nav.privacy")}
          </Link>
        </p>
        <p>{t("deletion.request.after")}</p>
        <p>{t("deletion.settings")}</p>
      </div>
      <LegalLinks className="mt-10" />
    </main>
  );
}
