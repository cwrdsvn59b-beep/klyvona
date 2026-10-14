import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { instagramPublishVersion, instagramPublishVersionResponse } from "./instagram-publish-version.server.ts";

const route = readFileSync(fileURLToPath(new URL("../routes/api/server-version.ts", import.meta.url)), "utf8");
const source = readFileSync(fileURLToPath(new URL("./instagram-publish-version.server.ts", import.meta.url)), "utf8");

describe("production server version endpoint", () => {
  it("identifies the second-attempt source without secrets or a stale commit", async () => {
    const previous = process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    try {
      assert.deepEqual(instagramPublishVersion(), {
        version: "instagram-second-attempt-v2",
        commit: "source-tree",
      });
      process.env.VERCEL_GIT_COMMIT_SHA = "c030e8c73575cb2c1800855f221c225d6edc849d";
      assert.equal(instagramPublishVersion().commit, "c030e8c73575");
      process.env.VERCEL_GIT_COMMIT_SHA = "not a sha";
      assert.equal(instagramPublishVersion().commit, "source-tree");
    } finally {
      if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = previous;
    }
    const response = instagramPublishVersionResponse();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).version, "instagram-second-attempt-v2");
    assert.doesNotMatch(source, /b9f7a79a|DATABASE_URL|TOKEN_|getSql|openSecret|graph\.facebook|media_publish/);
    assert.match(route, /GET: async \(\) =>/);
    assert.match(route, /instagram-publish-version\.server/);
    assert.doesNotMatch(route, /instagram-test-publish|instagram-test-second/);
  });
});
