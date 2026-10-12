import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { claimOAuthStart, oauthButtonBusy, type ConnectPlatform } from "@/lib/oauth/connect-buttons";
import {
  accountsFromBody,
  callConnect,
  canConnectInThisBrowser,
  CONNECT_GATE_TEXT,
  connectNoticeClass,
  connectResultAccepted,
  connectedFromBody,
  instagramCardText,
  instagramConnectLists,
  readConnectReceipt,
  type ConnectReceipt,
  type ListedAccount,
  type ListedConnected,
} from "@/lib/oauth/connect-session";

export const Route = createFileRoute("/connect")({
  head: () => ({ meta: [{ title: "חיבור Instagram · KLYVONA Connect" }] }),
  component: ConnectPage,
});

type Account = ListedAccount;
type Connected = ListedConnected;

const ERRORS: Record<string, string> = {
  denied: "החיבור בוטל.",
  state: "בקשת החיבור לא אומתה. התחילו שוב.",
  csrf: "בקשת החיבור לא אומתה. התחילו שוב.",
  expired: "תוקף בקשת החיבור פג. התחילו שוב.",
  used: "בקשת החיבור כבר נוצלה. התחילו שוב.",
  mismatch: "בקשת החיבור לא אומתה. התחילו שוב.",
  exchange: "Instagram לא השלימה את החיבור. לא נשמר אסימון.",
};

type Notice = { text: string; tone: "error" | "ok" | "info" };

