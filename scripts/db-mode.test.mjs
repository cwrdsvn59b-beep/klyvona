import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { productionDatabaseProblem } from "./db-mode.mjs";

describe("production database", () => {
  it("allows the preview fallback when the app is not published", () => {
    assert.equal(productionDatabaseProblem({}), null);
    assert.equal(productionDatabaseProblem({ DATABASE_URL: "  " }), null);
  });

  it("fails closed when a published app has no DATABASE_URL", () => {
    const problem = productionDatabaseProblem({ GROK_PROJECT_ID: "proj-1" });
    assert.equal(typeof problem, "string");
    assert.match(problem, /DATABASE_URL/);
    assert.match(problem, /PGLite/);
    assert.equal(problem.includes("postgres://"), false);
  });

  it("accepts a published app only when DATABASE_URL is set", () => {
    assert.equal(
      productionDatabaseProblem({
        GROK_PROJECT_ID: "proj-1",
        DATABASE_URL: "postgres://example",
      }),
      null,
    );
  });

  it("treats a blank project id as unpublished", () => {
    assert.equal(productionDatabaseProblem({ GROK_PROJECT_ID: "  " }), null);
  });
});
