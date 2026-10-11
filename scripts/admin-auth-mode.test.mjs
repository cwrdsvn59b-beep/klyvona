import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminIdentityDenied, productionAdminAuthProblem } from "./admin-auth-mode.mjs";
import { productionDatabaseProblem } from "./db-mode.mjs";

const productionAuth = {
  GROK_PROJECT_ID: "proj-1",
  VITE_AUTH_ENABLED: "true",
  GROK_AUTH_CLIENT_ID: "app-client",
  GROK_AUTH_CLIENT_SECRET: "app-secret",
};

describe("production admin auth", () => {
  it("does not apply the production gate in preview", () => {
    assert.equal(productionAdminAuthProblem({}), null);
    assert.equal(productionAdminAuthProblem({ VITE_AUTH_ENABLED: "false" }), null);
  });

  it("denies a published app when authentication is disabled", () => {
    const problem = productionAdminAuthProblem({
      GROK_PROJECT_ID: "proj-1",
      VITE_AUTH_ENABLED: "false",
      GROK_AUTH_CLIENT_ID: "app-client",
      GROK_AUTH_CLIENT_SECRET: "app-secret",
    });
    assert.match(problem, /disabled/);
  });

  it("denies production when the auth client is missing or is the preview client", () => {
    assert.match(productionAdminAuthProblem({ GROK_PROJECT_ID: "proj-1" }), /not configured/);
    assert.match(
      productionAdminAuthProblem({
        VERCEL_ENV: "production",
        GROK_AUTH_CLIENT_ID: "grok_preview",
        GROK_AUTH_CLIENT_SECRET: "preview-secret",
      }),
      /not configured/,
    );
    assert.equal(productionAdminAuthProblem(productionAuth), null);
  });

  it("never treats the shared dev user as an administrator", () => {
    assert.equal(adminIdentityDenied("dev-user"), true);
    assert.equal(adminIdentityDenied(""), true);
    assert.equal(adminIdentityDenied("user_123"), false);
  });
});

describe("production database signal", () => {
  it("refuses in-memory storage on Vercel production without DATABASE_URL", () => {
    const problem = productionDatabaseProblem({ VERCEL_ENV: "production" });
    assert.match(problem, /DATABASE_URL/);
    assert.match(problem, /PGLite/);
  });

  it("allows a preview Vercel environment to keep the fallback", () => {
    assert.equal(productionDatabaseProblem({ VERCEL_ENV: "preview" }), null);
  });
});
