import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import {
  approvalTransition,
  automationDecision,
  metaPermissionView,
  permissionConfirmedForToken,
  publishingWouldStart,
  subscriptionAllowsService,
} from "./approval.ts";

function read(relativeToLib: string): string {
  return readFileSync(new URL(relativeToLib, import.meta.url), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("approval transitions", () => {
  it("allows only documented changes and treats a repeat as a no-op", () => {
    assert.equal(approvalTransition("pending_approval", "approved"), "ok");
    assert.equal(approvalTransition("pending_approval", "rejected"), "ok");
    assert.equal(approvalTransition("approved", "suspended"), "ok");
    assert.equal(approvalTransition("rejected", "approved"), "ok");
    assert.equal(approvalTransition("suspended", "approved"), "ok");
    assert.equal(approvalTransition("pending_approval", "suspended"), "invalid");
    assert.equal(approvalTransition("approved", "rejected"), "invalid");
    assert.equal(approvalTransition("rejected", "suspended"), "invalid");
    assert.equal(approvalTransition("approved", "approved"), "noop");
    assert.equal(approvalTransition("pending_approval", "pending_approval"), "noop");
  });
});

describe("automation gates", () => {
  const ready = {
    approvalStatus: "approved",
    subscriptionStatus: "trial",
    instagramConnected: true,
    permissionConfirmedForToken: true,
  };

  it("requires approval, a service plan, Instagram, and a live permission together", () => {
    assert.deepEqual(automationDecision(ready), { ok: true });
    assert.deepEqual(automationDecision({ ...ready, subscriptionStatus: "active" }), { ok: true });
    assert.deepEqual(automationDecision({ ...ready, approvalStatus: "pending_approval" }), { ok: false, block: "approval" });
    assert.deepEqual(automationDecision({ ...ready, approvalStatus: "rejected" }), { ok: false, block: "approval" });
    assert.deepEqual(automationDecision({ ...ready, approvalStatus: "suspended" }), { ok: false, block: "approval" });
    const blockedPermission = automationDecision({ ...ready, permissionConfirmedForToken: false });
    assert.equal(blockedPermission.ok, false);
    if (!blockedPermission.ok) assert.equal(blockedPermission.block, "permission");
    const blockedInstagram = automationDecision({ ...ready, instagramConnected: false });
    assert.equal(blockedInstagram.ok, false);
    if (!blockedInstagram.ok) assert.equal(blockedInstagram.block, "instagram");
    for (const status of ["awaiting_billing", "past_due", "cancelled"]) {
      const blockedPlan = automationDecision({ ...ready, subscriptionStatus: status });
      assert.equal(blockedPlan.ok, false);
      if (!blockedPlan.ok) assert.equal(blockedPlan.block, "subscription");
      assert.equal(subscriptionAllowsService(status), false);
    }
    assert.equal(subscriptionAllowsService("trial"), true);
    assert.equal(subscriptionAllowsService("active"), true);
  });

  it("does not treat a permission for a different token as confirmed", () => {
    assert.equal(permissionConfirmedForToken({ permission: "confirmed", storedHash: "aa", currentHash: "aa" }), true);
    assert.equal(permissionConfirmedForToken({ permission: "confirmed", storedHash: "aa", currentHash: "bb" }), false);
    assert.equal(permissionConfirmedForToken({ permission: "unknown", storedHash: "aa", currentHash: "aa" }), false);
    assert.equal(permissionConfirmedForToken({ permission: "confirmed", storedHash: null, currentHash: "aa" }), false);
    assert.equal(
      metaPermissionView({ permission: "confirmed", storedHash: "aa", currentHash: "bb", connected: true }),
      "stale",
    );
    assert.equal(metaPermissionView({ permission: "missing", storedHash: null, currentHash: null, connected: false }), "missing");
    assert.equal(publishingWouldStart("scheduled"), true);
    assert.equal(publishingWouldStart("publishing"), true);
    assert.equal(publishingWouldStart("paused"), false);
    assert.equal(publishingWouldStart("waiting_connection"), false);
  });
});

describe("approval contract", () => {
  it("migration keeps existing clients pending and does not delete or approve anyone", () => {
    const sql = read("../../migrations/0004_client_approval.sql");
    assert.match(sql, /set approval_status = 'pending_approval'/);
    assert.match(sql, /client_approval_events/);
    assert.match(sql, /previous_status <> new_status/);
    assert.match(sql, /admin_user_id/);
    assert.match(sql, /publishing_status = 'paused'/);
    assert.match(sql, /status = 'blocked', error_message = 'approval_revoked'/);
    assert.doesNotMatch(sql, /delete from/i);
    assert.doesNotMatch(sql, /token_ciphertext/);
    assert.doesNotMatch(sql, /KV-G6G87U/);
    assert.doesNotMatch(sql, /set approval_status = 'approved'/);
  });

  it("registers pending and keeps onboarding.completed from meaning automation", () => {
    const onboarding = read("./onboarding.functions.ts");
    const make = read("./integrations/make.server.ts");
    assert.match(onboarding, /'pending_approval'/);
    assert.match(onboarding, /event: "onboarding.completed"/);
    assert.match(onboarding, /approval_status: "pending_approval"/);
    assert.match(onboarding, /automation_allowed: false/);
    assert.match(onboarding, /plan_code: inserted.plan_code/);
    assert.doesNotMatch(onboarding, /facebook|tiktok/);
    assert.match(make, /event: "onboarding.completed"/);
    assert.match(make, /approval_status: "pending_approval"/);
    assert.match(make, /automation_allowed: false/);
    assert.match(make, /"client.approved"/);
    assert.match(make, /"client.rejected"/);
    assert.match(make, /"client.suspended"/);
    assert.equal(make.includes("ui_locale:"), false);
  });

  it("rejects a client-supplied admin flag and does not repeat a no-op", () => {
    const fn = read("./approval.functions.ts");
    const server = read("./approval.server.ts");
    const admin = read("./admin.functions.ts");
    assert.match(fn, /authMiddleware/);
    assert.match(fn, /resolveAdminAccess/);
    assert.match(fn, /"isAdmin" in body/);
    assert.match(fn, /secretMatches|clientForConnectSecret/);
    const noop = server.indexOf('transition === "noop"');
    const audit = server.indexOf("insert into client_approval_events");
    const notify = server.indexOf("notifyApproval");
    assert.ok(noop > 0 && noop < audit && audit < notify);
    assert.match(server, /approval_status = \$\{current\.approval_status\}/);
    assert.match(server, /status = 'blocked', error_message = 'approval_revoked'/);
    assert.match(server, /publishing_status = 'paused'/);
    assert.match(admin, /publishingActivationAllowed/);
    assert.match(admin, /activatePublishing/);
    assert.match(admin, /stopAutomation/);
    assert.match(admin, /resolveAdminAccess/);
    assert.match(admin, /authMiddleware/);
  });

  it("stores a permission verdict outside the read-only Meta check", () => {
    const checker = read("./oauth/instagram.server.ts");
    const route = read("../routes/api/oauth/instagram/permissions.ts");
    assert.equal(checker.includes("rememberCheckedPermission"), false);
    assert.equal(checker.includes("publish_permission"), false);
    assert.match(checker, /persist: false/);
    assert.match(route, /checkInstagramPublishPermission/);
    assert.match(route, /rememberCheckedPermission/);
  });

  it("shows read-only readiness gates without creating media or exposing tokens", () => {
    const route = read("../routes/api/oauth/instagram/permissions.ts");
    const server = read("./approval.server.ts");
    const page = read("../routes/connect.tsx");
    assert.match(route, /automationReadinessForConnect/);
    assert.match(route, /rememberCheckedPermission/);
    assert.match(server, /decisionForRow\(row\)/);
    assert.match(server, /permissionConfirmedForToken/);
    assert.match(page, /connect\.readinessBlocked/);
    assert.match(page, /connect\.readinessDisclaimer/);
    assert.doesNotMatch(route, /media_publish|\/media|activatePublishing/);
    assert.doesNotMatch(server.slice(server.indexOf("export async function automationReadinessForConnect"), server.indexOf("export async function automationAllowed")), /insert into|update |delete from|userToken/);
  });

  it("creates a publishing job only for an entitled photo request", () => {
    const root = new URL("../", import.meta.url);
    const files = walk(root.pathname).filter((file) => !file.endsWith(".test.ts"));
    const inserts = files
      .filter((file) => readFileSync(file, "utf8").includes("insert into publishing_jobs"))
      .map((file) => basename(file))
      .sort();
    assert.deepEqual(inserts, ["quota-period.ts"]);
    const scheduled = files.filter((file) => /publishing_status = 'scheduled'|publishing_status = "scheduled"/.test(readFileSync(file, "utf8")));
    assert.deepEqual(scheduled, []);
    const creator = read("./integrations/make-photo-job.server.ts");
    assert.match(creator, /reservePhotoSlot/);
    assert.doesNotMatch(creator, /notifyMake|media_publish|posts_used\s*=/);
    assert.match(creator, /content\.generation_requested/);
    const quota = read("./integrations/quota-period.ts");
    assert.match(quota, /checkQuota/);
    assert.doesNotMatch(quota, /notifyMake|media_publish|posts_used\s*=/);
  });

  it("shows the required sentences and keeps approval controls off customer pages", () => {
    assert.match(read("./i18n/he.ts"), /ההרשמה הושלמה\. החשבון שלך ממתין לאישור מנהל מערכת KLYVONA\./);
    assert.match(read("./i18n/ru.ts"), /Регистрация завершена\. Ваш аккаунт ожидает одобрения администратора KLYVONA\./);
    assert.match(read("./i18n/en.ts"), /Registration completed\. Your account is awaiting approval by the KLYVONA administrator\./);
    const wizard = read("../components/onboarding-wizard.tsx");
    const connect = read("../routes/connect.tsx");
    assert.equal(wizard.includes("setClientApproval"), false);
    assert.equal(connect.includes("setClientApproval"), false);
    assert.match(wizard, /getOwnApproval/);
    assert.match(connect, /getOwnApproval/);
  });
});
