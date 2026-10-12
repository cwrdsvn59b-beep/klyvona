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
};

export type ListedConnected = {
  platform: string;
  externalAccountId: string;
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

/** Instagram only. One saved account id once, and a pending row is hidden once that id is saved. */
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
    if (account.externalAccountId && saved.has(account.externalAccountId)) continue;
    const key = account.externalAccountId || account.id;
    if (pendingKeys.has(key)) continue;
    pendingKeys.add(key);
    pending.push(account);
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
      },
    ];
  });
}

export function connectedFromBody(body: Record<string, unknown>): ListedConnected[] {
  if (!Array.isArray(body.connected)) return [];
  return body.connected.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ListedConnected>;
    if (typeof row.platform !== "string" || typeof row.externalAccountId !== "string") return [];
    return [{ platform: row.platform, externalAccountId: row.externalAccountId }];
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

export type ConnectAction = "start" | "accounts" | "select" | "renew" | "disconnect";
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
  return body.ok === true;
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
