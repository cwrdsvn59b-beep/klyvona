import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { getClientProfile, updateClientOps, type ClientProfile } from "@/lib/admin.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { formatIls, formatWhen } from "@/lib/format";
import { industryLabel, visualLabel, voiceLabel } from "@/lib/labels";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/clients/$clientId")({
  head: () => ({ meta: [{ title: "כרטיס לקוח · KLYVONA Connect" }] }),
  component: ClientPage,
});

const SUBSCRIPTION_OPTIONS = [
  ["trial", "ניסיון"],
  ["awaiting_billing", "ממתין לחיוב"],
  ["active", "פעיל"],
  ["past_due", "חוב"],
  ["cancelled", "בוטל"],
] as const;

const PUBLISHING_OPTIONS = [
  ["waiting_connection", "ממתין לחיבור"],
  ["scheduled", "מתוזמן"],
  ["publishing", "בפרסום"],
  ["paused", "מושהה"],
  ["error", "שגיאה"],
] as const;

function ClientPage() {
  const { clientId } = Route.useParams();
  const { user } = useCurrentUserState();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [publishingStatus, setPublishingStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");

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
        if (!cancelled) setError(reason instanceof Error ? reason.message : "לא הצלחנו לטעון את הלקוח");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, clientId]);

  async function save() {
    if (!profile) return;
    setSaving(true);
    setSaved("");
    setError("");
    try {
      const result = await updateClientOps({
        data: { clientId: profile.id, subscriptionStatus, publishingStatus },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const fresh = await getClientProfile({ data: profile.id });
      if (fresh) {
        setProfile(fresh);
        setSubscriptionStatus(fresh.subscriptionStatus);
        setPublishingStatus(fresh.publishingStatus);
      }
      setSaved("הסטטוס עודכן");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "העדכון נכשל");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronRight className="size-4" aria-hidden="true" />
        חזרה לרשימה
      </Link>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!profile && !missing && !error ? <p className="text-sm text-muted">טוענים כרטיס לקוח…</p> : null}
      {missing ? <p className="text-sm text-muted">הלקוח לא נמצא.</p> : null}
      {profile ? (
        <>
          <header>
            <p className="text-sm font-medium tracking-wide text-primary" dir="ltr">
              {profile.reference}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{profile.businessName}</h1>
            <p className="mt-2 text-sm text-muted">
              {profile.contactName} · {industryLabel(profile.industry)} · נפתח {formatWhen(profile.createdAt)}
            </p>
          </header>

          <section className="grid gap-3 md:grid-cols-2">
            <article className="rounded-2xl bg-surface p-4 shadow-card">
              <h2 className="font-semibold">יצירת קשר</h2>
              <p className="mt-3 text-sm" dir="ltr">
                {profile.email}
              </p>
              <p className="mt-1 text-sm" dir="ltr">
                {profile.phone}
              </p>
            </article>
            <article className="rounded-2xl bg-surface p-4 shadow-card">
              <h2 className="font-semibold">מנוי</h2>
              <p className="mt-3 text-sm">
                {profile.planName} · {formatIls(profile.priceIlsInclVat)}
                {profile.priceIlsInclVat > 0 ? " לחודש כולל מע״מ" : ""}
              </p>
              <p className="mt-1 text-sm tabular-nums text-muted">
                {profile.postsUsed} מתוך {profile.postsQuota} פוסטים עם תמונה
              </p>
              <div className="mt-3 h-2 rounded-full bg-primary-soft">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.min(100, (profile.postsUsed / profile.postsQuota) * 100)}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-muted">הפקת וידאו אינה כלולה.</p>
            </article>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">העדפות תוכן</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <div>
                <dt className="text-muted">תיאור</dt>
                <dd className="mt-1">{profile.description}</dd>
              </div>
              <div>
                <dt className="text-muted">קהל יעד</dt>
                <dd className="mt-1">{profile.targetAudience}</dd>
              </div>
              <div>
                <dt className="text-muted">שירותים</dt>
                <dd className="mt-1">{profile.services}</dd>
              </div>
              <div>
                <dt className="text-muted">טון וסגנון</dt>
                <dd className="mt-1">
                  {voiceLabel(profile.brandVoice)} · {visualLabel(profile.visualStyle)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">רשתות</h2>
            <p className="mt-2 text-sm text-muted">
              אי אפשר לסמן חיבור כמוצלח מכאן. הסטטוס יישאר «ממתין להגדרה» עד ש-OAuth יאומת בשרת.
            </p>
            <ul className="mt-3 grid gap-2">
              {profile.socials.map((social) => (
                <li key={social.platform} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-3">
                  <span className="font-medium capitalize">{social.platform}</span>
                  <StatusPill code={social.status} />
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">סטטוס תפעולי</h2>
            <p className="mt-2 text-sm text-muted">
              העדכון ידני. המערכת לא מפרסמת לרשתות ולא גובה תשלום כל עוד החיבור והחיוב לא הוגדרו.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                מנוי
                <select
                  className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3"
                  value={subscriptionStatus}
                  onChange={(event) => setSubscriptionStatus(event.target.value)}
                >
                  {SUBSCRIPTION_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                פרסום
                <select
                  className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3"
                  value={publishingStatus}
                  onChange={(event) => setPublishingStatus(event.target.value)}
                >
                  {PUBLISHING_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "שומרים…" : "שמירת סטטוס"}
              </Button>
              {saved ? <p className="text-sm text-ok">{saved}</p> : null}
            </div>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">פרסומים</h2>
            {profile.jobs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">אין משימות פרסום. הן לא נוצרות לפני חיבור מאומת.</p>
            ) : (
              <ul className="mt-3 grid gap-2 text-sm">
                {profile.jobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3">
                    <span>{job.platform ?? "כללי"}</span>
                    <StatusPill code={job.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">מהלך ההצטרפות</h2>
            <ol className="mt-3 grid gap-3">
              {profile.events.map((event) => (
                <li key={event.id} className="border-s-2 border-primary-soft ps-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{event.step}</span>
                    <StatusPill code={event.status} />
                  </div>
                  {event.detail ? <p className="mt-1 text-sm text-muted">{event.detail}</p> : null}
                  <p className="mt-1 text-sm text-muted">{formatWhen(event.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl bg-surface p-4 shadow-card">
            <h2 className="font-semibold">Make</h2>
            {profile.webhooks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">אין רישום שליחה.</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {profile.webhooks.map((hook) => (
                  <li key={hook.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{hook.destination}</span>
                      <StatusPill code={hook.status} />
                    </div>
                    {hook.detail ? <p className="mt-1 text-muted">{hook.detail}</p> : null}
                    <p className="mt-1 text-muted">{formatWhen(hook.createdAt)}</p>
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
