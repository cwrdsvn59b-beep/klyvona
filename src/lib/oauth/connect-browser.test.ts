import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, firefox, webkit, type Browser } from "playwright";
import { CONNECT_GATE_TEXT } from "./connect-session.ts";

const origin = process.env.CONNECT_TEST_ORIGIN;
if (!origin) throw new Error("CONNECT_TEST_ORIGIN is required. Run npm run test:browser.");

const engines = [
  { name: "chromium", launch: () => chromium.launch({ headless: true }) },
  { name: "firefox", launch: () => firefox.launch({ headless: true }) },
  { name: "webkit", launch: () => webkit.launch({ headless: true }) },
];

const viewports = [
  { name: "narrow-390x844", width: 390, height: 844 },
  { name: "narrow-412x915", width: 412, height: 915 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
];

describe("connect page in desktop browser engines", () => {
  before(async () => {
    const response = await fetch(`${origin}/connect`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`test server returned ${response.status}`);
  });

  for (const engine of engines) {
    describe(engine.name, () => {
      let browser: Browser;

      before(async () => {
        browser = await engine.launch();
      });

      after(async () => {
        await browser?.close();
      });

      for (const viewport of viewports) {
        it(`renders the exact Hebrew gate at ${viewport.name}`, async () => {
          const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
          await page.goto(`${origin}/connect`, { waitUntil: "networkidle" });
          await page.getByText(CONNECT_GATE_TEXT, { exact: true }).waitFor();
          const dir = await page.locator("html").getAttribute("dir");
          assert.equal(dir, "rtl");
          const text = await page.locator("body").innerText();
          assert.equal(text.includes(CONNECT_GATE_TEXT), true);
          assert.equal(text.includes("התחברות עם Facebook"), false);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          assert.equal(overflow, false);
          await page.addInitScript((saved) => {
            sessionStorage.setItem("klyvona-onboarding-receipt", saved);
          }, JSON.stringify({ reference: "KV-TEST", connectSecret: "browser-secret", businessName: "עסק בדיקה" }));
          await page.reload({ waitUntil: "networkidle" });
          await page.getByRole("button", { name: "התחברות עם Instagram" }).waitFor();
          assert.equal(await page.getByRole("button", { name: "התחברות עם Facebook" }).count(), 0);
          await page.getByRole("button", { name: "ניתוק Instagram" }).click();
          await page.getByRole("button", { name: "ביטול" }).click();
          assert.equal(await page.getByRole("button", { name: "אישור ניתוק Instagram" }).count(), 0);
          await page.close();
        });
      }
    });
  }
});
