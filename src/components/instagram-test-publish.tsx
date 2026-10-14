import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [snapshot, setSnapshot] = useState<TestPublishStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
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
      if (active) setError("בדיקת מוכנות נכשלה");
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
      setResult(answer.ok ? `פורסם! Instagram Media ID: ${answer.mediaId}` : `לא אושר: ${answer.code}`);
      await refresh();
    } catch {
      setError("תוצאת הבקשה אינה ידועה. אין לנסות שוב. בדקו את Instagram ואת רישום הניסיון.");
      try { await refresh(); } catch { /* Never retry a publish. */ }
    } finally {
      setBusy(false);
      setConfirmation("");
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">בדיקת פרסום באינסטגרם · KLYVONA</h2>
      <p className="mt-2 text-sm text-muted">
        בדיקה חד-פעמית לחשבון @klyvona_business בלבד. הפרסום גלוי לציבור.
        לאחר התחלת ניסיון לא תתאפשר שליחה חוזרת אוטומטית.
      </p>
      <img src="https://placehold.co/640x640/ffffff/40337a.jpg?text=KLYVONA+TEST" alt="KLYVONA TEST" className="mt-3 size-32 rounded-xl border border-line object-cover" />
      {loading ? <p className="mt-3 text-sm">בודק תנאים...</p> : null}
      {snapshot ? (
        <p className="mt-3 text-sm" role="status">
          {snapshot.ready ? "ארבעת תנאי ההפעלה תקינים" : `הפרסום חסום: ${snapshot.block ?? "unknown"}`}
        </p>
      ) : null}
      {attempt ? (
        <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
          <p>ניסיון קודם: <strong dir="ltr">{attempt.status}</strong></p>
          <p>תאריך: {attempt.created_at}</p>
          {attempt.media_id ? <p dir="ltr">Media ID: {attempt.media_id}</p> : null}
          {attempt.permalink ? (
            <a href={attempt.permalink} target="_blank" rel="noreferrer" className="underline">
              צפייה בפוסט באינסטגרם
            </a>
          ) : null}
          {attempt.error_code ? <p dir="ltr">Code: {attempt.error_code}</p> : null}
          <p className="mt-2 text-muted">הניסיון ננעל כדי למנוע פרסום כפול. אין לנסות שוב ללא בדיקה ידנית.</p>
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
              setError("בדיקת Meta נכשלה. לא נשלח פרסום נוסף.");
            } finally {
              setDiagnosing(false);
            }
          }}>{diagnosing ? "בודק ב-Meta..." : "בדיקת ניסיון קודם ב-Meta (קריאה בלבד)"}</Button>
          {diagnosis ? (
            <div className="mt-3 rounded-xl border border-line p-3 text-sm" role="status">
              <p>תוצאת בדיקה: <span dir="ltr">{diagnosis.check}</span></p>
              <p>מצב מיכל המדיה: <span dir="ltr">{diagnosis.containerStatus ?? "unknown"}</span></p>
              <p>HTTP מיכל: <span dir="ltr">{diagnosis.containerHttpStatus ?? "not checked"}</span></p>
              {diagnosis.containerErrorCode != null ? <p>Meta container error: {diagnosis.containerErrorCode} / {diagnosis.containerErrorSubcode ?? "-"}</p> : null}
              <p>הפוסט נמצא ברשימת המדיה: {diagnosis.recentPostMatched == null ? "לא ניתן לבדוק" : diagnosis.recentPostMatched ? "כן" : "לא"}</p>
              <p>HTTP רשימת מדיה: <span dir="ltr">{diagnosis.recentMediaHttpStatus ?? "not checked"}</span></p>
              {diagnosis.recentMediaErrorCode != null ? <p>Meta media error: {diagnosis.recentMediaErrorCode}</p> : null}
              {diagnosis.matchedMediaId ? <p dir="ltr">Media ID: {diagnosis.matchedMediaId}</p> : null}
              {diagnosis.matchedPermalink ? <a className="underline" href={diagnosis.matchedPermalink} target="_blank" rel="noreferrer">פתיחת הפוסט באינסטגרם</a> : null}
              <p className="mt-2 text-muted">קריאה בלבד: אין יצירת מדיה, אין פרסום, אין איפוס הניסיון.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {result ? <p role="status" className="mt-3 text-sm">{result}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => {
          setLoading(true);
          refresh().catch(() => setError("בדיקת מוכנות נכשלה")).finally(() => setLoading(false));
        }}>רענון סטטוס</Button>
        <Button disabled={!canPublish} onClick={() => setConfirmOpen(true)}>
          פרסום פוסט בדיקה אחד
        </Button>
      </div>
      {confirmOpen && canPublish ? (
        <div role="dialog" aria-modal="true" aria-label="אישור פרסום" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-5 shadow-xl">
            <h3 className="text-lg font-semibold">אישור פרסום ציבורי</h3>
            <p className="mt-2 text-sm">
              פרסום תמונת KLYVONA TEST עם כיתוב בעברית בחשבון @klyvona_business.
              זוהי פעולה אמיתית, פעם אחת בלבד, ללא ניסיונות חוזרים.
            </p>
            <p className="mt-3 font-mono text-sm" dir="ltr">{CONFIRM}</p>
            <input
              className="mt-2 w-full rounded-xl border border-line bg-surface p-3"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-label="קוד אישור"
              autoComplete="off"
              dir="ltr"
            />
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>ביטול</Button>
              <Button disabled={busy || confirmation !== CONFIRM} onClick={() => void publish()}>
                {busy ? "מפרסם..." : "אישור ושליחת פוסט אחד"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
