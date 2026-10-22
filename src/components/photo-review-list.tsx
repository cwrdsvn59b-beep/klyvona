import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/he";
import { useI18n } from "@/lib/i18n/context";
import type { PhotoReview, ReviewDecision } from "@/lib/integrations/photo-review.server";

function statusKey(status: PhotoReview["reviewStatus"]): MessageKey {
  if (status === "approved") return "reviews.status.approved";
  if (status === "rejected") return "reviews.status.rejected";
  return "reviews.status.pending";
}

export function PhotoReviewList({
  items,
  busyId,
  onSave,
  onDecide,
}: {
  items: PhotoReview[];
  busyId: string | null;
  onSave: (jobId: string, caption: string) => Promise<void>;
  onDecide: (jobId: string, decision: ReviewDecision) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (items.length === 0) return <p className="mt-2 text-sm text-muted">{t("reviews.empty")}</p>;

  return (
    <ul className="mt-4 grid gap-4">
      {items.map((item) => {
        const pending = item.reviewStatus === "pending";
        const caption = drafts[item.jobId] ?? item.caption;
        const busy = busyId === item.jobId;
        return (
          <li key={item.jobId} className="rounded-2xl bg-surface p-4 shadow-card">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" className="h-48 w-full rounded-xl border border-line object-cover" referrerPolicy="no-referrer" />
            ) : (
              <p className="text-sm text-muted">{t("reviews.generated")}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{t(statusKey(item.reviewStatus))}</span>
              <span className="text-muted">{t("reviews.created")}: {formatWhen(item.createdAt, locale)}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{t("reviews.generated")}</p>
            <label className="mt-3 block text-sm font-medium" htmlFor={`caption-${item.jobId}`}>{t("reviews.caption")}</label>
            <textarea
              id={`caption-${item.jobId}`}
              className="mt-2 min-h-24 w-full rounded-xl border border-line bg-surface p-3"
              value={caption}
              maxLength={2200}
              readOnly={!pending}
              onChange={(event) => setDrafts((current) => ({ ...current, [item.jobId]: event.target.value }))}
            />
            {pending ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onSave(item.jobId, caption)}>
                  {t("reviews.saveCaption")}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void onDecide(item.jobId, "approved")}>
                  {t("reviews.approve")}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onDecide(item.jobId, "rejected")}>
                  {t("reviews.reject")}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
