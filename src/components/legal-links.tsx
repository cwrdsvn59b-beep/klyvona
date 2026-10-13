import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n/context";

export function LegalLinks({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("nav.legal")} className={`flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted ${className}`}>
      <Link to="/privacy" className="underline-offset-4 hover:underline">
        {t("nav.privacy")}
      </Link>
      <Link to="/data-deletion" className="underline-offset-4 hover:underline">
        {t("nav.deletion")}
      </Link>
    </nav>
  );
}
