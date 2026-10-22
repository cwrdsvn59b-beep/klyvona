import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { en } from "./en.ts";
import { he, type MessageKey } from "./he.ts";
import { dirFor, LOCALE_COOKIE, parseLocale, readCookieValue, writeLocaleCookie } from "./locale.ts";
import { ru } from "./ru.ts";
import { eventStepLabel, showNotice, translateKnown } from "./surface.ts";
import { hasMessage, translate } from "./translate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("interface catalogs", () => {
  it("keeps Hebrew, Russian and English complete, non-empty, and aligned", () => {
    const keys = Object.keys(he) as MessageKey[];
    assert.ok(keys.length > 300);
    for (const key of keys) {
      assert.equal(typeof ru[key], "string", key);
      assert.equal(typeof en[key], "string", key);
      assert.notEqual(he[key].trim(), "", key);
      assert.notEqual(ru[key].trim(), "", key);
      assert.notEqual(en[key].trim(), "", key);
      assert.equal(he[key].includes(key), false, key);
    }
    const groups = new Map<string, MessageKey[]>();
    for (const key of keys) {
      const list = groups.get(he[key]) ?? [];
      list.push(key);
      groups.set(he[key], list);
    }
    const uiHomonyms = new Set(["מחיקת מידע", "נכשל", "פרטי העסק", "חיבור Instagram", "אישור עדכון ההרשאה", "ניתוק Instagram"]);
    for (const [text, list] of groups) {
      if (list.length < 2 || uiHomonyms.has(text)) continue;
      const russian = new Set(list.map((key) => ru[key]));
      const english = new Set(list.map((key) => en[key]));
      assert.equal(russian.size, 1, `${text} :: ${list.join(",")}`);
      assert.equal(english.size, 1, `${text} :: ${list.join(",")}`);
    }
  });

  it("falls back to Hebrew and never returns a raw key", () => {
    assert.equal(translate("en", "connect.login"), en["connect.login"]);
    assert.equal(translate("ru", "connect.gate"), ru["connect.gate"]);
    assert.equal(translate("he", "common.missing"), he["common.missing"]);
    assert.equal(hasMessage("not.a.real.key"), false);
    assert.equal(showNotice("en", "key:not.a.real.key"), en["common.missing"]);
    assert.equal(showNotice("en", "key:not.a.real.key").includes("not.a.real.key"), false);
    assert.match(source(join(here, "translate.ts")), /localized \|\| catalogs\.he\[key\]/);
    assert.equal(showNotice("ru", "key:validation.incomplete"), ru["validation.incomplete"]);
    assert.equal(translate("en", "home.stepCount", { current: 2, total: 5 }).includes("2"), true);
  });

  it("sets direction and reads the interface cookie without touching the onboarding draft", () => {
    assert.equal(dirFor("he"), "rtl");
    assert.equal(dirFor("ru"), "ltr");
    assert.equal(dirFor("en"), "ltr");
    assert.equal(parseLocale("ru"), "ru");
    assert.equal(parseLocale("nope"), "he");
    assert.equal(parseLocale(null), "he");
    assert.equal(readCookieValue(`a=1; ${LOCALE_COOKIE}=en; b=2`, LOCALE_COOKIE), "en");
    const jar = { cookie: "" };
    const store = new Map<string, string>();
    const previousDocument = globalThis.document;
    const previousStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return jar.cookie;
        },
        set cookie(value: string) {
          jar.cookie = value;
        },
      },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem(key: string, value: string) {
          store.set(key, value);
        },
        getItem(key: string) {
          return store.get(key) ?? null;
        },
      },
    });
    try {
      writeLocaleCookie("ru");
      assert.match(jar.cookie, new RegExp(`^${LOCALE_COOKIE}=ru;`));
      assert.match(jar.cookie, /Max-Age=31536000/);
      assert.match(jar.cookie, /SameSite=Lax/);
      assert.equal(store.get(LOCALE_COOKIE), "ru");
    } finally {
      if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
      if (previousStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
    }
    const localeSource = source(join(here, "locale.ts"));
    assert.equal(localeSource.includes("klyvona-onboarding-draft"), false);
    assert.match(localeSource, /not sent to Make/);
    assert.match(localeSource, /ui_locale/);
  });

  it("translates known system sentences and leaves customer text unchanged", () => {
    assert.equal(translateKnown("en", he["connect.gate"]), en["connect.gate"]);
    assert.equal(
      translate("he", "oauth.grant.permissions_confirmed"),
      "בעת החיבור Meta דיווחה על הרשאת פרסום. זו אינה בדיקה מקוונת עדכנית.",
    );
    assert.equal(translateKnown("ru", "מסעדת דוד בשוק"), "מסעדת דוד בשוק");
    assert.match(translateKnown("en", "instagram: תוקף החיבור עומד לפוג או פג"), /instagram/i);
    assert.equal(translateKnown("en", "instagram: תוקף החיבור עומד לפוג או פג").includes("תוקף"), false);
    assert.match(translateKnown("en", "מנוי: active"), /active/);
    assert.equal(eventStepLabel("en", "details"), en["event.step.details"]);
    assert.equal(eventStepLabel("ru", "custom-step"), "custom-step");
    assert.equal(translateKnown("he", he["reason.tokenExpired"]), he["reason.tokenExpired"]);
    assert.equal(translate("en", "admin.traceMemory"), en["admin.traceMemory"]);
  });

  it("keeps legal copy free of an invented address and the switcher on public pages", () => {
    const legalKeys = (Object.keys(he) as MessageKey[]).filter((key) => key.startsWith("privacy.") || key.startsWith("deletion.") || key.startsWith("nav."));
    for (const key of legalKeys) {
      for (const text of [he[key], ru[key], en[key]]) {
        assert.doesNotMatch(text, /@[a-z0-9.-]+\.[a-z]{2,}/i);
      }
    }
    assert.equal(he["legal.updatedDate"], "12 באוקטובר 2026");
    const pages = [
      "src/components/onboarding-wizard.tsx",
      "src/routes/connect.tsx",
      "src/routes/reviews.tsx",
      "src/routes/login.tsx",
      "src/routes/admin/route.tsx",
      "src/routes/privacy.tsx",
      "src/routes/data-deletion.tsx",
      "src/lib/error-component.tsx",
    ];
    for (const page of pages) {
      assert.match(source(join(root, page)), /LanguageSwitcher/);
    }
    for (const page of ["src/routes/privacy.tsx", "src/routes/data-deletion.tsx"]) {
      const text = source(join(root, page));
      assert.doesNotMatch(text, /authMiddleware|RedirectToSignIn/);
      assert.match(text, /LEGAL_UPDATED/);
    }
  });

  it("does not leave Hebrew copy in customer or admin screens", () => {
    const files = [
      ...walk(join(root, "src/routes")),
      ...walk(join(root, "src/components")),
      join(root, "src/lib/error-component.tsx"),
      join(root, "src/lib/auth/gates.tsx"),
    ];
    const hebrew = /[\u0590-\u05FF]/;
    const hits = files.filter((file) => hebrew.test(source(file)));
    assert.deepEqual(hits, []);
  });
});
