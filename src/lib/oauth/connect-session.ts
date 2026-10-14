import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

export type ConnectReceipt = {
  reference: string;
  connectSecret: string;
  businessName?: string;
};

export type ListedAccount = {
  id: string;
  platform: string;
  name: string;
  eligible: boolean;
  reason: string | null;
  externalAccountId?: string;
  authorizationRefresh?: boolean;
};

export type ListedConnected = {
  platform: string;
  externalAccountId: string;
  name?: string;
  trusted?: boolean;
  status?: "connected" | "missing_username" | "unconfirmed" | "reconnect";
};

export const CONNECT_GATE_TEXT = translate("he", "connect.gate");

export type ConnectCall = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  networkError: boolean;
  invalidBody: boolean;
};

/** A browser can open connect only after onboarding saved a receipt in that same browser. */
export function readConnectReceipt(raw: string | null): ConnectReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConnectReceipt> | null;
    if (!value || typeof value.reference !== "string" || typeof value.connectSecret !== "string") return null;
    if (!value.reference.trim() || !value.connectSecret.trim()) return null;
    return {
      reference: value.reference,
      connectSecret: value.connectSecret,
      businessName: typeof value.businessName === "string" ? value.businessName : undefined,
    };
  } catch {
    return null;
  }
}

export function canConnectInThisBrowser(raw: string | null): boolean {
  return readConnectReceipt(raw) !== null;
}

/** Instagram only. One account id once. The same saved id remains visible when it carries a new authorization to confirm. */
export function instagramConnectLists(
  accounts: readonly ListedAccount[],
  connected: readonly ListedConnected[],
): { accounts: ListedAccount[]; connected: ListedConnected[] } {
  const saved = new Map<string, ListedConnected>();
  for (const item of connected) {
    if (item.platform !== "instagram" || !item.externalAccountId) continue;
    if (!saved.has(item.externalAccountId)) saved.set(item.externalAccountId, item);
  }
  const pendingKeys = new Set<string>();
  const pending: ListedAccount[] = [];
  for (const account of accounts) {
    if (account.platform !== "instagram") continue;
    const key = account.externalAccountId || account.id;
    if (pendingKeys.has(key)) continue;
    pendingKeys.add(key);
    pending.push({
      ...account,
      authorizationRefresh: account.authorizationRefresh === true || Boolean(account.externalAccountId && saved.has(account.externalAccountId)),
    });
  }
  return { accounts: pending, connected: [...saved.values()] };
}

export function accountsFromBody(body: Record<string, unknown>): ListedAccount[] {
  if (!Array.isArray(body.accounts)) return [];
  return body.accounts.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ListedAccount>;
    if (typeof row.id !== "string" || typeof row.platform !== "string" || typeof row.name !== "string") return [];
    return [
      {
        id: row.id,
        platform: row.platform,
        name: row.name,
        eligible: row.eligible === true,
        reason: typeof row.reason === "string" ? row.reason : null,
        externalAccountId: typeof row.externalAccountId === "string" ? row.externalAccountId : undefined,
        authorizationRefresh: row.authorizationRefresh === true,
      },
    ];
  });
}

export function instagramCardText(
  item: {
    name?: string;
    externalAccountId: string;
    trusted?: boolean;
    status?: string;
  },
  locale: Locale = "he",
): {
  title: string;
  detail: string;
  tone: "ok" | "warn" | "danger";
  label: string;
} {
  if (item.status === "reconnect") {
    return { title: "Instagram", detail: item.externalAccountId, tone: "danger", label: translate(locale, "oauth.identity.reconnect") };
  }
  if (item.status === "unconfirmed" || (!item.status && !item.externalAccountId)) {
    return {
      title: "Instagram",
      detail: translate(locale, "oauth.card.unconfirmedDetail"),
      tone: "warn",
      label: translate(locale, "oauth.card.unconfirmed"),
    };
  }
  if (item.status === "connected" || item.status === "missing_username" || item.externalAccountId) {
    return {
      title: item.name || "Instagram",
      detail: item.name ? `@${item.name}` : item.externalAccountId,
      tone: "warn",
      label: translate(locale, "oauth.card.tokenSaved"),
    };
  }
  return {
    title: "Instagram",
    detail: translate(locale, "oauth.card.unconfirmedDetail"),
    tone: "warn",
    label: translate(locale, "oauth.card.unconfirmed"),
  };
}

export function connectedFromBody(body: Record<string, unknown>): ListedConnected[] {
  if (!Array.isArray(body.connected)) return [];
  return body.connected.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ListedConnected>;
    if (typeof row.platform !== "string" || typeof row.externalAccountId !== "string") return [];
    const account: ListedConnected = { platform: row.platform, externalAccountId: row.externalAccountId };
    if (typeof row.name === "string" && row.name.trim()) account.name = row.name.trim();
    if (typeof row.trusted === "boolean") account.trusted = row.trusted;
    if (row.status === "connected" || row.status === "missing_username" || row.status === "unconfirmed" || row.status === "reconnect") {
      account.status = row.status;
    }
    return [account];
  });
}

export async function readConnectBody(
  response: { text(): Promise<string> },
): Promise<{ body: Record<string, unknown>; invalidBody: boolean }> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return { body: {}, invalidBody: true };
  }
  if (!text.trim()) return { body: {}, invalidBody: true };
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { body: {}, invalidBody: true };
    return { body: value as Record<string, unknown>, invalidBody: false };
  } catch {
    return { body: {}, invalidBody: true };
  }
}

