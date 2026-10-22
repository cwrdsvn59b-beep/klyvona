import { useEffect, useState } from "react";
import { PhotoReviewList } from "@/components/photo-review-list";
import type { MessageKey } from "@/lib/i18n/he";
import { useI18n } from "@/lib/i18n/context";
import { decideAdminPhotoReview, listAdminPhotoReviews, saveAdminPhotoCaption } from "@/lib/integrations/photo-review.admin.functions";
import type { PhotoReview, ReviewDecision } from "@/lib/integrations/photo-review.server";

const NOTICES: Record<string, MessageKey> = {
  saved: "reviews.saved",
  approved: "reviews.approvedDone",
  rejected: "reviews.rejectedDone",
  locked: "reviews.locked",
  forbidden: "reviews.forbidden",
  not_found: "reviews.forbidden",
  conflict: "reviews.locked",
  invalid: "reviews.unavailable",
  unavailable: "reviews.unavailable",
};

export function AdminPhotoReviews({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<PhotoReview[]>([]);
  const [notice, setNotice] = useState<MessageKey | "">("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminPhotoReviews({ data: { clientId } })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setNotice(NOTICES[result.code] ?? "reviews.unavailable");
          setItems([]);
          return;
        }
        setItems(result.items);
      })
      .catch(() => {
        if (!cancelled) setNotice("reviews.unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function reload() {
    const result = await listAdminPhotoReviews({ data: { clientId } });
    if (result.ok) setItems(result.items);
  }

  async function onSave(jobId: string, caption: string) {
    setBusyId(jobId);
    setNotice("");
    try {
      const result = await saveAdminPhotoCaption({ data: { clientId, jobId, caption } });
      setNotice(result.ok ? "reviews.saved" : (NOTICES[result.code] ?? "reviews.unavailable"));
      if (result.ok) await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onDecide(jobId: string, decision: ReviewDecision) {
    setBusyId(jobId);
    setNotice("");
    try {
      const result = await decideAdminPhotoReview({ data: { clientId, jobId, decision } });
      setNotice(result.ok ? (decision === "approved" ? "reviews.approvedDone" : "reviews.rejectedDone") : (NOTICES[result.code] ?? "reviews.unavailable"));
      if (result.ok) await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card">
      <h2 className="font-semibold">{t("admin.photoReviews")}</h2>
      <p className="mt-2 text-sm text-muted">{t("admin.photoReviewsNote")}</p>
      {notice ? <p className="mt-3 text-sm" role="status">{t(notice)}</p> : null}
      <PhotoReviewList items={items} busyId={busyId} onSave={onSave} onDecide={onDecide} />
    </section>
  );
}