function ConnectPage() {
  const [receipt, setReceipt] = useState<ConnectReceipt | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [connected, setConnected] = useState<Connected[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<ConnectPlatform | null>(null);
  const savingRef = useRef(false);
  const [pending, setPending] = useState<ConnectPlatform | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  function setMessage(text: string, tone: Notice["tone"] = "error") {
    setNotice(text ? { text, tone } : null);
  }

  useEffect(() => {
    const stored = readConnectReceipt(sessionStorage.getItem("klyvona-onboarding-receipt"));
    setReceipt(stored);
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setMessage(ERRORS[code] ?? "החיבור לא הושלם.");
    if (new URLSearchParams(window.location.search).get("ready")) {
      setMessage("בחרו רק חשבון Instagram שמופיע ברשימה.", "info");
    }
  }, []);

  useEffect(() => {
    if (!receipt?.connectSecret) return;
    void load();
    // `load` reads the current receipt. Depending on the function would reload on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

  async function post(path: string, extra: Record<string, string> = {}) {
    if (!receipt || !canConnectInThisBrowser(JSON.stringify(receipt))) return null;
    return callConnect(fetch, path, receipt, extra);
  }

  function applyLists(body: Record<string, unknown>) {
    const lists = instagramConnectLists(accountsFromBody(body), connectedFromBody(body));
    setAccounts(lists.accounts);
    setConnected(lists.connected);
  }

  async function start(platform: ConnectPlatform) {
    if (!claimOAuthStart(pendingRef.current, platform)) return;
    pendingRef.current = platform;
    setPending(platform);
    setMessage("");
    try {
      const result = await post(`/api/oauth/${platform}/start`);
      if (!result) return;
      if (result.networkError) {
        setMessage("אין חיבור לשרת. נסו שוב.");
        return;
      }
      if (result.status === 503) {
        setMessage("החיבור עדיין ממתין להגדרה בשרת. לא נוצר חיבור מדומה.");
        return;
      }
      if (!connectResultAccepted(result, "start") || typeof result.body.authorizeUrl !== "string") {
        setMessage("לא ניתן לפתוח את Instagram. בדקו שהפנייה נשמרה בדפדפן הזה.");
        return;
      }
      window.location.assign(result.body.authorizeUrl);
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }

  async function load(quiet = false) {
    try {
      const result = await post("/api/oauth/meta/accounts");
      if (!result) return false;
      if (result.networkError) {
        setMessage("אין חיבור לשרת. נסו שוב.");
        return false;
      }
      if (!connectResultAccepted(result, "accounts")) {
        if (!quiet) setMessage(result.status === 503 ? "החיבור עדיין ממתין להגדרה בשרת." : "לא ניתן לטעון חשבונות.");
        return false;
      }
      applyLists(result.body);
      return true;
    } catch {
      setMessage("אין חיבור לשרת. נסו שוב.");
      return false;
    }
  }

  async function choose(id: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const result = await post("/api/oauth/meta/select", { pendingId: id });
      if (!result || !connectResultAccepted(result, "select")) {
        setMessage("החשבון לא נשמר. אפשר לבחור רק חשבון שאושר עבור הפנייה הזו.");
        return;
      }
      setMessage("החשבון נשמר. האסימון נשאר בשרת.", "ok");
      const refreshed = await load(true);
      if (!refreshed) setMessage("החשבון נשמר, אבל הרשימה לא התעדכנה. לחצו על הצגת חשבונות.", "info");
    } catch {
      setMessage("אין חיבור לשרת. נסו שוב.");
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  }

  async function act(path: string, platform: string) {
    setBusy(true);
    try {
      const action = path.endsWith("/renew") ? "renew" : path.endsWith("/disconnect") ? "disconnect" : null;
      const result = await post(path, { platform });
      if (!result || !action || !connectResultAccepted(result, action)) {
        setMessage("הפעולה לא הושלמה. אם ההרשאה פגה, חברו מחדש.");
        return;
      }
      setMessage("הפעולה נשמרה.", "ok");
      const refreshed = await load(true);
      if (!refreshed) setMessage("הפעולה נשמרה, אבל הרשימה לא התעדכנה. לחצו על הצגת חשבונות.", "info");
    } catch {
      setMessage("אין חיבור לשרת. נסו שוב.");
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-8">
      <div className="flex items-center gap-3">
        <BrandMark className="h-12 w-12 rounded-xl" />
        <div>
          <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
          <p className="text-sm text-muted">חיבור חשבון Instagram מקצועי</p>
        </div>
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">חשבונות שבשליטתכם</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {receipt?.businessName ?? "הפנייה"} · לא מבקשים סיסמה. חשבון Instagram פרטי לא מופיע כזכאי לפרסום.
      </p>
      {notice ? (
        <p className={`mt-4 text-sm ${connectNoticeClass(notice.tone)}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
      {!receipt?.connectSecret ? (
        <p className="mt-6 text-sm">{CONNECT_GATE_TEXT}</p>
      ) : (
        <div className="mt-6 grid gap-3">
          <Button
            disabled={oauthButtonBusy(pending, "instagram")}
            aria-busy={oauthButtonBusy(pending, "instagram")}
            onClick={() => start("instagram")}
          >
            התחברות עם Instagram
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => load()}>
            הצגת חשבונות שאושרו
          </Button>
          {connected.map((item) => {
            const card = instagramCardText(item);
            return (
              <article key={`${item.platform}:${item.externalAccountId || card.detail}`} className="rounded-2xl bg-surface p-4 shadow-card">
                <p className="font-semibold">{card.title}</p>
                <p className={item.trusted === false ? "text-sm text-danger" : "text-sm text-ok"}>
                  {item.trusted === false ? "נדרש חיבור מחדש" : "מחובר"}
                </p>
                <p className="mt-1 break-all text-sm text-muted" dir="ltr">
                  {card.detail}
                </p>
              </article>
            );
          })}
          {accounts.map((account) => (
            <article key={account.id} className="rounded-2xl bg-surface p-4 shadow-card">
              <p className="font-semibold">{account.name}</p>
              <p className="text-sm text-muted">{account.platform}</p>
              <p className="mt-1 text-sm">{account.eligible ? "זכאי לפרסום" : account.reason}</p>
              {account.eligible ? (
                <Button className="mt-3" disabled={busy} onClick={() => choose(account.id)}>
                  שמירת החשבון
                </Button>
              ) : null}
            </article>
          ))}
          <div className="mt-2 grid gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => act("/api/oauth/instagram/renew", "instagram")}>
              חידוש הרשאת Instagram
            </Button>
            {confirmOff ? (
              <div className="grid gap-2">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void act("/api/oauth/meta/disconnect", "instagram");
                  }}
                >
                  אישור ניתוק Instagram
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirmOff(false)}>
                  ביטול
                </Button>
              </div>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOff(true)}>
                ניתוק Instagram
              </Button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
