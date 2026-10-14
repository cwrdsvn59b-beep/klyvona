import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/he";
import {
  inspectInstagramTestPublish,
  diagnoseInstagramTestAttempt,
  type InstagramTestDiagnosis,
  publishOneInstagramTest,
  type TestPublishStatus,
} from "@/lib/instagram-test-publish.functions";

const CONFIRM = "PUBLISH KV-EKBXGL";

/** Only displayed on the dedicated KLYVONA internal test client's admin page. */
export function InstagramTestPublish({ reference }: { reference: string }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<TestPublishStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<MessageKey | "">("");
  const [result, setResult] = useState("");
  const [diagnosis, setDiagnosis] = useState<InstagramTestDiagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  async function refresh() {
    const state = await inspectInstagramTestPublish();
    setSnapshot(state);
  }

  useEffect(() => {
    if (reference !== "KV-EKBXGL") return;
    let active = true;
    inspectInstagramTestPublish().then((state) => {
      if (active) setSnapshot(state);
    }).catch(() => {
      if (active) setError("admin.test.readinessFailed");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reference]);

  if (reference !== "KV-EKBXGL") return null;
  const attempt = snapshot?.attempt;
  const canPublish = snapshot?.ready === true && !attempt && !busy;

  async function publish() {
    if (!canPublish || confirmation !== CONFIRM) return;
    setBusy(true);
    setError("");
    setResult("");
    setConfirmOpen(false);
    try {
      const answer = await publishOneInstagramTest({ data: { confirmation: CONFIRM } });
      setResult(answer.ok
        ? t("admin.test.published", { value: answer.mediaId ?? "" })
        : t("admin.test.rejected", { value: answer.code }));
      await refresh();
    } catch {
      setError("admin.test.unknownResult");
      try { await refresh(); } catch { /* Never retry a publish. */ }
    } finally {
      setBusy(false);
      setConfirmation("");
    }
  }

  const matched = diagnosis?.recentPostMatched == null
    ? t("admin.test.matchedUnknown")
    : diagnosis.recentPostMatched
      ? t("common.yes")
      : t("common.no");

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">{t("admin.test.title")}</h2>
      <p className="mt-2 text-sm text-muted">{t("admin.test.intro")}</p>
      <img src="https://placehold.co/640x640/ffffff/40337a.jpg?text=KLYVONA+TEST" alt="KLYVONA TEST" className="mt-3 size-32 rounded-xl border border-line object-cover" />
      {loading ? <p className="mt-3 text-sm">{t("admin.test.checking")}</p> : null}
      {snapshot ? (
        <p className="mt-3 text-sm" role="status">
          {snapshot.ready
            ? t("admin.test.ready")
            : t("admin.test.blocked", { value: snapshot.block ?? "unknown" })}
        </p>
      ) : null}
      {attempt ? (
        <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
          <p>{t("admin.test.prior")} <strong dir="ltr">{attempt.status}</strong></p>
          <p>{t("admin.test.date")} {attempt.created_at}</p>
          {attempt.media_id ? <p dir="ltr">Media ID: {attempt.media_id}</p> : null}
          {attempt.permalink ? (
            <a href={attempt.permalink} target="_blank" rel="noreferrer" className="underline">
              {t("admin.test.viewPost")}
            </a>
          ) : null}
          {attempt.error_code ? <p dir="ltr">Code: {attempt.error_code}</p> : null}
          <p className="mt-2 text-muted">{t("admin.test.locked")}</p>
        </div>
      ) : null}
      {attempt ? (
        <div className="mt-3">
          <Button variant="secondary" disabled={busy || diagnosing} onClick={async () => {
            setDiagnosing(true);
            setError("");
            try {
              setDiagnosis(await diagnoseInstagramTestAttempt());
            } catch {
              setError("admin.test.diagnoseFailed");
            } finally {
              setDiagnosing(false);
            }
          }}>{diagnosing ? t("admin.test.diagnosing") : t("admin.test.diagnose")}</Button>
          {diagnosis ? (
            <div className="mt-3 rounded-xl border border-line p-3 text-sm" role="status">
              <p>{t("admin.test.diagResult")} <span dir="ltr">{diagnosis.check}</span></p>
              <p>{t("admin.test.containerState")} <span dir="ltr">{diagnosis.containerStatus ?? "unknown"}</span></p>
              <p>{t("admin.test.containerHttp")} <span dir="ltr">{diagnosis.containerHttpStatus ?? "not checked"}</span></p>
              {diagnosis.containerErrorCode != null ? <p>Meta container error: {diagnosis.containerErrorCode} / {diagnosis.containerErrorSubcode ?? "-"}</p> : null}
              <p>{t("admin.test.mediaList")} {matched}</p>
              <p>{t("admin.test.mediaHttp")} <span dir="ltr">{diagnosis.recentMediaHttpStatus ?? "not checked"}</span></p>
              {diagnosis.recentMediaErrorCode != null ? <p>Meta media error: {diagnosis.recentMediaErrorCode}</p> : null}
              {diagnosis.matchedMediaId ? <p dir="ltr">Media ID: {diagnosis.matchedMediaId}</p> : null}
              {diagnosis.matchedPermalink ? <a className="underline" href={diagnosis.matchedPermalink} target="_blank" rel="noreferrer">{t("admin.test.openPost")}</a> : null}
              <p className="mt-2 text-muted">{t("admin.test.readOnlyNote")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {result ? <p role="status" className="mt-3 text-sm">{result}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{t(error)}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => {
          setLoading(true);
          refresh().catch(() => setError("admin.test.readinessFailed")).finally(() => setLoading(false));
        }}>{t("admin.test.refresh")}</Button>
        <Button disabled={!canPublish} onClick={() => setConfirmOpen(true)}>
          {t("admin.test.publish")}
        </Button>
      </div>
      {confirmOpen && canPublish ? (
        <div role="dialog" aria-modal="true" aria-label={t("admin.test.dialogLabel")} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("admin.test.confirmTitle")}</h3>
            <p className="mt-2 text-sm">{t("admin.test.confirmBody")}</p>
            <p className="mt-3 font-mono text-sm" dir="ltr">{CONFIRM}</p>
            <input
              className="mt-2 w-full rounded-xl border border-line bg-surface p-3"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-label={t("admin.test.confirmCode")}
              autoComplete="off"
              dir="ltr"
            />
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>{t("common.cancel")}</Button>
              <Button disabled={busy || confirmation !== CONFIRM} onClick={() => void publish()}>
                {busy ? t("admin.test.publishing") : t("admin.test.confirmSend")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
