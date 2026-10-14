import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalLinks } from "@/components/legal-links";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/he";
import { useI18n } from "@/lib/i18n/context";
import { usePageTitle, localeFromMatches } from "@/lib/i18n/page-title";
import { translate } from "@/lib/i18n/translate";
import { translateKnown } from "@/lib/i18n/surface";
import { getOwnApproval } from "@/lib/approval.functions";
import { isApprovalStatus } from "@/lib/approval";
import { claimOAuthStart, oauthButtonBusy, type ConnectPlatform } from "@/lib/oauth/connect-buttons";
import {
  accountsFromBody,
  callConnect,
  canConnectInThisBrowser,
  connectNoticeClass,
  connectResultAccepted,
  connectedFromBody,
  instagramCardText,
  instagramPermissionText,
  instagramVerifyText,
  instagramConnectLists,
  readConnectReceipt,
  renewKept,
  type ConnectReceipt,
  type ListedAccount,
  type ListedConnected,
} from "@/lib/oauth/connect-session";

export const Route = createFileRoute("/connect")({
  head: ({ matches }) => ({ meta: [{ title: translate(localeFromMatches(matches), "meta.connectTitle") }] }),
  component: ConnectPage,
});

type Account = ListedAccount;
type Connected = ListedConnected;
type Tone = "error" | "ok" | "info";
type Notice = { key: MessageKey; tone: Tone } | { kind: "verify"; body: Record<string, unknown> };
type PermissionView =
  | { kind: "body"; body: Record<string, unknown>; checkedAt: string }
  | { kind: "fallback"; message: MessageKey; tone: Tone; checkedAt: string };

const ERROR_KEYS: Record<string, MessageKey> = {
  denied: "connect.cancelled",
  state: "connect.badState",
  csrf: "connect.badState",
  expired: "connect.expired",
  used: "connect.used",
  mismatch: "connect.badState",
  exchange: "connect.exchange",
};

