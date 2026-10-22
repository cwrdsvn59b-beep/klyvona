import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalLinks } from "@/components/legal-links";
import { PhotoReviewList } from "@/components/photo-review-list";
import type { MessageKey } from "@/lib/i18n/he";
import { useI18n } from "@/lib/i18n/context";
import { localeFromMatches, usePageTitle } from "@/lib/i18n/page-title";
import { translate } from "@/lib/i18n/translate";
import { decideOwnPhotoReview, listOwnPhotoReviews, saveOwnPhotoCaption } from "@/lib/integrations/photo-review.functions";
import type { PhotoReview, ReviewDecision } from "@/lib/integrations/photo-review.server";
import type { QuotaView } from "@/lib/integrations/quota-period";
import { readConnectReceipt, type ConnectReceipt } from "@/lib/oauth/connect-session";

export const Route = createFileRoute("/reviews")({
  head: ({ matches }) => ({ meta: [{ title: translate(localeFromMatches(matches), "meta.reviewsTitle") }] }),
  component: ReviewsPage,
});

const NOTICES: Record<string, MessageKey> = {
  saved: "reviews.saved",
  approved: "reviews.approvedDone",
  rejected: "reviews.rejectedDone",
  locked: "reviews.locked",
  unauthorized: "reviews.forbidden",
  not_found: "reviews.forbidden",
  conflict: "reviews.locked",
  invalid: "reviews.unavailable",
  unavailable: "reviews.unavailable",
};

function ReviewsPage() {
  const { t } = useI18n();
  usePageTitle(t("meta.reviewsTitle"));
  const [receipt, setReceipt] = useState<ConnectReceipt | null>(null);
  const [items, setItems] = useState<PhotoReview[]>([]);
  const [quota, setQuota] = useState<QuotaView | null>(null);
  const [notice, setNotice] = useState<MessageKey | "">("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setReceipt(readConnectReceipt(sessionStorage.getItem("klyvona-onboarding-receipt")));
  }, []);

  useEffect(() => {
    if (!receipt?.connectSecret) return;
    let cancelled = false;
    listOwnPhotoReviews({ data: { reference: receipt.reference, connectSecret: receipt.connectSecret } })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setNotice(NOTICES[result.code] ?? "reviews.unavailable");
          setItems([]);
          return;
        }
        setItems(result.items);
        setQuota(result.quota);
      })
      .catch(() => {
        if (!cancelled) setNotice("reviews.unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [receipt]);

  async function reload() {
    if (!receipt) return;
    const result = await listOwnPhotoReviews({ data: { reference: receipt.reference, connectSecret: receipt.connectSecret } });
    if (result.ok) {
      setItems(result.items);
      setQuota(result.quota);
    }
  }

  async function onSave(jobId: string, caption: string) {
    if (!receipt) return;
    setBusyId(jobId);
    setNotice("");
    try {
      const result = await saveOwnPhotoCaption({ data: { reference: receipt.reference, connectSecret: receipt.connectSecret, jobId, caption } });
      setNotice(result.ok ? "reviews.saved" : (NOTICES[result.code] ?? "reviews.unavailable"));
      if (result.ok) await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onDecide(jobId: string, decision: ReviewDecision) {
    if (!receipt) return;
    setBusyId(jobId);
    setNotice("");
    try {
      const result = await decideOwnPhotoReview({ data: { reference: receipt.reference, connectSecret: receipt.connectSecret, jobId, decision } });
      setNotice(result.ok ? (decision === "approved" ? "reviews.approvedDone" : "reviews.rejectedDone") : (NOTICES[result.code] ?? "reviews.unavailable"));
      if (result.ok) await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="h-12 w-12 rounded-xl" />
          <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
        </div>
        <LanguageSwitcher />
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t("reviews.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t("reviews.lead")}</p>
      {quota?.ledger === "period" ? (
        <p className="mt-2 text-sm text-muted">
          {t("reviews.quota", {
            consumed: quota.consumed,
            reserved: quota.reserved,
            available: quota.available,
            start: quota.periodStart ?? "",
            last: quota.periodLast ?? "",
          })}
        </p>
      ) : null}
      {!receipt?.connectSecret ? (
        <p className="mt-6 text-sm">{t("reviews.gate")}</p>
      ) : (
        <>
          {notice ? <p className="mt-4 text-sm" role="status">{t(notice)}</p> : null}
          <PhotoReviewList items={items} busyId={busyId} onSave={onSave} onDecide={onDecide} />
        </>
      )}
      <p className="mt-6 text-sm">
        <Link to="/connect" className="underline">{t("reviews.back")}</Link>
      </p>
      <LegalLinks />
    </main>
  );
}
