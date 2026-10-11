import { getSql } from "@/lib/db";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { isAllowlistedAdmin, parseAdminAllowlist } from "@/lib/admin-allowlist";
import {
  adminIdentityDenied,
  productionAdminAuthProblem,
} from "../../scripts/admin-auth-mode.mjs";

export type AdminAccess = {
  isAdmin: boolean;
  configured: boolean;
};

function assertProductionAdminAuth(): void {
  const problem = productionAdminAuthProblem();
  if (!problem) return;
  console.error(`[admin] ${problem}`);
  throw new UnauthorizedError();
}

/**
 * Grant is decided only from the verified auth user row and KLYVONA_ADMIN_EMAILS.
 * A signed-in user cannot insert themselves. The shared dev user is never
 * provisioned. An existing staff_members row is not enough.
 */
export async function resolveAdminAccess(userId: string): Promise<AdminAccess> {
  assertProductionAdminAuth();
  if (adminIdentityDenied(userId)) throw new UnauthorizedError();

  const allowlist = parseAdminAllowlist(process.env.KLYVONA_ADMIN_EMAILS);
  if (allowlist.size === 0) return { isAdmin: false, configured: false };

  const sql = await getSql();
  const rows = await sql<{ email: string; email_verified: boolean }>`
    select "email" as email, "emailVerified" as email_verified
    from "user"
    where "id" = ${userId}
    limit 1
  `;
  const row = rows[0];
  const allowed = isAllowlistedAdmin({
    email: row?.email,
    emailVerified: row?.email_verified === true,
    allowlist,
  });
  if (!allowed || !row) return { isAdmin: false, configured: true };

  await sql`
    insert into staff_members (user_id, role)
    values (${userId}, 'admin')
    on conflict (user_id) do nothing
  `;
  return { isAdmin: true, configured: true };
}
