import { createFileRoute } from "@tanstack/react-router";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "הצטרפות · KLYVONA Connect" }],
  }),
  component: Home,
});

function Home() {
  return <OnboardingWizard />;
}
