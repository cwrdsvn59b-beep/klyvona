import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BrandMark } from "@/components/brand-mark";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "כניסת צוות · KLYVONA Connect" }],
  }),
  component: Login,
});

function Login() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <p className="text-sm text-muted">בודקים את החיבור…</p>
      </main>
    );
  }

  if (user) return <Navigate to="/admin" />;

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <BrandMark className="h-14 w-14 rounded-xl" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">כניסת צוות</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          הניהול פתוח רק לחשבון מורשה של KLYVONA. לקוחות ממלאים את טופס ההצטרפות בלי להתחבר.
        </p>
        <div className="mt-6 grid gap-3">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/admin" })}
              className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base font-medium hover:bg-primary-soft"
            >
              כניסה עם {provider.label}
            </button>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          <Link to="/" className="underline-offset-4 hover:underline">
            חזרה להצטרפות
          </Link>
        </p>
      </div>
    </main>
  );
}
