import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isolatedServerEnv } from "./browser-env.mjs";

describe("browser test database isolation", () => {
  it("does not let a Vite env file restore DATABASE_URL", () => {
    const env = isolatedServerEnv(
      { DATABASE_URL: "postgres://should-not-pass", PATH: "/usr/bin", CONNECT_TEST_ORIGIN: "" },
      { DATABASE_URL: "postgres://from-env-file", INSTAGRAM_APP_SECRET: "from-file", SAFE: "kept" },
    );
    assert.equal(env.DATABASE_URL, "");
    assert.equal(env.INSTAGRAM_APP_SECRET, "");
    assert.equal(env.SAFE, "kept");
    assert.equal(env.PATH, "/usr/bin");
  });
});
