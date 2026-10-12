import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";

const origin = "http://127.0.0.1:8080";

describe("connect page in a browser", () => {
  let browser: Browser;

  before(async () => {
    const response = await fetch(`${origin}/connect`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`dev server returned ${response.status}`);
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  for (const viewport of [
    { name: "iphone-safari-size", width: 390, height: 844 },
    { name: "android-chrome-size", width: 412, height: 915 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    it(`renders Instagram-only RTL connect UI at ${viewport.name}`, async () => {
      const page = await browser!.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.goto(`${origin}/connect`, { waitUntil: "networkidle" });
      await page.getByText("המסך הזה זמין אחרי השלמת ההצטרפות באותו דפדפן").waitFor();
      const dir = await page.locator("html").getAttribute("dir");
      assert.equal(dir, "rtl");
      await page.getByRole("button", { name: "התחברות עם Instagram" }).waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("button", { name: "התחברות עם Facebook" }).count(), 0);
      assert.match(await page.locator("body").innerText(), /המסך הזה זמין אחרי השלמת ההצטרפות באותו דפדפן/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(overflow, false);
      await page.addInitScript(() => {
        sessionStorage.setItem(
          "klyvona-onboarding-receipt",
          JSON.stringify({ reference: "KV-TEST", connectSecret: "browser-secret", businessName: "עסק בדיקה" }),
        );
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "התחברות עם Instagram" }).waitFor();
      await page.getByRole("button", { name: "ניתוק Instagram" }).click();
      await page.getByRole("button", { name: "ביטול" }).waitFor();
      await page.getByRole("button", { name: "אישור ניתוק Instagram" }).waitFor();
      await page.getByRole("button", { name: "ביטול" }).click();
      assert.equal(await page.getByRole("button", { name: "אישור ניתוק Instagram" }).count(), 0);
      await page.close();
    });
  }
});