export const RENEW_KEPT_MESSAGE = translate("he", "connect.renewKept");

export function renewKept(body: Record<string, unknown>): boolean {
  return body.error === "token_replaced" && body.kept === true;
}

export type ConnectAction = "start" | "accounts" | "select" | "renew" | "disconnect" | "verify" | "permissions";
export type ConnectNoticeTone = "error" | "ok" | "info";

export function connectNoticeClass(tone: ConnectNoticeTone): string {
  if (tone === "error") return "text-danger";
  if (tone === "ok") return "text-ok";
  return "text-muted";
}

function failedBody(body: Record<string, unknown>): boolean {
  return body.ok === false || (typeof body.error === "string" && body.error.length > 0);
}

/** Success depends on the route contract, not only on HTTP 200 and valid JSON. */
export function connectResultAccepted(result: ConnectCall, action: ConnectAction): boolean {
  if (!result.ok || result.networkError || result.invalidBody || result.status < 200 || result.status >= 300) return false;
  const body = result.body;
  if (failedBody(body)) return false;
  if (action === "start") {
    return body.oauthActivated === true && typeof body.authorizeUrl === "string" && body.authorizeUrl.startsWith("https://");
  }
  if (action === "accounts") return Array.isArray(body.accounts) && Array.isArray(body.connected);
  if (action === "select" || action === "disconnect") return body.ok === true && typeof body.platform === "string" && body.platform.length > 0;
  if (action === "verify") {
    return body.publishingAllowed === false && body.publishing === "not_verified" && typeof body.check === "string";
  }
  if (action === "permissions") {
    return body.publishingTested === false && body.contentCreated === false && body.persist === false && typeof body.permission === "string" && typeof body.checkedAt === "string";
  }
  return body.ok === true;
}

/** The check result is separate from the saved-token card. Publishing stays unverified. */
export function instagramVerifyText(
  body: Record<string, unknown>,
  locale: Locale = "he",
): { message: string; tone: ConnectNoticeTone } {
  const check = typeof body.check === "string" ? body.check : "";
  const key =
    check === "identity_confirmed" ||
    check === "identity_unconfirmed" ||
    check === "identity_mismatch" ||
    check === "reconnect" ||
    check === "temporary_error"
      ? check
      : "identity_unconfirmed";
  const tone: ConnectNoticeTone = key === "identity_confirmed" ? "ok" : key === "temporary_error" ? "info" : "error";
  const username = typeof body.username === "string" ? body.username.trim().replace(/^@/, "") : "";
  const base = translate(locale, `oauth.verify.${key}`);
  const named =
    username && key === "identity_confirmed" ? translate(locale, "oauth.verify.named", { message: base, username }) : base;
  if (key === "identity_confirmed") return { message: translate(locale, "oauth.verify.stillUnverified", { message: named }), tone: "ok" };
  return { message: named, tone };
}

export function instagramPermissionText(
  body: Record<string, unknown>,
  locale: Locale = "he",
): {
  message: string;
  identityLabel: string;
  grantMessage: string;
  tone: ConnectNoticeTone;
} {
  const grantKey =
    body.grantAtConnection === "permissions_confirmed" ||
    body.grantAtConnection === "permissions_missing" ||
    body.grantAtConnection === "permissions_unknown"
      ? body.grantAtConnection
      : "permissions_unknown";
  const grantMessage = translate(locale, `oauth.grant.${grantKey}`);
  const remembered =
    body.grantSource === "preserved_on_refresh"
      ? translate(locale, "oauth.grant.remembered", { grant: grantMessage })
      : grantMessage;
  if (body.identity === "reconnect") {
    return {
      message: translate(locale, "oauth.verify.reconnect"),
      identityLabel: translate(locale, "oauth.identity.reconnect"),
      grantMessage: remembered,
      tone: "error",
    };
  }
  if (body.identity === "identity_mismatch") {
    return {
      message: translate(locale, "oauth.verify.identity_mismatch"),
      identityLabel: translate(locale, "oauth.identity.mismatch"),
      grantMessage: remembered,
      tone: "error",
    };
  }
  const permission =
    body.permission === "permission_confirmed" ||
    body.permission === "permission_missing" ||
    body.permission === "permission_confirmed_at_connection" ||
    body.permission === "permission_missing_at_connection" ||
    body.permission === "verification_unavailable" ||
    body.permission === "app_review_required" ||
    body.permission === "temporary_error"
      ? body.permission
      : "verification_unavailable";
  const tone: ConnectNoticeTone = permission === "permission_confirmed" ? "ok" : permission === "permission_missing" || permission === "permission_missing_at_connection" ? "error" : "info";
  const identityLabel =
    body.identityConfirmed === true ? translate(locale, "oauth.identity.confirmed") : translate(locale, "oauth.identity.unconfirmed");
  return { message: translate(locale, `oauth.permission.${permission}`), identityLabel, grantMessage: remembered, tone };
}

export async function callConnect(
  fetchImpl: typeof fetch,
  path: string,
  receipt: ConnectReceipt,
  extra: Record<string, string> = {},
): Promise<ConnectCall> {
  try {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: receipt.reference, connectSecret: receipt.connectSecret, ...extra }),
    });
    const parsed = await readConnectBody(response);
    return {
      ok: response.ok && !parsed.invalidBody,
      status: response.status,
      body: parsed.body,
      networkError: false,
      invalidBody: parsed.invalidBody,
    };
  } catch {
    return { ok: false, status: 0, body: {}, networkError: true, invalidBody: false };
  }
}
