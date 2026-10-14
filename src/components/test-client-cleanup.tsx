import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inspectTestClients, deleteConfirmedTestClients, type CleanupPreview } from "@/lib/test-client-cleanup.functions";
import type { ClientListItem } from "@/lib/admin.functions";
import { useI18n } from "@/lib/i18n/context";

export function TestClientCleanup({ clients, onDeleted }: { clients: ClientListItem[]; onDeleted: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [success, setSuccess] = useState<number | null>(null);

  const toggle = (reference: string) => {
    setPreview(null);
    setSuccess(null);
    setSelected((previous) => previous.includes(reference)
      ? previous.filter((item) => item !== reference)
      : [...previous, reference]);
  };

  const inspect = async () => {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(await inspectTestClients({ data: { references: selected } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const canDelete = Boolean(preview?.safeToReview && preview.matches.length === selected.length &&
    preview.matches.every((client) => selected.includes(client.reference)));

  const remove = async () => {
    if (!preview || !canDelete || confirmation !== `DELETE ${selected.length}`) return;
    setBusy(true);
    setError("");
    try {
      const result = await deleteConfirmedTestClients({ data: {
        references: preview.matches.map((client) => client.reference),
        ids: preview.matches.map((client) => client.id),
        confirmation,
      } });
      setSuccess(result.deleted.length);
      setSelected([]);
      setPreview(null);
      setConfirmOpen(false);
      setConfirmation("");
      onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setConfirmOpen(false);
      setPreview(null); // Force a new Neon inspection before retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-lg font-semibold">{t("admin.cleanup.title")}</h2>
      <p className="mt-2 text-sm text-muted">{t("admin.cleanup.description")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={clients.length === 0 || busy} onClick={() => {
          setSelected(clients.map((client) => client.reference));
          setPreview(null);
          setSuccess(null);
        }}>{t("admin.cleanup.choose")}</Button>
        <Button variant="secondary" size="sm" onClick={() => {
          setSelected([]);
          setPreview(null);
          setSuccess(null);
        }}>{t("admin.cleanup.clear")}</Button>
      </div>
      <p className="mt-3 text-sm text-muted">{t("admin.cleanup.count")}: {selected.length}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {clients.map((client) => (
          <label key={client.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3">
            <input type="checkbox" className="size-4" checked={selected.includes(client.reference)}
              onChange={() => toggle(client.reference)} />
            <span className="min-w-0">
              <span className="block text-sm font-medium" dir="ltr">{client.reference}</span>
              <span className="block truncate text-sm text-muted">{client.businessName}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4">
        <Button disabled={busy || selected.length === 0 || selected.length > 30} onClick={() => void inspect()}>
          {busy ? t("admin.cleanup.checking") : t("admin.cleanup.inspect")}
        </Button>
      </div>
      {success !== null ? <p role="status" className="mt-3 text-sm">{t("admin.cleanup.done")}: {success}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {preview ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          <h3 className="font-semibold">{t("admin.cleanup.found")}: {preview.matches.length}</h3>
          <ul className="grid gap-1 text-sm">
            {preview.matches.map((client) => (
              <li key={client.id}>
                <span dir="ltr">{client.reference}</span> · {client.businessName} · {client.approvalStatus}
              </li>
            ))}
          </ul>
          {preview.missing.length > 0 ? (
            <p role="alert" className="text-sm text-danger">
              {t("admin.cleanup.missing")}: <span dir="ltr">{preview.missing.join(", ")}</span>
            </p>
          ) : null}
          <h3 className="font-semibold">{t("admin.cleanup.related")}</h3>
          {preview.counts.length ? (
            <ul className="grid gap-1 text-sm">
              {preview.counts.map((item) => (
                <li key={item.table}><span dir="ltr">{item.table}</span>: {item.count}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{t("admin.cleanup.empty")}</p>}
        </div>
      ) : null}
      {canDelete ? (
        <div className="mt-4">
          <Button disabled={busy} className="bg-danger text-white hover:opacity-90" onClick={() => {
            setConfirmation("");
            setConfirmOpen(true);
          }}>{t("admin.cleanup.delete")} ({selected.length})</Button>
        </div>
      ) : null}
      {confirmOpen && canDelete ? (
        <div role="dialog" aria-modal="true" aria-label={t("admin.cleanup.confirmTitle")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{t("admin.cleanup.confirmTitle")}</h3>
            <p className="mt-3 text-sm">{t("admin.cleanup.confirmText")}</p>
            <ul className="mt-3 max-h-40 overflow-y-auto text-sm" dir="ltr">
              {preview?.matches.map((client) => <li key={client.id}>{client.reference} — {client.businessName}</li>)}
            </ul>
            <p className="mt-3 font-mono text-sm" dir="ltr">DELETE {selected.length}</p>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off" aria-label={t("admin.cleanup.confirmTitle")}
              className="mt-2 w-full rounded-xl border border-line bg-surface p-3" dir="ltr" />
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>{t("common.cancel")}</Button>
              <Button className="bg-danger text-white hover:opacity-90" disabled={busy || confirmation !== `DELETE ${selected.length}`}
                onClick={() => void remove()}>{busy ? t("admin.cleanup.deleting") : t("admin.cleanup.delete")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      <p className="mt-4 text-sm font-medium text-danger">{t("admin.cleanup.blocked")}</p>
    </section>
  );
}
