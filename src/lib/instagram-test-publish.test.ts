import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./instagram-test-publish.functions.ts", import.meta.url)), "utf8");
const migration = readFileSync(fileURLToPath(new URL("../../migrations/999_instagram_test_publications.sql", import.meta.url)), "utf8");
const ui = readFileSync(fileURLToPath(new URL("../components/instagram-test-publish.tsx", import.meta.url)), "utf8");

describe("single-attempt Instagram test publication safety invariants", () => {
  it("requires verified administrator and exact typed confirmation", () => {
    assert.match(source, /authMiddleware/);
    assert.match(source, /resolveAdminAccess\(userId\)/);
    assert.match(source, /PUBLISH KV-EKBXGL/);
    assert.match(ui, /confirmation !== CONFIRM/);
  });
  it("limits the target and checks gates again atomically before reservation", () => {
    assert.match(source, /KV-EKBXGL/);
    assert.match(source, /klyvona_business/);
    assert.match(source, /liveInstagramGraph\.profile\(token\)/);
    assert.match(source, /sa\.publish_permission_token_hash =/);
    assert.match(source, /c\.approval_status = 'approved'/);
    assert.match(source, /on conflict do nothing/);
    assert.match(migration, /instagram_account_id text not null unique/);
    assert.match(migration, /client_id text primary key/);
  });
  it("reconciles the existing container and recent media using GET only", () => {
    const start = source.indexOf("export const diagnoseInstagramTestAttempt");
    const end = source.indexOf("type GraphResult =", start);
    assert.ok(start >= 0 && end > start);
    const diagnosis = source.slice(start, end);
    assert.match(diagnosis, /safeGraphRead\(attempt.container_id, token, "status_code"\)/);
    assert.match(diagnosis, /safeGraphRead\(\`\$\{row.external_account_id\}\/media\`, token/);
    assert.doesNotMatch(diagnosis, /graphPost|media_publish|recordStage|update instagram_test_publications/);
    assert.match(source, /method: "GET"/);
    assert.match(ui, /diagnoseInstagramTestAttempt/);
  });
  it("never retries a publish request and records uncertain outcomes", () => {
    assert.match(source, /media_publish/);
    assert.match(source, /publish_result_unknown/);
    assert.match(source, /uncertain_check_instagram_no_retry/);
    assert.doesNotMatch(source, /setInterval|while\s*\(/);
    assert.match(source, /await waitForContainerFinished\(containerId, token\)/);
    assert.match(source, /const maxChecks = 8/);
    assert.match(source, /status === "FINISHED"/);
    assert.match(source, /status !== "IN_PROGRESS"/);
    assert.match(source, /new Promise<void>/);
    assert.ok(source.indexOf("await waitForContainerFinished(containerId, token)") < source.indexOf("const published = await graphPost"));
    assert.match(source, /failed_before_request/);
    assert.match(source, /published_but_database_confirmation_failed_no_retry/);
    assert.match(source, /meta_rejected_no_retry/);
    assert.match(source, /meta_post_transport_unknown/);
    assert.match(source, /mediaId: publishedMediaId/);
    assert.doesNotMatch(source, /notifyMake|publishing_jobs|Google Sheets/);
  });
});
