import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LEGAL_UPDATED } from "./legal.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("public legal pages", () => {
  it("keeps the privacy and deletion pages public and free of a made-up address", () => {
    const privacy = source("../routes/privacy.tsx");
    const deletion = source("../routes/data-deletion.tsx");
    assert.match(privacy, /מדיניות פרטיות – KLYVONA/);
    assert.match(privacy, /LEGAL_UPDATED/);
    assert.equal(LEGAL_UPDATED, "12 באוקטובר 2026");
    assert.match(deletion, /מחיקת מידע אישי/);
    assert.match(deletion, /אינה אוטומטית/);
    for (const page of [privacy, deletion]) {
      assert.doesNotMatch(page, /authMiddleware|RedirectToSignIn/);
      assert.doesNotMatch(page, /@[a-z0-9.-]+\.[a-z]{2,}/i);
    }
    const connect = source("../routes/connect.tsx");
    const login = source("../routes/login.tsx");
    const home = source("../components/onboarding-wizard.tsx");
    for (const page of [connect, login, home]) {
      assert.match(page, /LegalLinks/);
    }
  });
});
