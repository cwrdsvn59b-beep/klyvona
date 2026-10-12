export const TRACE_MEMORY_WARNING =
  "היומן נשמר בזיכרון השרת בלבד. אירועים עשויים להיעלם לאחר הפעלה מחדש או להופיע באופן חלקי כאשר הבקשות מטופלות בשרתים שונים. היעדר אירוע אינו מוכיח שהפעולה לא בוצעה.";

export const TRACE_REFRESH_ERROR = "לא הצלחנו לרענן את יומן האבחון. הרשימה הקודמת נשארה.";

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

const OPERATION_LABELS: Record<string, string> = {
  instagram_callback: "סיום כניסת Instagram",
  permissions_field: "שדה permissions בתשובת Meta",
  pending_saved: "שמירה זמנית",
  authorization_confirmed: "אישור עדכון ההרשאה",
  payload_transferred: "העברה לחיבור השמור",
  instagram_renew: "חידוש אסימון",
  permissions_checked: "בדיקת הרשאות",
};

const RESULT_LABELS: Record<string, string> = {
  success: "הצליח",
  error: "נכשל",
};

export function emptyTracePanel(): TracePanel {
  return { rows: [], loading: false, refreshedAt: null, loadError: null };
}

export function traceOperationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation;
}

export function traceResultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result;
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
