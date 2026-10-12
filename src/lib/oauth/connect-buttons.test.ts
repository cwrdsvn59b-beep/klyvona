import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimOAuthStart, oauthButtonBusy, type ConnectPlatform } from "./connect-buttons.ts";

describe("connect button independence", () => {
  it("shows a loading state only on the platform that was pressed", () => {
    assert.equal(oauthButtonBusy("instagram", "instagram"), true);
    assert.equal(oauthButtonBusy("instagram", "facebook"), false);
    assert.equal(oauthButtonBusy("facebook", "facebook"), true);
    assert.equal(oauthButtonBusy("facebook", "instagram"), false);
    assert.equal(oauthButtonBusy(null, "instagram"), false);
  });

  it("rejects a second OAuth start before React can re-render", () => {
    let current: ConnectPlatform | null = null;
    const launches: ConnectPlatform[] = [];
    function press(next: ConnectPlatform) {
      const claimed = claimOAuthStart(current, next);
      if (!claimed) return;
      current = claimed;
      launches.push(claimed);
    }

    press("instagram");
    press("instagram");
    press("facebook");
    assert.deepEqual(launches, ["instagram"]);
    assert.equal(oauthButtonBusy(current, "facebook"), false);

    current = null;
    press("facebook");
    press("instagram");
    assert.deepEqual(launches, ["instagram", "facebook"]);
  });
});

describe("connect page layout", () => {
  it("keeps a single mobile column and the document RTL", () => {
    const page = readFileSync(new URL("../../routes/connect.tsx", import.meta.url), "utf8");
    const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
    assert.match(page, /max-w-xl px-4/);
    assert.match(page, /התחברות עם Instagram/);
    assert.match(page, /אישור ניתוק Instagram/);
    assert.match(page, /ביטול/);
    assert.match(page, /await load\(true\)/);
    assert.doesNotMatch(page, /התחברות עם Facebook/);
    assert.doesNotMatch(page, /ניתוק Facebook/);
    assert.match(page, /grid gap-3/);
    assert.match(root, /dir="rtl"/);
    assert.doesNotMatch(page, /key=\{account\.name\}/);
  });
});
