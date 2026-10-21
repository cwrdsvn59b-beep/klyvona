import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/he";
import {
  MANUAL_CONFIRMATION,
  instagramPermalink,
  manualPhase,
  normalizeManualCaption,
  normalizePublicJpegUrl,
  type ManualPhase,
} from "@/lib/instagram-manual-publish";
import {
  inspectInstagramManualPosts,
  listInstagramManualAccounts,
  publishInstagramManualPhoto,
  type ManualAccountChoice,
  type ManualHistoryItem,
} from "@/lib/instagram-manual-publish.functions";

const PHASE_KEY: Record<ManualPhase, MessageKey> = {
  preparation: "admin.manual.phasePreparation",
  publishing: "admin.manual.phasePublishing",
  success: "admin.manual.phaseSuccess",
  error: "admin.manual.phaseError",
};

/** Admin-only manual photo post. Nothing is sent until the confirmation button. */
export function InstagramManualPublish() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<ManualAccountChoice[]>([]);
  const [clientId, setClientId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [history, setHistory] = useState<ManualHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState<MessageKey | "">("");
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState<ManualPhase>("preparation");
  const [permalink, setPermalink] = useState<string | null>(null);

  const account = accounts.find((item) => item.clientId === clientId) ?? null;
  const jpeg = normalizePublicJpegUrl(imageUrl);
  const captionOk = normalizeManualCaption(caption) !== null;
  const locked = history.some((item) => item.status === "uncertain" || item.phase === "publishing");
  const canPrepare = Boolean(account?.ready) && Boolean(jpeg) && captionOk && !locked && !busy && phase === "preparation";

  async function loadAccounts() {
    const rows = await listInstagramManualAccounts();
    setAccounts(rows);
  }

  async function loadHistory(nextClientId: string) {
    if (!nextClientId) {
      setHistory([]);
      return;
    }
    setHistory(await inspectInstagramManualPosts({ data: { clientId: nextClientId } }));
  }

  useEffect(() => {
    let active = true;
    loadAccounts()
      .catch(() => {
        if (active) setError("admin.manual.loadFailed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function phaseText(value: ManualPhase) {
    return t(PHASE_KEY[value]);
  }

  async function publish() {
    if (!canPrepare || confirmation !== MANUAL_CONFIRMATION || !idempotencyKey || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setPhase("publishing");
    setConfirmOpen(false);
    try {
      const answer = await publishInstagramManualPhoto({
        data: {
          clientId,
          confirmation: MANUAL_CONFIRMATION,
          idempotencyKey,
          imageUrl: jpeg ?? "",
          caption,
        },
      });
      const nextPhase = answer.phase ?? manualPhase(answer.status);
      setPhase(nextPhase);
      const link = instagramPermalink(answer.permalink);
      setPermalink(link);
      setNotice(answer.ok
        ? t("admin.manual.published")
        : t("admin.manual.rejected", { value: answer.code }));
      if (!answer.anotherPostAllowed) setIdempotencyKey("");
      await loadHistory(clientId);
    } catch {
      setPhase("error");
      setError("admin.manual.unknownResult");
      try { await loadHistory(clientId); } catch { /* Do not send another post. */ }
    } finally {
      setBusy(false);
      setConfirmation("");
    }
  }

  return (
    <section id="instagram-manual-publish" className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">{t("admin.manual.title")}</h2>
      <p className="mt-2 text-sm text-muted">{t("admin.manual.intro")}</p>
      {loading ? <p className="mt-3 text-sm">{t("admin.manual.loading")}</p> : null}
      <label className="mt-4 block text-sm font-medium" htmlFor="manual-instagram-account">{t("admin.manual.choose")}</label>
      <select
        id="manual-instagram-account"
        className="mt-2 w-full rounded-xl border border-line bg-surface p-3"
        value={clientId}
        onChange={(event) => {
          const next = event.target.value;
          setClientId(next);
          setPhase("preparation");
          setPermalink(null);
          setNotice("");
          setError("");
          setConfirmOpen(false);
          setConfirmation("");
          setIdempotencyKey("");
          loadHistory(next).catch(() => setError("admin.manual.loadFailed"));
        }}
      >
        <option value="">{t("admin.manual.choose")}</option>
        {accounts.map((item) => (
          <option key={item.clientId} value={item.clientId} disabled={!item.ready}>
            {item.businessName} · @{item.username ?? item.reference} · {item.reference}
            {item.ready ? "" : ` · ${item.block ?? "blocked"}`}
          </option>
        ))}
      </select>
      {accounts.length === 0 && !loading ? <p className="mt-2 text-sm text-muted">{t("admin.manual.noAccounts")}</p> : null}
      {account && !account.ready ? (
        <p className="mt-2 text-sm" role="status">{t("admin.manual.blocked", { value: account.block ?? "unknown" })}</p>
      ) : null}
      <label className="mt-4 block text-sm font-medium" htmlFor="manual-image-url">{t("admin.manual.image")}</label>
      <input
        id="manual-image-url"
        className="mt-2 w-full rounded-xl border border-line bg-surface p-3"
        value={imageUrl}
        dir="ltr"
        autoComplete="off"
        onChange={(event) => setImageUrl(event.target.value)}
      />
      {jpeg ? <img src={jpeg} alt="" className="mt-3 size-36 rounded-xl border border-line object-cover" /> : null}
      {imageUrl && !jpeg ? <p className="mt-2 text-sm text-danger">{t("admin.manual.imageInvalid")}</p> : null}
      <label className="mt-4 block text-sm font-medium" htmlFor="manual-caption">{t("admin.manual.caption")}</label>
      <textarea
        id="manual-caption"
        className="mt-2 min-h-24 w-full rounded-xl border border-line bg-surface p-3"
        value={caption}
        maxLength={2200}
        onChange={(event) => setCaption(event.target.value)}
      />
      {caption && !captionOk ? <p className="mt-2 text-sm text-danger">{t("admin.manual.captionInvalid")}</p> : null}
      <p className="mt-4 text-sm text-muted">{t("admin.manual.statusLabel")}</p>
      <p className="text-xl font-semibold" role="status">{phaseText(phase)}</p>
      {permalink ? (
        <a className="mt-2 inline-block underline" href={permalink} target="_blank" rel="noreferrer">
          {t("admin.manual.openPost")}
        </a>
      ) : null}
      {notice ? <p className="mt-2 text-sm" role="status">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{t(error)}</p> : null}
      {locked ? <p className="mt-2 text-sm text-danger">{t("admin.manual.uncertain")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => {
          setLoading(true);
          loadAccounts().then(() => loadHistory(clientId)).catch(() => setError("admin.manual.loadFailed")).finally(() => setLoading(false));
        }}>{t("admin.manual.refresh")}</Button>
        <Button disabled={!canPrepare} onClick={() => {
          setIdempotencyKey((current) => current || crypto.randomUUID());
          setConfirmation("");
          setConfirmOpen(true);
        }}>{t("admin.manual.prepare")}</Button>
        {phase === "success" || phase === "error" ? (
          <Button variant="secondary" disabled={busy || locked} onClick={() => {
            setPhase("preparation");
            setPermalink(null);
            setNotice("");
            setError("");
            setIdempotencyKey("");
            setConfirmation("");
            setConfirmOpen(false);
          }}>{t("admin.manual.newPost")}</Button>
        ) : null}
      </div>
      {history.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t("admin.manual.history")}</h3>
          <ul className="mt-2 grid gap-2">
            {history.map((item) => (
              <li key={item.id} className="rounded-xl bg-bg p-3 text-sm">
                <p>{phaseText(item.phase)} · <span dir="ltr">{item.status}</span></p>
                {instagramPermalink(item.permalink) ? (
                  <a className="underline" href={item.permalink ?? undefined} target="_blank" rel="noreferrer">{t("admin.manual.openPost")}</a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirmOpen && canPrepare ? (
        <div role="dialog" aria-modal="true" aria-label={t("admin.manual.confirmTitle")} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("admin.manual.confirmTitle")}</h3>
            <p className="mt-2 text-sm">{t("admin.manual.confirmBody")}</p>
            <p className="mt-2 text-sm" dir="ltr">@{account?.username ?? account?.reference}</p>
            <p className="mt-3 font-mono text-sm" dir="ltr">{MANUAL_CONFIRMATION}</p>
            <input
              className="mt-2 w-full rounded-xl border border-line bg-surface p-3"
              value={confirmation}
              dir="ltr"
              autoComplete="off"
              aria-label={t("admin.manual.confirmCode")}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>{t("common.cancel")}</Button>
              <Button disabled={busy || confirmation !== MANUAL_CONFIRMATION} onClick={() => void publish()}>
                {busy ? t("admin.manual.publishing") : t("admin.manual.confirmSend")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
