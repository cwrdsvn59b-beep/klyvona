/**
 * Server-side administrator allowlist.
 * The list itself is read only from the process environment, never from the
 * client and never from this file. An empty list denies every account.
 */

export function parseAdminAllowlist(raw: string | undefined | null): ReadonlySet<string> {
  if (!raw || !raw.trim()) return new Set();
  const emails = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (!email || email.length > 120 || !email.includes("@") || email.includes(" ")) continue;
    emails.add(email);
  }
  return emails;
}

export function isAllowlistedAdmin(input: {
  email: string | null | undefined;
  emailVerified: boolean;
  allowlist: ReadonlySet<string>;
}): boolean {
  if (input.allowlist.size === 0) return false;
  if (input.emailVerified !== true) return false;
  const email = input.email?.trim().toLowerCase();
  if (!email) return false;
  return input.allowlist.has(email);
}
