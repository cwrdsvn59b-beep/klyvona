import { createFileRoute } from "@tanstack/react-router";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { translate } from "@/lib/i18n/translate";

export const Route = createFileRoute("/")({
  head: ({ matches }) => ({
    meta: [{ title: translate(localeFromMatches(matches), "meta.homeTitle") }],
  }),
  component: Home,
});

function Home() {
  const { t } = useI18n();
  usePageTitle(t("meta.homeTitle"));
  return <OnboardingWizard />;
}
