import { useEffect, useState } from "react";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAdminAccess } from "@/lib/admin.functions";
import { BrandMark } from "@/components/brand-mark";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <p className="text-sm text-muted">בודקים הרשאה…</p>
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
  const [access, setAccess] = useState<{ isAdmin: boolean; configured: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminAccess()
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "לא הצלחנו לבדוק הרשאה");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark className="h-9 w-9 rounded-lg" />
            <span className="font-semibold tracking-wide">KLYVONA</span>
          </Link>
          <span className="text-sm text-muted">ניהול</span>
          <div className="ms-auto">
            <UserButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        {!access && !error ? <p className="text-sm text-muted">טוענים את אזור הניהול…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {access && !access.isAdmin ? (
          <section className="mx-auto max-w-lg rounded-3xl bg-surface p-6 shadow-card">
            <h1 className="text-2xl font-semibold tracking-tight">אין גישת ניהול</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {access.configured
                ? "החשבון הזה אינו מורשה. הגישה ניתנת רק לחשבון שאושר מראש בשרת, ולא ניתן לפתוח אותה מהמסך."
                : "הניהול סגור. רשימת המנהלים לא הוגדרה בשרת, ולכן אף חשבון לא מקבל גישה."}
            </p>
          </section>
        ) : null}
        {access?.isAdmin ? children : null}
      </div>
    </div>
  );
}
