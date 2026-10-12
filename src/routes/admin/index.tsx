import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDashboard, getOAuthTrace, type DashboardData } from "@/lib/admin.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { formatWhen } from "@/lib/format";
import { industryLabel, planLabel } from "@/lib/labels";
import {
  TRACE_MEMORY_WARNING,
  createTraceRefreshController,
  emptyTracePanel,
  traceOperationLabel,
  traceResultLabel,
  type TracePanel,
} from "@/lib/oauth/oauth-trace-view";
import { StatusPill } from "@/components/status-pill";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "ניהול · KLYVONA Connect" }] }),
  component: AdminHome,
});

function AdminHome() {
  const { user } = useCurrentUserState();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [tracePanel, setTracePanel] = useState<TracePanel>(emptyTracePanel);
  const [error, setError] = useState("");
  const traceController = useRef(createTraceRefreshController(() => getOAuthTrace(), () => new Date(), setTracePanel));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setError("");
    getDashboard({ data: { query: debounced } })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "לא הצלחנו לטעון את הלקוחות");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, debounced]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void traceController.current.refresh().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">לקוחות</h1>
        <p className="mt-1 text-sm text-muted">הצטרפות, חיבורים, מנוי ופרסום. בלי אסימוני גישה במסך.</p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-muted">טוענים נתונים…</p> : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="לקוחות" value={data.stats.clients} />
            <Stat label="ממתינים לחיבור" value={data.stats.waiting} />
            <Stat label="התראות" value={data.stats.issues} />
            <Stat label="מנויים רשומים" value={data.stats.subscriptions} />
          </section>

          <section>
            <h2 className="text-lg font-semibold">מצב מערכות</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.integrations.map((item) => (
                <article key={item.id} className="rounded-2xl bg-surface p-4 shadow-card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{item.label}</h3>
                      <p className="text-sm text-muted">{item.owner}</p>
                    </div>
                    <StatusPill code={item.connectionStatus} />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {item.id === "make"
                      ? item.credentialsPresent
                        ? "כתובת Make מוגדרת בשרת. נשלחים רק מזהה וסטטוסים, בלי פרטי קשר ובלי אסימונים."
                        : "ממתין להגדרה. חסר MAKE_WEBHOOK_URL בשרת."
                      : item.credentialsPresent
                        ? "מפתחות קיימים בשרת, אבל החיבור נשאר כבוי עד אימות נפרד."
                        : `ממתין להגדרה. חסר בשרת: ${item.missing.join(", ")}`}
                  </p>
                  {item.scopes.length > 0 ? (
                    <details className="mt-3 text-sm text-muted">
                      <summary className="cursor-pointer">ארכיטקטורת החיבור</summary>
                      <p className="mt-2">היקף מתוכנן: {item.scopes.join(", ")}</p>
                      <p className="mt-1" dir="ltr">
                        {item.callbackPath}
                      </p>
                      <p className="mt-1">OAuth לא הופעל. אין החלפת אסימון.</p>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">שגיאות ותפוגת חיבור</h2>
            {data.warnings.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                אין כרגע שגיאות או אסימונים שעומדים לפוג. חיבורים אמיתיים עוד לא נוצרו, ולכן אין מה
                שיפוג.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {data.warnings.map((warning) => (
                  <li key={warning.id}>
                    <Link
                      to="/admin/clients/$clientId"
                      params={{ clientId: warning.clientId }}
                      className="block rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger"
                    >
                      <span className="font-medium">{warning.businessName}</span>
                      <span className="mx-2 text-danger/70">{warning.reference}</span>
                      <span>{warning.message}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">אבחון חיבור Instagram</h2>
              <Button className="min-w-0 max-w-full whitespace-normal" variant="secondary" size="sm" disabled={tracePanel.loading} aria-busy={tracePanel.loading} onClick={() => void traceController.current.refresh()}>
                {tracePanel.loading ? "מרעננים…" : "רענון יומן האבחון"}
              </Button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{TRACE_MEMORY_WARNING}</p>
            <p className="mt-2 text-sm text-muted">היומן מוגבל ל-40 אירועים ולשעתיים. אין כאן אסימונים, מזהים או רשימת הרשאות.</p>
            {tracePanel.refreshedAt ? (
              <p className="mt-2 text-sm text-muted">
                עודכן לאחרונה: <span dir="ltr">{tracePanel.refreshedAt}</span>
              </p>
            ) : null}
            {tracePanel.loadError ? <p className="mt-2 text-sm text-danger">{tracePanel.loadError}</p> : null}
            {tracePanel.rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">עדיין אין אירועים בתהליך הזה.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {tracePanel.rows.map((entry, index) => (
                  <li key={`${entry.at}-${entry.operation}-${index}`} className="rounded-2xl bg-surface px-4 py-3 text-sm shadow-card">
                    <p dir="ltr" className="text-muted">{entry.at}</p>
                    <p className="mt-1 font-medium">{traceOperationLabel(entry.operation)} · {traceResultLabel(entry.result)}</p>
                    <p dir="ltr" className="mt-1 text-muted">{entry.grantStatus} · {entry.grantSource} · permissions {entry.permissionsPresent ? "yes" : "no"}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <label className="relative block">
              <Search className="pointer-events-none absolute end-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="חיפוש לפי עסק, איש קשר, אימייל, טלפון או מספר פנייה"
                className="h-12 w-full rounded-xl border border-line bg-surface pe-12 ps-4 text-base outline-none focus-visible:border-primary"
              />
            </label>
            {data.clients.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                {debounced ? "אין תוצאות לחיפוש הזה." : "עדיין אין לקוחות. פנייה שתושלם בהצטרפות תופיע כאן."}
              </p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {data.clients.map((client) => (
                  <li key={client.id}>
                    <Link
                      to="/admin/clients/$clientId"
                      params={{ clientId: client.id }}
                      className="block rounded-2xl bg-surface p-4 shadow-card"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold">{client.businessName}</h3>
                          <p className="text-sm text-muted">
                            {client.contactName} · {industryLabel(client.industry)}
                          </p>
                        </div>
                        <span className="text-sm font-medium tracking-wide" dir="ltr">
                          {client.reference}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill code={client.subscriptionStatus} />
                        <StatusPill code={client.publishingStatus} />
                        <span className="inline-flex h-7 items-center rounded-full bg-bg px-3 text-sm text-muted">
                          {planLabel(client.planCode)} · {client.postsUsed}/{client.postsQuota}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-muted">{formatWhen(client.createdAt)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </article>
  );
}
