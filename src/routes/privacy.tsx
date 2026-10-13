import { Link, createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalLinks } from "@/components/legal-links";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { translate } from "@/lib/i18n/translate";
import { LEGAL_UPDATED } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: ({ matches }) => {
    const locale = localeFromMatches(matches);
    return {
      meta: [
        { title: translate(locale, "meta.privacyTitle") },
        { name: "description", content: translate(locale, "meta.privacyDescription") },
      ],
    };
  },
  component: PrivacyPage,
});

function PrivacyPage() {
  const { locale, t } = useI18n();
  usePageTitle(t("meta.privacyTitle"));
  const updated = locale === "he" ? LEGAL_UPDATED : t("legal.updatedDate");

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="h-12 w-12 rounded-xl" />
          <div>
            <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
            <p className="text-sm text-muted">{t("privacy.kicker")}</p>
          </div>
        </div>
        <LanguageSwitcher />
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t("meta.privacyTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("legal.updated", { date: updated })}</p>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.operator.title")}</h2>
        <p>{t("privacy.operator.body")}</p>
        <p>{t("privacy.operator.contact")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.service.title")}</h2>
        <p>{t("privacy.service.body")}</p>
        <p>{t("privacy.service.limits")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.collect.title")}</h2>
        <p>{t("privacy.collect.intro")}</p>
        <ul className="list-disc ps-5">
          <li>{t("privacy.collect.item1")}</li>
          <li>{t("privacy.collect.item2")}</li>
          <li>{t("privacy.collect.item3")}</li>
        </ul>
        <p>{t("privacy.collect.extra")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.meta.title")}</h2>
        <p>{t("privacy.meta.body")}</p>
        <p>{t("privacy.meta.state")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.why.title")}</h2>
        <ul className="list-disc ps-5">
          <li>{t("privacy.why.item1")}</li>
          <li>{t("privacy.why.item2")}</li>
          <li>{t("privacy.why.item3")}</li>
          <li>{t("privacy.why.item4")}</li>
          <li>{t("privacy.why.item5")}</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.token.title")}</h2>
        <p>{t("privacy.token.body")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.parties.title")}</h2>
        <ul className="list-disc ps-5">
          <li>{t("privacy.parties.meta")}</li>
          <li>{t("privacy.parties.neon")}</li>
          <li>{t("privacy.parties.make")}</li>
        </ul>
        <p>{t("privacy.parties.staff")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.retention.title")}</h2>
        <p>{t("privacy.retention.body")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.rights.title")}</h2>
        <p>{t("privacy.rights.body")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.disconnect.title")}</h2>
        <p>
          {t("privacy.disconnect.before")}{" "}
          <Link to="/connect" className="underline-offset-4 hover:underline">
            {t("privacy.disconnect.link")}
          </Link>
          {t("privacy.disconnect.after")}
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.delete.title")}</h2>
        <p>
          {t("privacy.delete.before")}{" "}
          <Link to="/data-deletion" className="underline-offset-4 hover:underline">
            {t("privacy.delete.link")}
          </Link>
          .
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.security.title")}</h2>
        <p>{t("privacy.security.body")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.changes.title")}</h2>
        <p>{t("privacy.changes.body")}</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">{t("privacy.contact.title")}</h2>
        <p>{t("privacy.contact.body")}</p>
      </section>

      <LegalLinks className="mt-10" />
    </main>
  );
}
