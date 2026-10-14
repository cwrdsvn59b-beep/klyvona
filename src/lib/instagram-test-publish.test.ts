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
    assert.match(source, /on conflict \(client_id\) do nothing/);
    assert.match(migration, /client_id text primary key/);
  });
  it("never retries a publish request and records uncertain outcomes", () => {
    assert.match(source, /media_publish/);
    assert.match(source, /publish_result_unknown/);
    assert.match(source, /uncertain_check_instagram_no_retry/);
    assert.doesNotMatch(source, /setInterval|setTimeout|while\s*\(|for\s*\(/);
    assert.doesNotMatch(source, /notifyMake|publishing_jobs|Google Sheets/);
  });
});
