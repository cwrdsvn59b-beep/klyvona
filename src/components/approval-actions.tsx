import { useState } from "react";
import { setClientApproval } from "@/lib/approval.functions";
import type { ApprovalStatus } from "@/lib/approval";
import { isApprovalStatus } from "@/lib/approval";
import { useI18n } from "@/lib/i18n/context";
import { showNotice } from "@/lib/i18n/surface";
import { Button } from "@/components/ui/button";

export function ApprovalActions({
  clientId,
  status,
  onChanged,
}: {
  clientId: string;
  status: string;
  onChanged: () => void;
}) {
  const { locale, t } = useI18n();
  const [confirming, setConfirming] = useState<null | "rejected" | "suspended">(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [deliveryWarning, setDeliveryWarning] = useState("");
  if (!isApprovalStatus(status)) return null;

  async function commit(next: Exclude<ApprovalStatus, "pending_approval">) {
    setPending(true);
    setNotice("");
    setDeliveryWarning("");
    try {
      const result = await setClientApproval({ data: { clientId, status: next, reason } });
      setNotice(result.message);
      if (result.ok && !result.unchanged && "webhookStatus" in result && result.webhookStatus !== "sent") {
        const messages = {
          he: result.webhookStatus === "skipped"
            ? "האישור נשמר, אך השליחה ל-Make דולגה. בדקו את הגדרת החיבור."
            : "האישור נשמר, אך השליחה ל-Make נכשלה. בדקו את החיבור.",
          ru: result.webhookStatus === "skipped"
            ? "Одобрение сохранено, но отправка в Make пропущена. Проверьте подключение."
            : "Одобрение сохранено, но отправка в Make не удалась. Проверьте подключение.",
          en: result.webhookStatus === "skipped"
            ? "Approval saved, but delivery to Make was skipped. Check the integration."
            : "Approval saved, but delivery to Make failed. Check the integration.",
        };
        setDeliveryWarning(messages[locale]);
      }
      if (result.ok) {
        setConfirming(null);
        setReason("");
        onChanged();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "key:admin.approvalConflict");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 grid gap-2">
      {confirming ? (
        <>
          <label className="text-sm">
            {confirming === "rejected" ? t("admin.confirmReject") : t("admin.confirmSuspend")}
            <textarea
              value={reason}
              maxLength={400}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 h-20 w-full rounded-xl border border-line bg-surface px-3 py-2 text-base"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => void commit(confirming)}>
              {confirming === "rejected" ? t("admin.confirmReject") : t("admin.confirmSuspend")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(null)}>
              {t("admin.cancelAction")}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status !== "approved" ? (
            <Button disabled={pending} onClick={() => void commit("approved")}>
              {t("admin.approve")}
            </Button>
          ) : null}
          {status === "pending_approval" ? (
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming("rejected")}>
              {t("admin.reject")}
            </Button>
          ) : null}
          {status === "approved" ? (
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming("suspended")}>
              {t("admin.suspend")}
            </Button>
          ) : null}
        </div>
      )}
      {notice ? <p className="text-sm text-muted">{showNotice(locale, notice)}</p> : null}
      {deliveryWarning ? <p role="alert" className="text-sm text-danger">{deliveryWarning}</p> : null}
    </div>
  );
}
