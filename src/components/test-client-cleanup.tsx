import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inspectTestClients, type CleanupPreview } from "@/lib/test-client-cleanup.functions";
import type { ClientListItem } from "@/lib/admin.functions";
import { useI18n } from "@/lib/i18n/context";

const TEST_REFERENCES = [
  "KV-X4WKZC", "KV-L6XE9Y", "KV-NDYMH6", "KV-J32PC5",
  "KV-5NL7MT", "KV-625UT7", "KV-H6LNAK", "KV-FKH955",
  "KV-ASGQ4M", "KV-G6G87U", "KV-P8C9G8", "KV-V9C6NT",
] as const;

const labels = {
  ru: {
    title: "Проверка тестовых клиентов",
    description: "Выберите клиентов и проверьте связанные записи в рабочей базе. Удаление отключено.",
    choose: "Выбрать 12 тестовых",
    clear: "Снять выбор",
    inspect: "Проверить в Neon",
    checking: "Проверяем…",
    found: "Найденные клиенты",
    missing: "Не найдены",
    related: "Связанные записи",
    empty: "Нет записей",
    blocked: "Удаление отключено до отдельного подтверждения и проверки.",
    count: "Выбрано",
  },
  he: {
    title: "בדיקת לקוחות בדיקה",
    description: "בחרו לקוחות ובדקו רשומות קשורות במסד הנתונים הפעיל. המחיקה מושבתת.",
    choose: "בחירת 12 לקוחות בדיקה",
    clear: "ניקוי הבחירה",
    inspect: "בדיקה ב-Neon",
    checking: "בודקים…",
    found: "לקוחות שנמצאו",
    missing: "לא נמצאו",
    related: "רשומות קשורות",
    empty: "אין רשומות",
    blocked: "המחיקה מושבתת עד לאישור נפרד ובדיקה.",
    count: "נבחרו",
  },
  en: {
    title: "Test client inspection",
    description: "Select clients and inspect related records in the live database. Deletion is disabled.",
    choose: "Select 12 test clients",
    clear: "Clear selection",
    inspect: "Inspect in Neon",
    checking: "Checking…",
    found: "Matched clients",
    missing: "Not found",
    related: "Related records",
    empty: "No records",
    blocked: "Deletion is disabled pending a separate review and approval.",
    count: "Selected",
  },
};

export function TestClientCleanup({ clients }: { clients: ClientListItem[] }) {
  const { locale } = useI18n();
  const l = labels[locale];
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (reference: string) => {
    setPreview(null);
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

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-lg font-semibold">{l.title}</h2>
      <p className="mt-2 text-sm text-muted">{l.description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => {
          setSelected([...TEST_REFERENCES]);
          setPreview(null);
        }}>{l.choose}</Button>
        <Button variant="secondary" size="sm" onClick={() => {
          setSelected([]);
          setPreview(null);
        }}>{l.clear}</Button>
      </div>
      <p className="mt-3 text-sm text-muted">{l.count}: {selected.length}</p>
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
          {busy ? l.checking : l.inspect}
        </Button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {preview ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          <h3 className="font-semibold">{l.found}: {preview.matches.length}</h3>
          <ul className="grid gap-1 text-sm">
            {preview.matches.map((client) => (
              <li key={client.id}>
                <span dir="ltr">{client.reference}</span> · {client.businessName} · {client.approvalStatus}
              </li>
            ))}
          </ul>
          {preview.missing.length > 0 ? (
            <p role="alert" className="text-sm text-danger">
              {l.missing}: <span dir="ltr">{preview.missing.join(", ")}</span>
            </p>
          ) : null}
          <h3 className="font-semibold">{l.related}</h3>
          {preview.counts.length ? (
            <ul className="grid gap-1 text-sm">
              {preview.counts.map((item) => (
                <li key={item.table}><span dir="ltr">{item.table}</span>: {item.count}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{l.empty}</p>}
        </div>
      ) : null}
      <p className="mt-4 text-sm font-medium text-danger">{l.blocked}</p>
    </section>
  );
}
