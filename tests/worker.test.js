import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

async function read(response) {
  return { status: response.status, body: await response.json() };
}

function request(path, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : body,
  });
}

test("health endpoint responds without a database", async () => {
  const result = await read(await worker.fetch(request("/health"), {}));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.database, false);
});

test("unknown endpoint returns 404", async () => {
  const result = await read(await worker.fetch(request("/unknown"), {}));
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "not_found");
});

test("malformed JSON is rejected", async () => {
  const result = await read(await worker.fetch(request("/v1/license/verify", { method: "POST", body: "{" }), {}));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_json");
});

test("oversized body is rejected even without Content-Length", async () => {
  const result = await read(await worker.fetch(request("/v1/license/verify", { method: "POST", body: JSON.stringify({ x: "a".repeat(5000) }) }), {}));
  assert.equal(result.status, 413);
  assert.equal(result.body.error, "request_too_large");
});

test("missing license fields are rejected", async () => {
  const result = await read(await worker.fetch(request("/v1/license/verify", { method: "POST", body: JSON.stringify({ productId: "p" }) }), { DB: {} }));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "missing_or_invalid_fields");
});

test("license verification reports missing database configuration", async () => {
  const result = await read(await worker.fetch(request("/v1/license/verify", { method: "POST", body: JSON.stringify({ productId: "p", licenseKey: "k", placeId: "123" }) }), {}));
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "database_not_configured");
});

test("database query failures return a controlled 503", async () => {
  const DB = { prepare() { return { bind() { return { first: async () => { throw new Error("private db details"); } }; } }; } };
  const result = await read(await worker.fetch(request("/v1/license/verify", { method: "POST", body: JSON.stringify({ productId: "p", licenseKey: "k", placeId: "123" }) }), { DB }));
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "database_unavailable");
});
