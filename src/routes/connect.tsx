import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { claimOAuthStart, oauthButtonBusy, type ConnectPlatform } from "@/lib/oauth/connect-buttons";

export const Route = createFileRoute("/connect")({
  head: () => ({ meta: [{ title: "חיבור Meta · KLYVONA Connect" }] }),
  component: ConnectPage,
});

type Receipt = { reference?: string; connectSecret?: string; businessName?: string };
type Account = { id: string; platform: string; name: string; eligible: boolean; reason: string | null };

const ERRORS: Record<string, string> = {
  denied: "החיבור בוטל.",
  state: "בקשת החיבור לא אומתה. התחילו שוב.",
  csrf: "בקשת החיבור לא אומתה. התחילו שוב.",
  expired: "תוקף בקשת החיבור פג. התחילו שוב.",
  used: "בקשת החיבור כבר נוצלה. התחילו שוב.",
  mismatch: "בקשת החיבור לא אומתה. התחילו שוב.",
  exchange: "Meta לא השלימה את החיבור. לא נשמר אסימון.",
};

function ConnectPage() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<ConnectPlatform | null>(null);
  const [pending, setPending] = useState<ConnectPlatform | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("klyvona-onboarding-receipt");
    if (!raw) return;
    try {
      setReceipt(JSON.parse(raw) as Receipt);
    } catch {
      setReceipt(null);
    }
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setMessage(ERRORS[code] ?? "החיבור לא הושלם.");
    if (new URLSearchParams(window.location.search).get("ready")) {
      setMessage("בחרו רק עמוד או חשבון Instagram שמופיעים ברשימה.");
    }
  }, []);

  async function post(path: string, extra: Record<string, string> = {}) {
    if (!receipt?.reference || !receipt.connectSecret) return null;
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: receipt.reference, connectSecret: receipt.connectSecret, ...extra }),
    });
    const body = (await response.json()) as { authorizeUrl?: string; accounts?: Account[]; message?: string; error?: string };
    return { response, body };
  }

  async function start(platform: ConnectPlatform) {
    if (!claimOAuthStart(pendingRef.current, platform)) return;
    pendingRef.current = platform;
    setPending(platform);
    setMessage("");
    try {
      const result = await post(`/api/oauth/${platform}/start`);
      if (!result) return;
      if (result.response.status === 503) {
        setMessage("החיבור עדיין ממתין להגדרה בשרת. לא נוצר חיבור מדומה.");
        return;
      }
      if (!result.response.ok || !result.body.authorizeUrl) {
        setMessage("לא ניתן לפתוח את Meta. בדקו שהפנייה נשמרה בדפדפן הזה.");
        return;
      }
      window.location.assign(result.body.authorizeUrl);
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }

  async function load() {
    const result = await post("/api/oauth/meta/accounts");
    if (!result || !result.response.ok) {
      setMessage(result?.response.status === 503 ? "החיבור עדיין ממתין להגדרה בשרת." : "לא ניתן לטעון חשבונות.");
      return;
    }
    setAccounts(result.body.accounts ?? []);
  }

  async function choose(id: string) {
    setBusy(true);
    const result = await post("/api/oauth/meta/select", { pendingId: id });
    setBusy(false);
    if (!result?.response.ok) {
      setMessage("החשבון לא נשמר. אפשר לבחור רק חשבון שאושר עבור הפנייה הזו.");
      return;
    }
    setMessage("החשבון נשמר. האסימון נשאר בשרת.");
    setAccounts((current) => current.filter((account) => account.id !== id));
  }

  async function act(path: string, platform: string) {
    setBusy(true);
    const result = await post(path, { platform });
    setBusy(false);
    setMessage(result?.response.ok ? "הפעולה נשמרה." : "הפעולה לא הושלמה. אם ההרשאה פגה, חברו מחדש.");
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-8">
      <div className="flex items-center gap-3">
        <BrandMark className="h-12 w-12 rounded-xl" />
        <div>
          <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
          <p className="text-sm text-muted">חיבור עמוד Facebook או חשבון Instagram מקצועי</p>
        </div>
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">חשבונות שבשליטתכם</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {receipt?.businessName ?? "הפנייה"} · לא מבקשים סיסמה. חשבון Instagram פרטי לא מופיע כזכאי לפרסום.
      </p>
      {message ? <p className="mt-4 text-sm text-danger">{message}</p> : null}
      {!receipt?.connectSecret ? (
        <p className="mt-6 text-sm">המסך הזה זמין אחרי השלמת ההצטרפות באותו דפדפן.</p>
      ) : (
        <div className="mt-6 grid gap-3">
          <Button
            disabled={oauthButtonBusy(pending, "facebook")}
            aria-busy={oauthButtonBusy(pending, "facebook")}
            onClick={() => start("facebook")}
          >
            התחברות עם Facebook
          </Button>
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
            <Button variant="secondary" disabled={busy} onClick={() => act("/api/oauth/meta/renew", "facebook")}>
              חידוש הרשאת Facebook
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => act("/api/oauth/meta/renew", "instagram")}>
              חידוש הרשאת Instagram
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => act("/api/oauth/meta/disconnect", "facebook")}>
              ניתוק Facebook
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => act("/api/oauth/meta/disconnect", "instagram")}>
              ניתוק Instagram
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
