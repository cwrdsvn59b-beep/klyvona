import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDashboard, getOAuthTrace, type DashboardData } from "@/lib/admin.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { formatWhen } from "@/lib/format";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { showNotice, translateKnown } from "@/lib/i18n/surface";
import { translate } from "@/lib/i18n/translate";
import { industryLabel, planLabel } from "@/lib/labels";
import {
  createTraceRefreshController,
  emptyTracePanel,
  traceOperationLabel,
  traceResultLabel,
  type TracePanel,
} from "@/lib/oauth/oauth-trace-view";
import { ApprovalActions } from "@/components/approval-actions";
import { StatusPill } from "@/components/status-pill";
import { TestClientCleanup } from "@/components/test-client-cleanup";

export const Route = createFileRoute("/admin/")({
  head: ({ matches }) => ({ meta: [{ title: translate(localeFromMatches(matches), "meta.adminTitle") }] }),
  component: AdminHome,
});

function AdminHome() {
  const { user } = useCurrentUserState();
  const { locale, t } = useI18n();
  usePageTitle(t("meta.adminTitle"));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [tracePanel, setTracePanel] = useState<TracePanel>(emptyTracePanel);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
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
        if (!cancelled) setError(reason instanceof Error ? reason.message : "key:admin.loadFailed");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, debounced, refreshKey]);

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.clientsTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("admin.clientsBody")}</p>
      </div>

      {error ? <p className="text-sm text-danger">{showNotice(locale, error)}</p> : null}
      {!data && !error ? <p className="text-sm text-muted">{t("admin.loadingData")}</p> : null}

      {data ? (
        <>
          <section>
            <h2 className="text-lg font-semibold">{t("admin.pendingTitle")}</h2>
            {data.clients.filter((client) => client.approvalStatus === "pending_approval").length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t("admin.pendingEmpty")}</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {data.clients
                  .filter((client) => client.approvalStatus === "pending_approval")
                  .map((client) => (
                    <li key={client.id} className="rounded-2xl bg-surface p-4 shadow-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-muted" dir="ltr">
                            {client.reference}
                          </p>
                          <p className="text-xs text-muted" dir="ltr">
                            {client.id}
                          </p>
                          <h3 className="text-lg font-semibold">{client.businessName}</h3>
                          <p className="text-sm text-muted">
                            {client.contactName} · {industryLabel(client.industry, locale)}
                          </p>
                          <p className="text-sm" dir="ltr">
                            {client.email}
                          </p>
                          <p className="text-sm" dir="ltr">
                            {client.phone}
                          </p>
                        </div>
                        <StatusPill code={client.approvalStatus} />
                      </div>
                      <p className="mt-3 text-sm text-muted">
                        {planLabel(client.planCode, locale)} · {t("admin.registered")} {formatWhen(client.createdAt, locale)}
                      </p>
                      <ul className="mt-2 grid gap-1 text-sm">
                        {client.socials.map((social) => (
                          <li key={social.platform} className="flex flex-wrap items-center gap-2">
                            <span className="capitalize">{social.platform}</span>
                            <StatusPill code={social.status} />
                            <span className="text-muted">
                              {t("admin.metaPermission")}: {t(`admin.meta.${social.permission}`)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <ApprovalActions clientId={client.id} status={client.approvalStatus} onChanged={() => setRefreshKey((value) => value + 1)} />
                    </li>
                  ))}
              </ul>
            )}
          </section>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("admin.stat.clients")} value={data.stats.clients} />
            <Stat label={t("admin.stat.waiting")} value={data.stats.waiting} />
            <Stat label={t("admin.stat.issues")} value={data.stats.issues} />
            <Stat label={t("admin.stat.subscriptions")} value={data.stats.subscriptions} />
          </section>

          <section>
            <h2 className="text-lg font-semibold">{t("admin.systems")}</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.integrations.map((item) => (
                <article key={item.id} className="rounded-2xl bg-surface p-4 shadow-card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{item.label}</h3>
                      <p className="text-sm text-muted">{translateKnown(locale, item.owner)}</p>
                    </div>
                    <StatusPill code={item.connectionStatus} />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {item.id === "make"
                      ? item.credentialsPresent
                        ? t("admin.makeReady")
                        : t("admin.makeMissing")
                      : item.credentialsPresent
                        ? t("admin.keysPresent")
                        : t("admin.keysMissing", { missing: item.missing.join(", ") })}
                  </p>
                  {item.scopes.length > 0 ? (
                    <details className="mt-3 text-sm text-muted">
                      <summary className="cursor-pointer">{t("admin.architecture")}</summary>
                      <p className="mt-2">{t("admin.plannedScopes", { scopes: item.scopes.join(", ") })}</p>
                      <p className="mt-1" dir="ltr">
                        {item.callbackPath}
                      </p>
                      <p className="mt-1">{t("admin.oauthOff")}</p>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">{t("admin.warningsTitle")}</h2>
            {data.warnings.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">{t("admin.warningsEmpty")}</p>
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
                      <span className="mx-2 text-danger/70" dir="ltr">
                        {warning.reference}
                      </span>
                      <span>{translateKnown(locale, warning.message)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{t("admin.traceTitle")}</h2>
              <Button className="min-w-0 max-w-full whitespace-normal" variant="secondary" size="sm" disabled={tracePanel.loading} aria-busy={tracePanel.loading} onClick={() => void traceController.current.refresh()}>
                {tracePanel.loading ? t("admin.traceRefreshing") : t("admin.traceRefresh")}
              </Button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{t("admin.traceMemory")}</p>
            <p className="mt-2 text-sm text-muted">{t("admin.traceLimit")}</p>
            {tracePanel.refreshedAt ? (
              <p className="mt-2 text-sm text-muted">
                {t("admin.traceUpdated")} <span dir="ltr">{tracePanel.refreshedAt}</span>
              </p>
            ) : null}
            {tracePanel.loadError ? <p className="mt-2 text-sm text-danger">{showNotice(locale, tracePanel.loadError)}</p> : null}
            {tracePanel.rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t("admin.traceEmpty")}</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {tracePanel.rows.map((entry, index) => (
                  <li key={`${entry.at}-${entry.operation}-${index}`} className="rounded-2xl bg-surface px-4 py-3 text-sm shadow-card">
                    <p dir="ltr" className="text-muted">{entry.at}</p>
                    <p className="mt-1 font-medium">{traceOperationLabel(entry.operation, locale)} · {traceResultLabel(entry.result, locale)}</p>
                    <p dir="ltr" className="mt-1 text-muted">
                      {entry.grantStatus} · {entry.grantSource} · {t("admin.permissionsField")}{" "}
                      {entry.permissionsPresent ? t("common.yes") : t("common.no")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TestClientCleanup clients={data.clients} />

          <section>
            <label className="relative block">
              <Search className="pointer-events-none absolute end-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("admin.searchPlaceholder")}
                className="h-12 w-full rounded-xl border border-line bg-surface pe-12 ps-4 text-base outline-none focus-visible:border-primary"
              />
            </label>
            {data.clients.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{debounced ? t("admin.noResults") : t("admin.noClients")}</p>
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
                            {client.contactName} · {industryLabel(client.industry, locale)}
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
                          {planLabel(client.planCode, locale)} · {client.postsUsed}/{client.postsQuota}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-muted">{formatWhen(client.createdAt, locale)}</p>
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
