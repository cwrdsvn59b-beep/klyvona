import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db";
import { permissionConfirmedForToken, automationDecision } from "@/lib/approval";
import {
  anotherExplicitPostAllowed,
  instagramPermalink,
  isOpenManualStatus,
  manualPhase,
  normalizeClientId,
  normalizeIdempotencyKey,
  normalizeManualCaption,
  normalizePublicJpegUrl,
  MANUAL_CONFIRMATION,
  type ManualPhase,
} from "@/lib/instagram-manual-publish";

export class ManualGraphPostError extends Error {
  readonly safeCode: string;
  readonly definitive: boolean;
  constructor(safeCode: string, definitive: boolean) {
    super(safeCode);
    this.name = "ManualGraphPostError";
    this.safeCode = safeCode;
    this.definitive = definitive;
  }
}

export class ManualContainerError extends Error {
  readonly safeCode: string;
  constructor(safeCode: string) {
    super(safeCode);
    this.name = "ManualContainerError";
    this.safeCode = safeCode;
  }
}

class ManualStateError extends Error {
  constructor() {
    super("instagram_manual_state_not_persisted");
    this.name = "ManualStateError";
  }
}

export type ManualPublishView = {
  ok: boolean;
  code: string;
  phase: ManualPhase;
  mediaId: string | null;
  permalink: string | null;
  status: string | null;
  anotherPostAllowed: boolean;
};

type ManualPost = (path: string, fields: Record<string, string>) => Promise<{ id?: unknown }>;

type StoredAttempt = {
  id: string;
  status: string;
  media_id: string | null;
  permalink: string | null;
  error_code: string | null;
  instagram_account_id: string;
};

export type ManualAccountRow = {
  approval_status: string | null;
  subscription_status: string | null;
  status: string | null;
  external_account_id: string | null;
  token_ciphertext: string | null;
  publish_permission: string | null;
  publish_permission_token_hash: string | null;
};

export function manualTokenHash(ciphertext: string): string {
  return createHash("sha256").update(ciphertext).digest("hex");
}

export function manualAccountGate(row: ManualAccountRow | null): { ready: boolean; block: string | null } {
  if (!row?.external_account_id || !/^\d{5,32}$/.test(row.external_account_id)) {
    return { ready: false, block: "instagram" };
  }
  const decision = automationDecision({
    approvalStatus: row.approval_status,
    subscriptionStatus: row.subscription_status,
    instagramConnected: row.status === "connected" && Boolean(row.token_ciphertext),
    permissionConfirmedForToken: permissionConfirmedForToken({
      permission: row.publish_permission,
      storedHash: row.publish_permission_token_hash,
      currentHash: row.token_ciphertext ? manualTokenHash(row.token_ciphertext) : null,
    }),
  });
  return { ready: decision.ok, block: decision.ok ? null : decision.block };
}

function denied(code: string, phase: ManualPhase = "error", anotherPostAllowed = false): ManualPublishView {
  return { ok: false, code, phase, mediaId: null, permalink: null, status: null, anotherPostAllowed };
}

function viewFrom(row: StoredAttempt, code: string, ok = false): ManualPublishView {
  return {
    ok,
    code,
    phase: manualPhase(row.status),
    mediaId: row.media_id,
    permalink: instagramPermalink(row.permalink),
    status: row.status,
    anotherPostAllowed: anotherExplicitPostAllowed(row.status) && !isOpenManualStatus(row.status),
  };
}

function storedView(row: StoredAttempt): ManualPublishView {
  if (row.status === "published") return viewFrom(row, "published", true);
  if (row.status === "uncertain") return viewFrom(row, row.error_code ?? "uncertain_check_instagram_no_retry");
  if (row.status === "failed_before_request") return viewFrom(row, row.error_code ?? "no_publish_request_sent_locked");
  return viewFrom(row, "in_progress");
}

async function readByKey(sql: Sql, key: string): Promise<StoredAttempt | null> {
  const rows = await sql<StoredAttempt>`
    select id, status, media_id, permalink, error_code, instagram_account_id
    from instagram_manual_publications
    where idempotency_key = ${key}
    limit 1
  `;
  return rows[0] ?? null;
}

function uniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint|23505/i.test(message);
}

async function move(sql: Sql, id: string, clientId: string, from: string, next: string, fields?: {
  containerId?: string;
  mediaId?: string;
  permalink?: string;
  errorCode?: string | null;
}): Promise<void> {
  const updated = await sql<{ id: string }>`
    update instagram_manual_publications
    set status = ${next},
        container_id = coalesce(${fields?.containerId ?? null}, container_id),
        media_id = coalesce(${fields?.mediaId ?? null}, media_id),
        permalink = coalesce(${fields?.permalink ?? null}, permalink),
        error_code = ${fields?.errorCode ?? null},
        updated_at = now()
    where id = ${id} and client_id = ${clientId} and status = ${from}
    returning id
  `;
  if (updated.length !== 1 || updated[0]?.id !== id) throw new ManualStateError();
}

/**
 * One explicit photo publication. `media_publish` runs only after
 * `publish_requested` is stored. Replaying the same key, or any new key while
 * an uncertain attempt is open, does not call `media_publish` again.
 */
export async function executeManualPublication(input: {
  sql: Sql;
  adminUserId: string;
  clientId: string;
  confirmation: string;
  idempotencyKey: string;
  imageUrl: string;
  caption: string;
  externalAccountId: string;
  token: string;
  tokenCiphertext: string;
  imageAvailable: (url: string) => Promise<boolean>;
  post: ManualPost;
  waitUntilFinished: (containerId: string, token: string) => Promise<void>;
  readPermalink?: (mediaId: string, token: string) => Promise<unknown>;
}): Promise<ManualPublishView> {
  const clientId = normalizeClientId(input.clientId);
  const key = normalizeIdempotencyKey(input.idempotencyKey);
  const imageUrl = normalizePublicJpegUrl(input.imageUrl);
  const caption = normalizeManualCaption(input.caption);
  if (input.confirmation !== MANUAL_CONFIRMATION || !clientId || !key || !imageUrl || !caption) {
    return denied("confirmation_required", "preparation", true);
  }
  if (!/^\d{5,32}$/.test(input.externalAccountId) || !input.token || !input.tokenCiphertext) {
    return denied("not_ready");
  }
  const existing = await readByKey(input.sql, key);
  if (existing) return storedView(existing);

  let imageOk = false;
  try {
    imageOk = await input.imageAvailable(imageUrl);
  } catch {
    imageOk = false;
  }
  if (!imageOk) return denied("image_unavailable", "error", true);

  const tokenHash = manualTokenHash(input.tokenCiphertext);
  const attemptId = randomUUID();
  let reservedId: string | null = null;
  try {
    const reserved = await input.sql<{ id: string }>`
      insert into instagram_manual_publications (
        id, idempotency_key, client_id, admin_user_id, instagram_account_id,
        token_hash, image_url, caption, status
      )
      select ${attemptId}, ${key}, c.id, ${input.adminUserId}, sa.external_account_id,
        ${tokenHash}, ${imageUrl}, ${caption}, 'reserved'
      from clients c
      join client_subscriptions s on s.client_id = c.id and s.status in ('trial', 'active')
      join social_accounts sa on sa.client_id = c.id and sa.platform = 'instagram'
      where c.id = ${clientId}
        and c.approval_status = 'approved'
        and sa.status = 'connected'
        and sa.external_account_id = ${input.externalAccountId}
        and sa.token_ciphertext = ${input.tokenCiphertext}
        and sa.publish_permission = 'confirmed'
        and sa.publish_permission_token_hash = ${tokenHash}
      on conflict (idempotency_key) do nothing
      returning id
    `;
    reservedId = reserved[0]?.id ?? null;
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const replay = await readByKey(input.sql, key);
    if (replay) return storedView(replay);
    return denied("open_attempt_blocks_new_post");
  }
  if (!reservedId) {
    const replay = await readByKey(input.sql, key);
    if (replay) return storedView(replay);
    const open = await input.sql<{ id: string }>`
      select m.id
      from instagram_manual_publications m
      join social_accounts sa
        on sa.platform = 'instagram'
       and sa.external_account_id = m.instagram_account_id
      where sa.client_id = ${clientId}
        and m.status in ('reserved', 'container_requested', 'container_created', 'publish_requested', 'uncertain')
      limit 1
    `;
    return denied(open[0] ? "open_attempt_blocks_new_post" : "not_ready");
  }

  let stage = "reserved";
  let from = "reserved";
  let containerPostStarted = false;
  let publishPostStarted = false;
  let containerId = "";
  let publishedMediaId = "";
  const advance = async (next: string, fields?: {
    containerId?: string;
    mediaId?: string;
    permalink?: string;
    errorCode?: string | null;
  }) => {
    await move(input.sql, reservedId, clientId, from, next, fields);
    from = next;
    stage = next;
  };
  try {
    await advance("container_requested");
    containerPostStarted = true;
    const container = await input.post(`${input.externalAccountId}/media`, {
      image_url: imageUrl,
      caption,
      access_token: input.token,
    });
    if (!container || typeof container.id !== "string" || !/^\d{5,32}$/.test(container.id)) {
      throw new ManualGraphPostError("meta_post_invalid_id", false);
    }
    containerId = container.id;
    await advance("container_created", { containerId });
    await input.waitUntilFinished(containerId, input.token);
    await advance("publish_requested");
    publishPostStarted = true;
    const published = await input.post(`${input.externalAccountId}/media_publish`, {
      creation_id: containerId,
      access_token: input.token,
    });
    if (!published || typeof published.id !== "string" || !/^\d{5,32}$/.test(published.id)) {
      throw new ManualGraphPostError("meta_publish_invalid_id", false);
    }
    publishedMediaId = published.id;
    stage = "publish_confirmed";
    await advance("published", { containerId, mediaId: publishedMediaId, errorCode: null });
    let permalink: string | null = null;
    if (input.readPermalink) {
      try {
        permalink = instagramPermalink(await input.readPermalink(publishedMediaId, input.token));
        if (permalink) {
          await advance("published", { containerId, mediaId: publishedMediaId, permalink, errorCode: null });
        }
      } catch {
        permalink = null;
      }
    }
    return {
      ok: true,
      code: "published",
      phase: "success",
      mediaId: publishedMediaId,
      permalink,
      status: "published",
      anotherPostAllowed: true,
    };
  } catch (error) {
    const containerUnknown = containerPostStarted
      && stage === "container_requested"
      && error instanceof ManualGraphPostError
      && !error.definitive;
    const definitelyNoPublish = !publishPostStarted && !containerUnknown;
    const safeCode = (error instanceof ManualGraphPostError
      ? error.safeCode
      : error instanceof ManualContainerError
        ? error.safeCode
        : error instanceof ManualStateError
          ? "instagram_manual_state_not_persisted"
          : publishPostStarted && stage === "publish_confirmed"
            ? "database_persist_failed_after_meta_success"
            : publishPostStarted
              ? "publish_result_unknown"
              : containerUnknown
                ? "container_result_unknown"
                : "internal_error_before_publish").slice(0, 120);
    try {
      await advance(definitelyNoPublish ? "failed_before_request" : "uncertain", {
        containerId: containerId || undefined,
        mediaId: publishedMediaId || undefined,
        errorCode: safeCode,
      });
    } catch {
      // The open-account lock remains when the row cannot be closed.
    }
    const locked: StoredAttempt = {
      id: reservedId,
      status: definitelyNoPublish ? "failed_before_request" : "uncertain",
      media_id: publishedMediaId || null,
      permalink: null,
      error_code: safeCode,
      instagram_account_id: input.externalAccountId,
    };
    if (publishPostStarted && stage === "publish_confirmed") {
      return viewFrom(locked, "published_but_database_confirmation_failed_no_retry");
    }
    if (definitelyNoPublish) return viewFrom({ ...locked, status: "failed_before_request" }, safeCode);
    return viewFrom(locked, publishPostStarted ? "uncertain_check_instagram_no_retry" : safeCode);
  }
}
