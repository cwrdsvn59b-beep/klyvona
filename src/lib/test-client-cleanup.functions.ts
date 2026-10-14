import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";

/**
 * Admin-only inspection and explicitly confirmed deletion of a fixed set of
 * test clients. Never accepts arbitrary customer references for deletion.
 */
const CHILD_TABLES = [
  "business_profiles",
  "client_subscriptions",
  "social_accounts",
  "publishing_jobs",
  "onboarding_events",
  "webhook_deliveries",
  "client_approval_events",
  "oauth_states",
  "oauth_pending_accounts",
] as const;

type Match = {
  id: string;
  reference: string;
  businessName: string;
  approvalStatus: string;
};

export type CleanupPreview = {
  matches: Match[];
  missing: string[];
  counts: Array<{ table: string; count: number }>;
  safeToReview: boolean;
  readOnly: true;
};

export const inspectTestClients = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object" || !("references" in input)) {
      throw new Error("Invalid inspection request");
    }
    const references = (input as { references: unknown }).references;
    if (!Array.isArray(references) || references.length < 1 || references.length > 30 ||
        !references.every((item) => typeof item === "string" && /^KV-[A-Z0-9]{6}$/.test(item))) {
      throw new Error("Select 1–30 valid client references");
    }
    const unique = [...new Set(references as string[])];
    if (unique.length !== references.length) throw new Error("Duplicate references");
    return { references: unique };
  })
  .handler(async ({ context, data }): Promise<CleanupPreview> => {
    const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
    const access = await resolveAdminAccess(context.userId);
    if (!access.isAdmin) throw new Error("Administrator permission required");

    const sql = await getSql();
    const rows = await sql.query<{
      id: string;
      reference_code: string;
      business_name: string | null;
      approval_status: string;
    }>(
      `select c.id, c.reference_code, b.business_name, c.approval_status
       from clients c
       left join business_profiles b on b.client_id = c.id
       where c.reference_code = any($1::text[])
       order by c.reference_code`,
      [data.references],
    );
    const found = new Set(rows.map((row) => row.reference_code));
    const missing = data.references.filter((reference) => !found.has(reference));
    const ids = rows.map((row) => row.id);

    const available = await sql.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'client_id'
         and table_name = any($1::text[])`,
      [CHILD_TABLES],
    );
    const tableNames = new Set(available.map((row) => row.table_name));
    const counts: CleanupPreview["counts"] = [];
    for (const table of CHILD_TABLES) {
      if (!tableNames.has(table)) continue;
      // table is a compile-time constant, never derived from request input.
      const result = await sql.query<{ count: number }>(
        `select count(*)::int as count from "${table}" where client_id = any($1::text[])`,
        [ids],
      );
      counts.push({ table, count: Number(result[0]?.count ?? 0) });
    }

    return {
      matches: rows.map((row) => ({
        id: row.id,
        reference: row.reference_code,
        businessName: row.business_name ?? "",
        approvalStatus: row.approval_status,
      })),
      missing,
      counts,
      safeToReview: missing.length === 0 && rows.length === data.references.length,
      readOnly: true,
    };
  });

/** Explicit allowlist: this maintenance operation cannot delete future real clients. */
const CONFIRMED_TEST_REFERENCES = new Set([
  "KV-X4WKZC", "KV-L6XE9Y", "KV-NDYMH6", "KV-J32PC5",
  "KV-5NL7MT", "KV-625UT7", "KV-H6LNAK", "KV-FKH955",
  "KV-ASGQ4M", "KV-G6G87U", "KV-P8C9G8", "KV-V9C6NT",
]);

export const deleteConfirmedTestClients = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid delete request");
    const body = input as { references?: unknown; ids?: unknown; confirmation?: unknown };
    if (!Array.isArray(body.references) || !Array.isArray(body.ids) ||
        body.references.length === 0 || body.references.length > 12 ||
        body.ids.length !== body.references.length ||
        !body.references.every((ref) => typeof ref === "string" && CONFIRMED_TEST_REFERENCES.has(ref)) ||
        !body.ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) ||
        new Set(body.references).size !== body.references.length ||
        new Set(body.ids).size !== body.ids.length ||
        body.confirmation !== `DELETE ${body.references.length}`) {
      throw new Error("Test client selection or confirmation is invalid");
    }
    return { references: body.references as string[], ids: body.ids as string[] };
  })
  .handler(async ({ context, data }) => {
    const { resolveAdminAccess } = await import("@/lib/admin-grant.server");
    const access = await resolveAdminAccess(context.userId);
    if (!access.isAdmin) throw new Error("Administrator permission required");

    const sql = await getSql();

    // Require ON DELETE CASCADE for every direct FK to clients. Unknown schema
    // changes fail closed instead of risking incomplete manual cleanup.
    const fk = await sql.query<{ table_name: string; delete_action: string }>(
      `select c.conrelid::regclass::text as table_name, c.confdeltype as delete_action
       from pg_constraint c
       where c.contype = 'f' and c.confrelid = 'clients'::regclass`,
    );
    if (fk.length === 0 || fk.some((row) => row.delete_action !== "c")) {
      throw new Error("Deletion blocked: client foreign-key cascade rules require review");
    }

    // A single PostgreSQL statement is atomic even on the pooled connection.
    // Both UUIDs and reference codes must match exactly, and all requested
    // clients must still exist. No partial delete if a record is missing.
    const deleted = await sql.query<{ reference_code: string }>(
      `with matched as (
         select id, reference_code from clients
         where reference_code = any($1::text[]) and id = any($2::text[])
       ), eligible as (
         select id from matched
         where (select count(*) from matched) = $3::int
       )
       delete from clients c where c.id in (select id from eligible)
       returning c.reference_code`,
      [data.references, data.ids, data.references.length],
    );
    if (deleted.length !== data.references.length ||
        new Set(deleted.map((row) => row.reference_code)).size !== data.references.length) {
      throw new Error("Deletion was not completed for all selected clients");
    }
    return { deleted: deleted.map((row) => row.reference_code) };
  });
