# KLYVONA Connect — audit of the latest published version

The latest production bundle in this project does not contain the security fixes. There is no published commit, and no live host could be confirmed. Nothing was changed or republished.

Audit date: 11 October 2026.

## Version

| Identifier | Result |
|---|---|
| Git commit | None. `/workspace` is not a git repository. |
| `GROK_PROJECT_ID` | Unset. This environment is not a published app. |
| Vercel deployment id | Not present under `.vercel`. |
| Public URL | Not found. A search for KLYVONA Connect on `grok.me` did not return this app. The connected GitHub account had no public repositories at the time of the audit. |
| Latest production build | `.vercel/output`, written `2026-10-11 12:01:17 UTC` |
| Bundle fingerprint | `claimAdminSeat` server id `e6c53792f558342b822623039a590adccde55ebbf826689999cd01606fe64062` in `.vercel/output/functions/__server.func/_ssr/admin.functions-C9OlX-oo.mjs` |

The allowlist changes in `src/lib/admin.functions.ts` and `src/lib/admin-grant.server.ts` are timestamped `2026-10-11 14:31 UTC`. They are newer than that build and are not inside it. They are not a published version.

## 1. Public admin claim — FAIL

The built admin module still exports `claimAdminSeat`. After a session exists, the first caller inserts their own user id:

```
var claimAdminSeat = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(..., async ({ context }) => {
  const sql = await getSql();
  if ((await sql`
      insert into staff_members (user_id, role)
      select ${context.userId}, 'admin'
      where not exists (select 1 from staff_members)
```

Source: `.vercel/output/functions/__server.func/_ssr/admin.functions-C9OlX-oo.mjs`, lines 115–122.

An unknown Google user who can sign in, and who arrives while `staff_members` is empty, becomes administrator. The built screen still calls that function (`route-D2lWGktf.mjs` imports `claimAdminSeat`). There is no allowlist and no `KLYVONA_ADMIN_EMAILS` check in this bundle.

## 2. Persistent database — UNVERIFIED

No published environment could be read. `DATABASE_URL` is unset in this workspace, and no deployment config file contains a database connection.

The bundle that would be deployed does not keep customer rows without that variable. `.vercel/output/functions/__server.func/_ssr/db-BweTSjmw.mjs` sets `dbSource` to `pglite` when `DATABASE_URL` is empty, and the comment in that file says the embedded database resets when the server process restarts. Neon is used only when the variable is present. Whether the remote Vercel project injects it is unverified, so survival of customer data on the live site cannot be confirmed.

## 3. Unauthorized admin APIs — FAIL

Signed-out calls are rejected only while auth is considered on. The built gate is `.vercel/output/functions/__server.func/_ssr/verify.server-CCMhQqNo.mjs`:

- Auth enabled and no session: `requireUserId` throws `UnauthorizedError`. `getDashboard`, `getClientProfile`, and `updateClientOps` also call `requireAdmin`, which only checks `staff_members`.
- Auth disabled (`VITE_AUTH_ENABLED=false`) and `DATABASE_URL` set: it throws and does not use a shared user.
- Auth disabled and `DATABASE_URL` missing: it returns the shared id `dev-user` and does not reject the request. That identity can then call `claimAdminSeat` if no staff row exists.

Missing `GROK_AUTH_CLIENT_ID` does not by itself turn auth off. The bundle falls back to a baked preview client. The explicit off switch is `VITE_AUTH_ENABLED=false`, and in that state with no database the admin API does not deny the caller.

## Result

The published bundle still lets the first signed-in Google user become admin, and it does not prove that customer data survives a restart. Do not treat the later local source as the live version until a new build is published and its deployment id is checked.
