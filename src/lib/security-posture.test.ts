import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAllowlistedAdmin, parseAdminAllowlist } from "./admin-allowlist.ts";
import { PLANS, VIDEO_NOTE } from "./labels.ts";

describe("administrator allowlist", () => {
  it("denies everyone when the allowlist is missing or empty", () => {
    for (const raw of [undefined, null, "", "   ", ",,,"]) {
      const allowlist = parseAdminAllowlist(raw);
      assert.equal(allowlist.size, 0);
      assert.equal(
        isAllowlistedAdmin({ email: "owner@example.com", emailVerified: true, allowlist }),
        false,
      );
    }
  });

  it("denies an unverified or unlisted account", () => {
    const allowlist = parseAdminAllowlist("Owner@Example.com");
    assert.equal(
      isAllowlistedAdmin({ email: "owner@example.com", emailVerified: false, allowlist }),
      false,
    );
    assert.equal(
      isAllowlistedAdmin({ email: "other@example.com", emailVerified: true, allowlist }),
      false,
    );
    assert.equal(isAllowlistedAdmin({ email: null, emailVerified: true, allowlist }), false);
  });

  it("allows only a verified email that is on the server list", () => {
    const allowlist = parseAdminAllowlist(" owner@example.com , finance@example.com ");
    assert.equal(
      isAllowlistedAdmin({ email: "Owner@Example.com", emailVerified: true, allowlist }),
      true,
    );
    assert.equal(allowlist.has("not-an-email"), false);
  });
});

describe("admin and onboarding boundaries", () => {
  it("does not offer public admin claiming", () => {
    const admin = readFileSync(new URL("./admin.functions.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../routes/admin/route.tsx", import.meta.url), "utf8");
    assert.equal(admin.includes("claimAdminSeat"), false);
    assert.equal(admin.includes("where not exists (select 1 from staff_members)"), false);
    assert.equal(route.includes("claimAdminSeat"), false);
    assert.equal(route.includes("פתיחת מושב"), false);
    assert.match(admin, /resolveAdminAccess/);
    assert.match(admin, /\.middleware\(\[authMiddleware\]\)/);
  });

  it("does not let public onboarding write staff rows", () => {
    const onboarding = readFileSync(new URL("./onboarding.functions.ts", import.meta.url), "utf8");
    assert.equal(onboarding.includes("staff_members"), false);
    assert.equal(onboarding.includes("KLYVONA_ADMIN_EMAILS"), false);
    assert.equal(onboarding.includes("authMiddleware"), false);
  });
});

describe("onboarding prices", () => {
  it("keeps the trial and monthly plans", () => {
    const trial = PLANS.find((plan) => plan.code === "trial");
    const monthly = PLANS.find((plan) => plan.code === "monthly");
    assert.ok(trial);
    assert.ok(monthly);
    assert.equal(trial.price, 0);
    assert.equal(trial.posts, 22);
    assert.equal(trial.days, 22);
    assert.equal(monthly.price, 600);
    assert.equal(monthly.posts, 44);
    assert.equal(monthly.days, 22);
    assert.match(monthly.detail, /600 ₪/);
    assert.match(VIDEO_NOTE, /וידאו אינה כלולה/);
  });
});
