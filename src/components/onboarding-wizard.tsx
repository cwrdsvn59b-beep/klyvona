import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Instagram } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalLinks } from "@/components/legal-links";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/cn";
import { formatIls } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/he";
import { useI18n } from "@/lib/i18n/context";
import { catalogLabel } from "@/lib/i18n/translate";
import { showNotice, translateKnown } from "@/lib/i18n/surface";
import { INDUSTRIES, PLANS, PLATFORMS, VISUALS, VOICES, planLabel, statusLabel } from "@/lib/labels";
import { errorsForStep, stepForField, type OnboardingData } from "@/lib/onboarding-schema";
import { getOwnApproval } from "@/lib/approval.functions";
import { isApprovalStatus } from "@/lib/approval";
import { submitOnboarding, type SubmitResult } from "@/lib/onboarding.functions";

const STEP_KEYS = [
  "home.stepWelcome",
  "home.stepBusiness",
  "home.stepSocial",
  "home.stepPreferences",
  "home.stepConfirm",
] as const satisfies readonly MessageKey[];
const DRAFT_KEY = "klyvona-onboarding-draft";
const RECEIPT_KEY = "klyvona-onboarding-receipt";

type Draft = {
  [Key in keyof OnboardingData]: OnboardingData[Key] extends boolean ? boolean : string;
};

type Receipt = Extract<SubmitResult, { ok: true }> & { businessName: string };

function emptyDraft(): Draft {
  return {
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    industry: "",
    description: "",
    targetAudience: "",
    brandVoice: "",
    services: "",
    visualStyle: "",
    planCode: "",
    acknowledgedNoPassword: false,
  };
}

const inputClass =
  "h-12 w-full rounded-xl border border-line bg-surface px-4 text-base text-ink outline-none focus-visible:border-primary";

