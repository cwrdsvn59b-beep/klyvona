import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getClientProfile, updateClientOps, type ClientProfile } from "@/lib/admin.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { formatIls, formatWhen } from "@/lib/format";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { eventStepLabel, showNotice, translateKnown } from "@/lib/i18n/surface";
import { translate } from "@/lib/i18n/translate";
import { industryLabel, planLabel, statusLabel, visualLabel, voiceLabel } from "@/lib/labels";
import { ApprovalActions } from "@/components/approval-actions";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/clients/$clientId")({
  head: ({ matches }) => ({ meta: [{ title: translate(localeFromMatches(matches), "meta.clientTitle") }] }),
  component: ClientPage,
});

const SUBSCRIPTION_OPTIONS = ["trial", "awaiting_billing", "active", "past_due", "cancelled"] as const;
const PUBLISHING_OPTIONS = ["waiting_connection", "scheduled", "publishing", "paused", "error"] as const;

function ClientPage() {
  const { clientId } = Route.useParams();
  const { user } = useCurrentUserState();
  const { dir, locale, t } = useI18n();
  usePageTitle(t("meta.clientTitle"));
  const BackIcon = dir === "rtl" ? ChevronRight : ChevronLeft;
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [publishingStatus, setPublishingStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setMissing(false);
    setError("");
    getClientProfile({ data: clientId })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setMissing(true);
          setProfile(null);
          return;
        }
        setProfile(result);
        setSubscriptionStatus(result.subscriptionStatus);
        setPublishingStatus(result.publishingStatus);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "key:admin.loadClientFailed");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, clientId, refreshKey]);

  async function save() {
    if (!profile) return;
    setSaving(true);
    setSaved("");
    setError("");
    try {
      const result = await updateClientOps({
        data: { clientId: profile.id, subscriptionStatus, publishingStatus },
      });
      const fresh = await getClientProfile({ data: profile.id });
      if (fresh) {
        setProfile(fresh);
        setSubscriptionStatus(fresh.subscriptionStatus);
        setPublishingStatus(fresh.publishingStatus);
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved("key:admin.saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "key:admin.saveFailed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Link to="/admin" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <BackIcon className="size-4" aria-hidden="true" />
        {t("admin.backToList")}
      </Link>
      {error ? <p className="text-sm text-danger">{showNotice(locale, error)}</p> : null}
      {!profile && !missing && !error ? <p className="text-sm text-muted">{t("admin.loadingClient")}</p> : null}
      {missing ? <p className="text-sm text-muted">{t("admin.missingClient")}</p> : null}
      {profile ? (
        <>
          <header>
            <p className="text-sm font-medium tracking-wide text-primary" dir="ltr">
              {profile.reference}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{profile.businessName}</h1>
            <div className="mt-3">
              <StatusPill code={profile.approvalStatus} />
            </div>
            <ApprovalActions clientId={profile.id} status={profile.approvalStatus} onChanged={() => setRefreshKey((value) => value + 1)} />
            <p className="mt-2 text-sm text-muted">
              {profile.contactName} · {industryLabel(profile.industry, locale)} · {t("admin.opened", { when: formatWhen(profile.createdAt, locale) })}
            </p>
          </header>

          <section className="grid gap-3 md:grid-cols-2">
            <article className="rounded-2xl bg-surface p-4 shadow-card">
              <h2 className="font-semibold">{t("admin.contact")}</h2>
              <p className="mt-3 text-sm" dir="ltr">
                {profile.email}
              </p>
              <p className="mt-1 text-sm" dir="ltr">
                {profile.phone}
              </p>
            </article>
            <article className="rounded-2xl bg-surface p-4 shadow-card">
              <h2 className="font-semibold">{t("admin.subscription")}</h2>
              <p className="mt-3 text-sm">
                {planLabel(profile.planCode, locale)}
                {" · "}
                <span dir="ltr">{formatIls(profile.priceIlsInclVat, locale)}</span>
                {profile.priceIlsInclVat > 0 ? ` ${t("admin.perMonthVat")}` : ""}
              </p>
              <p className="mt-1 text-sm tabular-nums text-muted">
                {t("admin.postsOf", { used: profile.postsUsed, quota: profile.postsQuota })}
              </p>
              <div className="mt-3 h-2 rounded-full bg-primary-soft">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.min(100, (profile.postsUsed / profile.postsQuota) * 100)}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-muted">{t("admin.videoExcluded")}</p>
            </article>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">{t("admin.preferences")}</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <div>
                <dt className="text-muted">{t("admin.description")}</dt>
                <dd className="mt-1">{profile.description}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("admin.audience")}</dt>
                <dd className="mt-1">{profile.targetAudience}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("admin.services")}</dt>
                <dd className="mt-1">{profile.services}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("admin.toneStyle")}</dt>
                <dd className="mt-1">
                  {voiceLabel(profile.brandVoice, locale)} · {visualLabel(profile.visualStyle, locale)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">{t("admin.networks")}</h2>
            <p className="mt-2 text-sm text-muted">{t("admin.networksNote")}</p>
            <ul className="mt-3 grid gap-2">
              {profile.socials.map((social) => (
                <li key={social.platform} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-3">
                  <span className="font-medium capitalize" dir="ltr">
                    {social.platform}
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2 text-sm">
                    <span className="text-muted">
                      {t("admin.metaPermission")}: {t(`admin.meta.${social.permission}`)}
                    </span>
                    <StatusPill code={social.status} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">{t("admin.ops")}</h2>
            <p className="mt-2 text-sm text-muted">{t("admin.opsNote")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                {t("admin.subscriptionField")}
                <select
                  className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3"
                  value={subscriptionStatus}
                  onChange={(event) => setSubscriptionStatus(event.target.value)}
                >
                  {SUBSCRIPTION_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {t("admin.publishingField")}
                <select
                  className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3"
                  value={publishingStatus}
                  onChange={(event) => setPublishingStatus(event.target.value)}
                >
                  {PUBLISHING_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value, locale)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? t("common.saving") : t("admin.saveStatus")}
              </Button>
              {saved ? <p className="text-sm text-ok">{showNotice(locale, saved)}</p> : null}
            </div>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">{t("admin.jobs")}</h2>
            {profile.jobs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t("admin.noJobs")}</p>
            ) : (
              <ul className="mt-3 grid gap-2 text-sm">
                {profile.jobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3">
                    <span dir="ltr">{job.platform ?? t("admin.general")}</span>
                    <StatusPill code={job.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">{t("admin.timeline")}</h2>
            <ol className="mt-3 grid gap-3">
              {profile.events.map((event) => (
                <li key={event.id} className="border-s-2 border-primary-soft ps-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{eventStepLabel(locale, event.step)}</span>
                    <StatusPill code={event.status} />
                  </div>
                  {event.detail ? <p className="mt-1 text-sm text-muted">{translateKnown(locale, event.detail)}</p> : null}
                  <p className="mt-1 text-sm text-muted">{formatWhen(event.createdAt, locale)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">Make</h2>
            {profile.webhooks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t("admin.noWebhook")}</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {profile.webhooks.map((hook) => (
                  <li key={hook.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" dir="ltr">
                        {hook.destination}
                      </span>
                      <StatusPill code={hook.status} />
                    </div>
                    {hook.detail ? <p className="mt-1 text-muted">{translateKnown(locale, hook.detail)}</p> : null}
                    <p className="mt-1 text-muted">{formatWhen(hook.createdAt, locale)}</p>
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