function ConnectPage() {
  const { locale, t } = useI18n();
  usePageTitle(t("meta.connectTitle"));
  const [receipt, setReceipt] = useState<ConnectReceipt | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [connected, setConnected] = useState<Connected[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<ConnectPlatform | null>(null);
  const savingRef = useRef(false);
  const [pending, setPending] = useState<ConnectPlatform | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionView, setPermissionView] = useState<PermissionView | null>(null);
  const [approval, setApproval] = useState("pending_approval");

  function setMessage(key: MessageKey | "", tone: Tone = "error") {
    setNotice(key ? { key, tone } : null);
  }

  useEffect(() => {
    const stored = readConnectReceipt(sessionStorage.getItem("klyvona-onboarding-receipt"));
    setReceipt(stored);
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setMessage(ERROR_KEYS[code] ?? "connect.notFinished");
    if (new URLSearchParams(window.location.search).get("ready")) setMessage("connect.chooseListed", "info");
  }, []);

  useEffect(() => {
    if (!receipt?.connectSecret) return;
    let cancelled = false;
    getOwnApproval({ data: { reference: receipt.reference, connectSecret: receipt.connectSecret } })
      .then((result) => {
        if (!cancelled && result.ok && isApprovalStatus(result.approvalStatus)) setApproval(result.approvalStatus);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [receipt]);

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
        setMessage("connect.noServer");
        return;
      }
      if (result.status === 503) {
        setMessage("connect.pendingSetupFake");
        return;
      }
      if (!connectResultAccepted(result, "start") || typeof result.body.authorizeUrl !== "string") {
        setMessage("connect.cannotOpen");
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
        setMessage("connect.noServer");
        return false;
      }
      if (!connectResultAccepted(result, "accounts")) {
        if (!quiet) setMessage(result.status === 503 ? "connect.pendingSetup" : "connect.cannotLoad");
        return false;
      }
      applyLists(result.body);
      return true;
    } catch {
      setMessage("connect.noServer");
      return false;
    }
  }

  async function verifyInstagram() {
    setBusy(true);
    try {
      const result = await post("/api/oauth/instagram/verify");
      if (!result || result.networkError) {
        setMessage("connect.tempCheck", "info");
        return;
      }
      if (!connectResultAccepted(result, "verify")) {
        setMessage(result.status === 503 ? "connect.pendingSetup" : "connect.cannotVerify");
        return;
      }
      setNotice({ kind: "verify", body: result.body });
    } catch {
      setMessage("connect.tempCheck", "info");
    } finally {
      setBusy(false);
    }
  }

  async function checkPublishPermission() {
    setPermissionBusy(true);
    try {
      const result = await post("/api/oauth/instagram/permissions");
      const checkedAt = new Date().toISOString();
      if (!result || result.networkError) {
        setPermissionView({ kind: "fallback", message: "connect.tempCheck", tone: "info", checkedAt });
        return;
      }
      if (!connectResultAccepted(result, "permissions")) {
        setPermissionView({
          kind: "fallback",
          message: result.status === 503 ? "connect.pendingSetup" : "connect.cannotVerify",
          tone: "error",
          checkedAt,
        });
        return;
      }
      setPermissionView({
        kind: "body",
        body: result.body,
        checkedAt: typeof result.body.checkedAt === "string" ? result.body.checkedAt : checkedAt,
      });
    } catch {
      setPermissionView({ kind: "fallback", message: "connect.tempCheck", tone: "info", checkedAt: new Date().toISOString() });
    } finally {
      setPermissionBusy(false);
    }
  }

  async function choose(id: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const result = await post("/api/oauth/meta/select", { pendingId: id });
      if (!result || !connectResultAccepted(result, "select")) {
        setMessage("connect.notSaved");
        return;
      }
      setMessage("connect.savedToken", "ok");
      const refreshed = await load(true);
      if (!refreshed) setMessage("connect.savedListStale", "info");
    } catch {
      setMessage("connect.noServer");
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
      if (result && renewKept(result.body)) {
        const refreshed = await load(true);
        setMessage(refreshed ? "connect.renewKept" : "connect.renewKeptStale", "info");
        return;
      }
      if (!result || !action || !connectResultAccepted(result, action)) {
        setMessage("connect.actionFailed");
        return;
      }
      setMessage("connect.actionSaved", "ok");
      const refreshed = await load(true);
      if (!refreshed) setMessage("connect.actionSavedStale", "info");
    } catch {
      setMessage("connect.noServer");
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  }

  const shown = !notice ? null : "kind" in notice ? instagramVerifyText(notice.body, locale) : { message: t(notice.key), tone: notice.tone };
  const permission = !permissionView
    ? null
    : permissionView.kind === "body"
      ? { ...instagramPermissionText(permissionView.body, locale), checkedAt: permissionView.checkedAt }
      : {
          message: t(permissionView.message),
          identityLabel: t("oauth.identity.unconfirmed"),
          grantMessage: t("oauth.grant.permissions_unknown"),
          tone: permissionView.tone,
          checkedAt: permissionView.checkedAt,
        };

  const rawReadiness = permissionView?.kind === "body" ? permissionView.body.readiness : null;
  const readiness = rawReadiness && typeof rawReadiness === "object" && !Array.isArray(rawReadiness)
    ? rawReadiness as Record<string, unknown>
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="h-12 w-12 rounded-xl" />
          <div>
            <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
            <p className="text-sm text-muted">{t("connect.subtitle")}</p>
          </div>
        </div>
        <LanguageSwitcher />
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t("connect.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {t("connect.intro", { name: receipt?.businessName ?? t("connect.requestFallback") })}
      </p>
      <p className="mt-4 rounded-2xl bg-primary-soft p-4 text-sm leading-relaxed" role="status">
        {t(
          approval === "approved"
            ? "approval.approved"
            : approval === "rejected"
              ? "approval.rejected"
              : approval === "suspended"
                ? "approval.suspended"
                : "approval.pending_approval",
        )}
      </p>
      {shown ? (
        <p className={`mt-4 text-sm ${connectNoticeClass(shown.tone)}`} role={shown.tone === "error" ? "alert" : "status"}>
          {shown.message}
        </p>
      ) : null}
      {!receipt?.connectSecret ? (
        <p className="mt-6 text-sm">{t("connect.gate")}</p>
      ) : (
        <div className="mt-6 grid gap-3">
          <Button disabled={oauthButtonBusy(pending, "instagram")} aria-busy={oauthButtonBusy(pending, "instagram")} className="w-full min-w-0 whitespace-normal" onClick={() => start("instagram")}>
            {t("connect.login")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => load()}>
            {t("connect.showAccounts")}
          </Button>
          <Button variant="secondary" disabled={busy || connected.length === 0} onClick={() => verifyInstagram()}>
            {t("connect.verify")}
          </Button>
          <Button variant="secondary" disabled={permissionBusy || connected.length === 0} aria-busy={permissionBusy} onClick={() => checkPublishPermission()}>
            {permissionBusy ? t("connect.checkingPermissions") : t("connect.checkPermissions")}
          </Button>
          {permission ? (
            <article className="rounded-2xl bg-surface p-4 shadow-card" aria-live="polite">
              <p className={connectNoticeClass(permission.tone)}>{permission.message}</p>
              <p className="mt-2 text-sm">{t("connect.accountLabel", { value: permission.identityLabel })}</p>
              <p className="text-sm">{t("connect.savedGrant", { value: permission.grantMessage })}</p>
              <p className="text-sm">{t("connect.onlineCheck")}</p>
              <p className="text-sm">{t("connect.livePublish")}</p>
              {readiness && typeof readiness.ready === "boolean" ? (
                <div className="mt-3 rounded-xl border border-border p-3 text-sm">
                  <p className="font-semibold">{t(readiness.ready ? "connect.readinessReady" : "connect.readinessBlocked")}</p>
                  <ul className="mt-2 space-y-1">
                    {(["approval", "subscription", "instagram", "permission"] as const).map((gate) => (
                      <li key={gate}>
                        {t(`connect.readiness.${gate}`)}: {t(readiness[gate] === true ? "connect.readinessYes" : "connect.readinessNo")}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-muted">{t("connect.readinessDisclaimer")}</p>
                </div>
              ) : null}
              <p className="mt-1 text-sm text-muted">{t("connect.lastCheck", { when: formatWhen(permission.checkedAt, locale) })}</p>
              <p className="mt-2 text-sm text-muted">{t("connect.otherCustomers")}</p>
            </article>
          ) : null}
          {connected.map((item) => {
            const card = instagramCardText(item, locale);
            return (
              <article key={`${item.platform}:${item.externalAccountId || card.detail}`} className="rounded-2xl bg-surface p-4 shadow-card">
                <p className="font-semibold">{card.title}</p>
                <p className={card.tone === "ok" ? "text-sm text-ok" : card.tone === "warn" ? "text-sm text-muted" : "text-sm text-danger"}>{card.label}</p>
                <p className="mt-1 break-all text-sm text-muted" dir="ltr">
                  {card.detail}
                </p>
              </article>
            );
          })}
          {accounts.map((account) => (
            <article key={account.id} className="rounded-2xl bg-surface p-4 shadow-card">
              <p className="font-semibold" dir="ltr">
                {account.name}
              </p>
              <p className="text-sm text-muted">{account.platform}</p>
              <p className="mt-1 text-sm">{account.eligible ? t("connect.eligible") : translateKnown(locale, account.reason ?? "")}</p>
              {account.eligible ? (
                <Button className="mt-3 w-full min-w-0 whitespace-normal" disabled={busy} onClick={() => choose(account.id)}>
                  {account.authorizationRefresh ? t("connect.confirmAuth") : t("connect.saveAccount")}
                </Button>
              ) : null}
            </article>
          ))}
          <div className="mt-2 grid gap-2">
            <Button className="w-full min-w-0 whitespace-normal" variant="secondary" disabled={busy} onClick={() => act("/api/oauth/instagram/renew", "instagram")}>
              {t("connect.renew")}
            </Button>
            {confirmOff ? (
              <div className="grid gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void act("/api/oauth/meta/disconnect", "instagram")}>
                  {t("connect.confirmDisconnect")}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirmOff(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOff(true)}>
                {t("connect.disconnect")}
              </Button>
            )}
          </div>
        </div>
      )}
      <LegalLinks className="mt-8" />
    </main>
  );
}
