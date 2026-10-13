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
    const catalog = source("./i18n/he.ts");
    assert.match(catalog, /מדיניות פרטיות – KLYVONA/);
    assert.match(catalog, /מחיקת מידע אישי/);
    assert.match(catalog, /אינה אוטומטית/);
    assert.match(privacy, /LEGAL_UPDATED/);
    assert.match(privacy, /LanguageSwitcher/);
    assert.match(deletion, /LanguageSwitcher/);
    assert.equal(LEGAL_UPDATED, "12 באוקטובר 2026");
    for (const page of [privacy, deletion, catalog]) {
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
