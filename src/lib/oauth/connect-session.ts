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

export const CONNECT_GATE_TEXT = "המסך הזה זמין אחרי השלמת ההצטרפות באותו דפדפן.";

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

export function instagramCardText(item: {
  name?: string;
  externalAccountId: string;
  trusted?: boolean;
  status?: string;
}): {
  title: string;
  detail: string;
  tone: "ok" | "warn" | "danger";
  label: string;
} {
  if (item.status === "reconnect") {
    return { title: "Instagram", detail: item.externalAccountId, tone: "danger", label: "נדרשת הרשאה מחדש" };
  }
  if (item.status === "unconfirmed" || (!item.status && !item.externalAccountId)) {
    return { title: "Instagram", detail: "הזהות לא אומתה. החשבון לא נותק.", tone: "warn", label: "הזהות לא אומתה" };
  }
  if (item.status === "connected" || item.status === "missing_username" || item.externalAccountId) {
    return {
      title: item.name || "Instagram",
      detail: item.name ? `@${item.name}` : item.externalAccountId,
      tone: "warn",
      label: "הטוקן נשמר",
    };
  }
  return { title: "Instagram", detail: "הזהות לא אומתה. החשבון לא נותק.", tone: "warn", label: "הזהות לא אומתה" };
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

const VERIFY_TEXT: Record<string, { message: string; tone: ConnectNoticeTone }> = {
  identity_confirmed: { message: "חשבון Instagram אומת.", tone: "ok" },
  identity_unconfirmed: { message: "לא ניתן לאמת את הזהות.", tone: "error" },
  identity_mismatch: { message: "מזהה Instagram אינו תואם למזהה שנשמר.", tone: "error" },
  reconnect: { message: "נדרשת הרשאה מחדש.", tone: "error" },
  temporary_error: { message: "שגיאה זמנית בבדיקה.", tone: "info" },
};

/** The check result is separate from the saved-token card. Publishing stays unverified. */
export function instagramVerifyText(body: Record<string, unknown>): { message: string; tone: ConnectNoticeTone } {
  const found = VERIFY_TEXT[typeof body.check === "string" ? body.check : ""] ?? VERIFY_TEXT.identity_unconfirmed;
  const username = typeof body.username === "string" ? body.username.trim().replace(/^@/, "") : "";
  const named = username && body.check === "identity_confirmed" ? `${found.message} @${username}` : found.message;
  if (body.check === "identity_confirmed") return { message: `${named} הפרסום עדיין לא אושר.`, tone: "ok" };
  return { message: named, tone: found.tone };
}

const PERMISSION_TEXT: Record<string, { message: string; tone: ConnectNoticeTone }> = {
  permission_confirmed: { message: "הרשאת הפרסום אושרה. לא פורסם תוכן.", tone: "ok" },
  permission_missing: { message: "הרשאת הפרסום לא ניתנה.", tone: "error" },
  verification_unavailable: { message: "לא ניתן לאשר את הרשאת הפרסום בבדיקה בטוחה.", tone: "info" },
  app_review_required: { message: "נדרשת גישת Meta מתקדמת לפני פרסום לחשבונות של לקוחות.", tone: "info" },
  temporary_error: { message: "שגיאה זמנית בבדיקה.", tone: "info" },
};

const GRANT_TEXT: Record<string, string> = {
  permissions_confirmed: "בעת החיבור Meta דיווחה על הרשאת פרסום. זו אינה בדיקה מקוונת עדכנית.",
  permissions_missing: "בעת החיבור תשובת Meta לא כללה הרשאת פרסום.",
  permissions_unknown: "רשימת ההרשאות ממועד החיבור לא שמורה. לא בוצעה בדיקה מקוונת חדשה.",
};

export function instagramPermissionText(body: Record<string, unknown>): {
  message: string;
  identityLabel: string;
  grantMessage: string;
  tone: ConnectNoticeTone;
} {
  const grantMessage = GRANT_TEXT[typeof body.grantAtConnection === "string" ? body.grantAtConnection : ""] ?? GRANT_TEXT.permissions_unknown;
  const remembered = body.grantSource === "preserved_on_refresh" ? `${grantMessage} הנתון נשמר בחידוש האסימון ולא אושר מחדש מול Meta.` : grantMessage;
  if (body.identity === "reconnect") return { message: "נדרשת הרשאה מחדש.", identityLabel: "נדרשת הרשאה מחדש", grantMessage: remembered, tone: "error" };
  if (body.identity === "identity_mismatch") {
    return { message: "מזהה Instagram אינו תואם למזהה שנשמר.", identityLabel: "המזהה אינו תואם", grantMessage: remembered, tone: "error" };
  }
  const found = PERMISSION_TEXT[typeof body.permission === "string" ? body.permission : ""] ?? PERMISSION_TEXT.verification_unavailable;
  const identityLabel = body.identityConfirmed === true ? "החשבון אומת" : "החשבון לא אומת";
  return { message: found.message, identityLabel, grantMessage: remembered, tone: found.tone };
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