export function OnboardingWizard() {
  const { locale, dir, t } = useI18n();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Draft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const BackIcon = dir === "rtl" ? ChevronRight : ChevronLeft;
  const NextIcon = dir === "rtl" ? ChevronLeft : ChevronRight;

  useEffect(() => {
    try {
      const rawReceipt = sessionStorage.getItem(RECEIPT_KEY);
      if (rawReceipt) {
        setReceipt(JSON.parse(rawReceipt) as Receipt);
        setStep(4);
      } else {
        const rawDraft = sessionStorage.getItem(DRAFT_KEY);
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft) as Partial<Draft>;
          setForm({
            ...emptyDraft(),
            ...parsed,
            acknowledgedNoPassword: Boolean(parsed.acknowledgedNoPassword),
          });
        }
      }
    } catch {
      /* ignore unreadable session data */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || receipt) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  }, [form, hydrated, receipt]);

  useEffect(() => {
    if (!hydrated) return;
    window.scrollTo({ top: 0 });
  }, [step, hydrated]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function goNext() {
    const errors = errorsForStep(form, step);
    setFieldErrors(errors);
    setFormError(Object.keys(errors).length ? "key:validation.incomplete" : "");
    if (Object.keys(errors).length) return;
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setPending(true);
    setFormError("");
    try {
      const result = await submitOnboarding({ data: form });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        setFormError(result.message);
        const first = Object.keys(result.fieldErrors)[0];
        if (first) setStep(stepForField(first));
        return;
      }
      const next: Receipt = { ...result, businessName: form.businessName };
      sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(next));
      sessionStorage.removeItem(DRAFT_KEY);
      setReceipt(next);
      setStep(4);
    } catch {
      setFormError("key:home.sendFailed");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(RECEIPT_KEY);
    setForm(emptyDraft());
    setReceipt(null);
    setFieldErrors({});
    setFormError("");
    setStep(0);
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-e lg:px-8 lg:py-10">
        <div className="flex items-start justify-between gap-3 px-4 py-4 lg:px-0">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="h-12 w-12 rounded-xl" />
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
              <p className="truncate text-sm text-muted">{t("home.tagline")}</p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="flex gap-1.5 px-4 pb-4 lg:hidden" aria-hidden="true">
          {STEP_KEYS.map((key, index) => (
            <span key={key} className={cn("h-1.5 flex-1 rounded-full", index <= step ? "bg-primary" : "bg-line")} />
          ))}
        </div>
        <ol className="mt-8 hidden space-y-2 lg:block">
          {STEP_KEYS.map((key, index) => {
            const current = index === step;
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={Boolean(receipt) || index > step}
                  onClick={() => setStep(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start disabled:cursor-default",
                    current ? "bg-primary-soft text-ink" : "text-muted",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full text-sm font-semibold",
                      current ? "bg-primary text-primary-ink" : index < step ? "bg-primary-soft text-primary" : "bg-bg text-muted",
                    )}
                  >
                    {index + 1}
                  </span>
                  {t(key)}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-auto hidden text-sm leading-relaxed text-muted lg:block">{t("home.asideNote")}</p>
      </aside>

      <main className="mx-auto flex w-full max-w-xl flex-col px-4 py-6 lg:px-10 lg:py-12">
        <p className="text-sm font-medium text-primary">{t("home.stepCount", { current: step + 1, total: STEP_KEYS.length })}</p>
        <form
          className="mt-3 flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (step < 4 && !pending) void goNext();
          }}
        >
          {step === 0 ? <Welcome /> : null}
          {step === 1 ? <BusinessStep form={form} errors={fieldErrors} onChange={update} /> : null}
          {step === 2 ? <SocialStep form={form} errors={fieldErrors} onChange={update} /> : null}
          {step === 3 ? <PreferenceStep form={form} errors={fieldErrors} onChange={update} /> : null}
          {step === 4 && receipt ? <Confirmation receipt={receipt} onReset={reset} /> : null}

          {formError ? (
            <p className="mt-4 text-sm text-danger" role="alert">
              {showNotice(locale, formError)}
            </p>
          ) : null}

          {step < 4 ? (
            <div className="mt-8 flex items-center gap-3 border-t border-line py-3 pb-safe">
              {step > 0 ? (
                <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={pending}>
                  <BackIcon className="size-5" aria-hidden="true" />
                  {t("common.back")}
                </Button>
              ) : null}
              <Button type="submit" className={cn("min-w-36", step === 0 ? "w-full" : "ms-auto")} disabled={pending} data-testid="next-step">
                {pending ? t("common.saving") : step === 0 ? t("home.start") : step === 3 ? t("home.submit") : t("home.next")}
                {pending ? null : <NextIcon className="size-5" aria-hidden="true" />}
              </Button>
            </div>
          ) : null}
        </form>
        <p className="mt-6 text-sm text-muted">
          <Link to="/admin" className="underline-offset-4 hover:underline">
            {t("common.staffLogin")}
          </Link>
        </p>
        <LegalLinks className="mt-3" />
      </main>
    </div>
  );
}

