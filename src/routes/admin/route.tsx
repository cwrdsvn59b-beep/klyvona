import { useEffect, useState } from "react";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAdminAccess } from "@/lib/admin.functions";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/context";
import { showNotice } from "@/lib/i18n/surface";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { user, isPending } = useCurrentUserState();
  const { t } = useI18n();

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center gap-4 px-6">
        <LanguageSwitcher />
        <p className="text-sm text-muted">{t("admin.checking")}</p>
      </main>
    );
  }

  if (!user) return <RedirectToSignIn />;

  return (
    <StaffGate userId={user.id}>
      <Outlet />
    </StaffGate>
  );
}

function StaffGate({ userId, children }: { userId: string; children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const [access, setAccess] = useState<{ isAdmin: boolean; configured: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminAccess()
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "key:admin.checkFailed");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-auto min-h-16 max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark className="h-9 w-9 rounded-lg" />
            <span className="font-semibold tracking-wide">KLYVONA</span>
          </Link>
          <span className="text-sm text-muted">{t("admin.nav")}</span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <UserButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        {!access && !error ? <p className="text-sm text-muted">{t("admin.loading")}</p> : null}
        {error ? <p className="text-sm text-danger">{showNotice(locale, error)}</p> : null}
        {access && !access.isAdmin ? (
          <section className="mx-auto max-w-lg rounded-3xl bg-surface p-6 shadow-card">
            <h1 className="text-2xl font-semibold tracking-tight">{t("admin.deniedTitle")}</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {access.configured ? t("admin.deniedConfigured") : t("admin.deniedClosed")}
            </p>
          </section>
        ) : null}
        {access?.isAdmin ? children : null}
      </div>
    </div>
  );
}
