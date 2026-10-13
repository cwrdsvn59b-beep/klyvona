import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

export const TRACE_MEMORY_WARNING = translate("he", "admin.traceMemory");

export const TRACE_REFRESH_ERROR = translate("he", "admin.traceError");

export type TraceRow = {
  at: string;
  operation: string;
  result: string;
  grantStatus: string;
  grantSource: string;
  permissionsPresent: boolean;
};

export type TracePanel = {
  rows: TraceRow[];
  loading: boolean;
  refreshedAt: string | null;
  loadError: string | null;
};

export function emptyTracePanel(): TracePanel {
  return { rows: [], loading: false, refreshedAt: null, loadError: null };
}

export function traceOperationLabel(operation: string, locale: Locale = "he"): string {
  if (
    operation === "instagram_callback" ||
    operation === "permissions_field" ||
    operation === "pending_saved" ||
    operation === "authorization_confirmed" ||
    operation === "payload_transferred" ||
    operation === "instagram_renew" ||
    operation === "permissions_checked"
  ) {
    return translate(locale, `trace.op.${operation}`);
  }
  return operation;
}

export function traceResultLabel(result: string, locale: Locale = "he"): string {
  if (result === "success" || result === "error") return translate(locale, `trace.result.${result}`);
  return result;
}

export function requestTraceRefresh(panel: TracePanel): { panel: TracePanel; started: boolean } {
  if (panel.loading) return { panel, started: false };
  return { panel: { ...panel, loading: true, loadError: null }, started: true };
}

export function applyTraceRefresh(panel: TracePanel, rows: TraceRow[], at: Date): TracePanel {
  return {
    rows: [...rows].sort((left, right) => left.at.localeCompare(right.at)),
    loading: false,
    refreshedAt: at.toISOString(),
    loadError: null,
  };
}

export function failTraceRefresh(panel: TracePanel): TracePanel {
  return { ...panel, loading: false, loadError: TRACE_REFRESH_ERROR };
}

export function createTraceRefreshController(
  load: () => Promise<TraceRow[]>,
  now: () => Date = () => new Date(),
  onUpdate?: (panel: TracePanel) => void,
) {
  let panel = emptyTracePanel();
  const publish = () => {
    onUpdate?.(panel);
    return panel;
  };
  return {
    get panel() {
      return panel;
    },
    async refresh(): Promise<TracePanel> {
      const next = requestTraceRefresh(panel);
      if (!next.started) return panel;
      panel = next.panel;
      publish();
      try {
        panel = applyTraceRefresh(panel, await load(), now());
      } catch {
        panel = failTraceRefresh(panel);
      }
      return publish();
    },
  };
}