function Welcome() {
  const { locale, t } = useI18n();
  return (
    <div>
      <h1 className="text-3xl font-semibold leading-snug tracking-tight lg:text-4xl">{t("home.welcomeTitle")}</h1>
      <p className="mt-4 text-base leading-relaxed text-muted">{t("home.welcomeBody")}</p>
      <div className="mt-6 grid gap-3">
        {PLANS.map((plan) => (
          <article key={plan.code} className="rounded-2xl bg-surface p-4 shadow-card">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">{planLabel(plan.code, locale)}</h2>
              <p className="tabular-nums text-sm font-medium text-primary" dir="ltr">
                {formatIls(plan.price, locale)}
              </p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t(plan.code === "trial" ? "plan.trial.detail" : "plan.monthly.detail")}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{t("plan.videoNote")}</p>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { locale } = useI18n();
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-2">{children}</div>
      {hint ? <span className="mt-2 block text-sm text-muted">{hint}</span> : null}
      {error ? (
        <span className="mt-2 block text-sm text-danger" role="alert">
          {translateKnown(locale, error)}
        </span>
      ) : null}
    </label>
  );
}

function BusinessStep({
  form,
  errors,
  onChange,
}: {
  form: Draft;
  errors: Record<string, string>;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("home.businessTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("home.businessBody")}</p>
      </div>
      <Field label={t("home.field.businessName")} error={errors.businessName}>
        <input className={inputClass} value={form.businessName} autoComplete="organization" maxLength={80} onChange={(event) => onChange("businessName", event.target.value)} />
      </Field>
      <Field label={t("home.field.contactName")} error={errors.contactName}>
        <input className={inputClass} value={form.contactName} autoComplete="name" maxLength={80} onChange={(event) => onChange("contactName", event.target.value)} />
      </Field>
      <Field label={t("home.field.email")} error={errors.email}>
        <input className={cn(inputClass, "text-start")} dir="ltr" type="email" inputMode="email" autoComplete="email" value={form.email} maxLength={120} onChange={(event) => onChange("email", event.target.value)} />
      </Field>
      <Field label={t("home.field.phone")} error={errors.phone} hint={t("home.field.phoneHint")}>
        <input className={cn(inputClass, "text-start")} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder={t("home.phonePlaceholder")} value={form.phone} onChange={(event) => onChange("phone", event.target.value)} />
      </Field>
      <Field label={t("home.field.industry")} error={errors.industry}>
        <select id="industry" className={inputClass} value={form.industry} onChange={(event) => onChange("industry", event.target.value)}>
          <option value="">{t("home.industryPlaceholder")}</option>
          {INDUSTRIES.map((item) => (
            <option key={item.id} value={item.id}>
              {catalogLabel("industry", item.id, locale, item.label)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("home.field.description")} error={errors.description}>
        <textarea id="description" className={cn(inputClass, "h-28 py-3")} value={form.description} maxLength={600} onChange={(event) => onChange("description", event.target.value)} />
      </Field>
    </div>
  );
}

function SocialStep({
  form,
  errors,
  onChange,
}: {
  form: Draft;
  errors: Record<string, string>;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{t("home.socialTitle")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t("home.socialBody")}</p>
      <div className="mt-6 grid gap-3">
        {PLATFORMS.filter((platform) => platform.id === "instagram").map((platform) => (
          <article key={platform.id} className="rounded-2xl bg-surface p-4 shadow-card">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary">
                <Instagram className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{platform.label}</h2>
                <p className="text-sm text-muted">{t("home.professionalAccount")}</p>
              </div>
              <StatusPill code="awaiting_setup" />
            </div>
            <p className="mt-4 text-sm text-muted">{t("home.connectAfterSave")}</p>
          </article>
        ))}
      </div>
      <label className="mt-5 flex items-start gap-3 rounded-2xl bg-surface p-4 shadow-card">
        <input type="checkbox" className="mt-1 size-5 accent-primary" checked={form.acknowledgedNoPassword} onChange={(event) => onChange("acknowledgedNoPassword", event.target.checked)} />
        <span className="text-sm leading-relaxed">{t("home.noPasswordAck")}</span>
      </label>
      {errors.acknowledgedNoPassword ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {translateKnown(locale, errors.acknowledgedNoPassword)}
        </p>
      ) : null}
    </div>
  );
}

function PreferenceStep({
  form,
  errors,
  onChange,
}: {
  form: Draft;
  errors: Record<string, string>;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("home.prefTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("home.prefBody")}</p>
      </div>
      <Field label={t("home.field.audience")} error={errors.targetAudience}>
        <textarea className={cn(inputClass, "h-24 py-3")} value={form.targetAudience} maxLength={300} onChange={(event) => onChange("targetAudience", event.target.value)} />
      </Field>
      <ChoiceGroup label={t("home.field.voice")} error={errors.brandVoice} value={form.brandVoice} options={VOICES} group="voice" onChange={(value) => onChange("brandVoice", value)} />
      <Field label={t("home.field.services")} error={errors.services}>
        <textarea className={cn(inputClass, "h-24 py-3")} value={form.services} maxLength={400} onChange={(event) => onChange("services", event.target.value)} />
      </Field>
      <ChoiceGroup label={t("home.field.visual")} error={errors.visualStyle} value={form.visualStyle} options={VISUALS} group="visual" onChange={(value) => onChange("visualStyle", value)} />
      <fieldset>
        <legend className="text-sm font-medium">{t("home.field.plan")}</legend>
        <div className="mt-2 grid gap-3">
          {PLANS.map((plan) => {
            const selected = form.planCode === plan.code;
            return (
              <button key={plan.code} type="button" aria-pressed={selected} onClick={() => onChange("planCode", plan.code)} className={cn("rounded-2xl bg-surface p-4 text-start shadow-card", selected && "ring-2 ring-primary")}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-semibold">{planLabel(plan.code, locale)}</span>
                  <span className="tabular-nums text-sm font-medium text-primary" dir="ltr">
                    {formatIls(plan.price, locale)}
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-muted">{t(plan.code === "trial" ? "plan.trial.detail" : "plan.monthly.detail")}</span>
              </button>
            );
          })}
        </div>
        {errors.planCode ? <p className="mt-2 text-sm text-danger">{translateKnown(locale, errors.planCode)}</p> : null}
        <p className="mt-3 text-sm text-muted">
          {t("plan.videoNote")} {t("home.monthlyNoCharge")}
        </p>
      </fieldset>
    </div>
  );
}

function ChoiceGroup({
  label,
  value,
  options,
  group,
  error,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  group: "voice" | "visual";
  error?: string;
  onChange: (value: string) => void;
}) {
  const { locale } = useI18n();
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 grid gap-2" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <button key={option.id} type="button" role="radio" aria-checked={selected} onClick={() => onChange(option.id)} className={cn("h-12 rounded-xl border px-4 text-start", selected ? "border-primary bg-primary-soft text-ink" : "border-line bg-surface text-ink")}>
              {catalogLabel(group, option.id, locale, option.label)}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{translateKnown(locale, error)}</p> : null}
    </fieldset>
  );
}

function Confirmation({ receipt, onReset }: { receipt: Receipt; onReset: () => void }) {
  const { locale, t } = useI18n();
  const [approval, setApproval] = useState("pending_approval");
  const webhookKey = receipt.webhook === "sent" || receipt.webhook === "failed" || receipt.webhook === "skipped" ? receipt.webhook : "failed";
  const price = formatIls(receipt.plan.priceIlsInclVat, locale);
  useEffect(() => {
    let cancelled = false;
    getOwnApproval({ data: { reference: receipt.reference, connectSecret: receipt.connectSecret } })
      .then((result) => {
        if (!cancelled && result.ok && isApprovalStatus(result.approvalStatus)) setApproval(result.approvalStatus);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [receipt.reference, receipt.connectSecret]);
  const approvalKey: MessageKey =
    approval === "approved"
      ? "approval.approved"
      : approval === "rejected"
        ? "approval.rejected"
        : approval === "suspended"
          ? "approval.suspended"
          : "approval.pending_approval";
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{t("home.receivedTitle")}</h1>
      <p className="mt-4 rounded-2xl bg-primary-soft p-4 text-sm leading-relaxed" role="status">
        {t(approvalKey)}
      </p>
      <p className="mt-2 text-sm text-muted">{receipt.businessName}</p>
      <p className="mt-5 rounded-2xl bg-surface p-4 shadow-card">
        <span className="block text-sm text-muted">{t("home.reference")}</span>
        <span className="mt-1 block text-2xl font-semibold tracking-wide" dir="ltr">
          {receipt.reference}
        </span>
      </p>
      <ul className="mt-5 space-y-3 text-sm leading-relaxed text-ink">
        <li>{t("home.received.keep")}</li>
        <li>
          {t("home.received.plan", { name: planLabel(receipt.plan.code, locale), posts: receipt.plan.photoPosts, days: receipt.plan.businessDays })}
          {" · "}
          {receipt.plan.priceIlsInclVat > 0 ? t("home.received.planPaid", { price }) : t("price.free")}
          {". "}
          {t("home.received.planStatus", { status: statusLabel(receipt.plan.subscriptionStatus, locale) })}
        </li>
        <li>{t("home.received.connect")}</li>
        <li>{t("plan.videoNote")}</li>
        <li>{t(`home.webhook.${webhookKey}`)}</li>
      </ul>
      <p className="mt-4 text-sm text-muted">{t("home.received.planChosen", { name: planLabel(receipt.plan.code, locale) })}</p>
      <a href="/connect" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-white">
        {t("home.connectInstagram")}
      </a>
      <Button className="mt-3" variant="secondary" onClick={onReset}>
        {t("home.newRequest")}
      </Button>
    </div>
  );
}
