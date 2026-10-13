import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalLinks } from "@/components/legal-links";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { translate } from "@/lib/i18n/translate";

export const Route = createFileRoute("/login")({
  head: ({ matches }) => ({
    meta: [{ title: translate(localeFromMatches(matches), "meta.loginTitle") }],
  }),
  component: Login,
});

function Login() {
  const { user, isPending } = useCurrentUserState();
  const { t } = useI18n();
  usePageTitle(t("meta.loginTitle"));

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center gap-4 px-6">
        <LanguageSwitcher />
        <p className="text-sm text-muted">{t("login.checking")}</p>
      </main>
    );
  }

  if (user) return <Navigate to="/admin" />;

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <BrandMark className="h-14 w-14 rounded-xl" />
          <LanguageSwitcher />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("login.body")}</p>
        <div className="mt-6 grid gap-3">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/admin" })}
              className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base font-medium hover:bg-primary-soft"
            >
              {t("login.with", { provider: provider.label })}
            </button>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          <Link to="/" className="underline-offset-4 hover:underline">
            {t("common.backToOnboarding")}
          </Link>
        </p>
        <LegalLinks className="mt-3" />
      </div>
    </main>
  );
}
