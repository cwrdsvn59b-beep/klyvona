import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";

/**
 * READ ONLY: inspect client references in the active database.
 * This endpoint deliberately has no delete capability. Production cleanup
 * requires a separately reviewed implementation and explicit confirmation.
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
