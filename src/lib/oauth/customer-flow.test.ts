import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUSTOMER_CONNECT_PLATFORMS, customerOAuthProvider } from "./customer-flow.ts";
import { connectNoticeClass } from "./connect-session.ts";
import { PLANS, VIDEO_NOTE } from "../labels.ts";

describe("customer social flow", () => {
  it("lets a customer start only Instagram", () => {
    assert.equal(customerOAuthProvider("instagram"), "instagram");
    assert.equal(customerOAuthProvider("facebook"), "disabled");
    assert.equal(customerOAuthProvider("tiktok"), "disabled");
    assert.deepEqual(CUSTOMER_CONNECT_PLATFORMS, ["instagram"]);
  });

  it("does not wire Facebook into the public start or callback", () => {
    const start = readFileSync(new URL("../../routes/api/oauth/$provider/start.ts", import.meta.url), "utf8");
    const callback = readFileSync(new URL("../../routes/api/oauth/$provider/callback.ts", import.meta.url), "utf8");
    const onboarding = readFileSync(new URL("../onboarding.functions.ts", import.meta.url), "utf8");
    assert.doesNotMatch(start, /startMetaOAuth/);
    assert.doesNotMatch(callback, /finishMetaOAuth/);
    assert.doesNotMatch(onboarding, /facebook|tiktok/);
    assert.match(onboarding, /CUSTOMER_CONNECT_PLATFORMS/);
  });

  it("does not show a saved account as an error", () => {
    assert.equal(connectNoticeClass("ok"), "text-ok");
    assert.notEqual(connectNoticeClass("ok"), "text-danger");
    assert.equal(connectNoticeClass("error"), "text-danger");
  });

  it("keeps the published photo plans and excludes video", () => {
    const trial = PLANS.find((plan) => plan.code === "trial");
    const monthly = PLANS.find((plan) => plan.code === "monthly");
    assert.equal(trial?.posts, 22);
    assert.equal(trial?.price, 0);
    assert.equal(monthly?.posts, 44);
    assert.equal(monthly?.price, 600);
    assert.match(monthly?.detail ?? "", /כולל מע״מ/);
    assert.match(VIDEO_NOTE, /וידאו אינה כלולה/);
  });
});
