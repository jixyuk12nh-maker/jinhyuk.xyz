import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";
import { compileAndPack } from "../cloudflare/compiler.js";
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


test("health endpoint reports the R2 binding", async () => {
  const result = await read(await worker.fetch(request("/health"), { BUCKET: { put() {}, get() {} } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.r2Storage, true);
});

test("script publishing writes code to R2 when BUCKET is bound", async () => {
  const writes = [];
  const DB = {
    prepare() {
      return {
        bind() { return { run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }), first: async () => null }; },
      };
    },
  };
  const BUCKET = {
    async put(key, value, options) { writes.push({ key, value, options }); },
  };
  const result = await read(await worker.fetch(request("/api/scripts", {
    method: "POST",
    body: JSON.stringify({ username: "Jinhyuk", scriptName: "DemoScript", sourceCode: "print('hello')", loaderMode: "keyless" }),
  }), { DB, BUCKET }));
  assert.equal(result.status, 201);
  assert.equal(result.body.storage, "r2");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "scripts/jinhyuk/demoscript.lua");
  assert.equal(result.body.protected, true);
  assert.equal(result.body.compiler, "worker-js-lgvm");
  assert.match(writes[0].value, /local PROTOS =/);
  assert.doesNotMatch(writes[0].value, /print\('hello'\)/);
});


test("script publishing rejects unsupported source before storage", async () => {
  const writes = [];
  const DB = { prepare() { return { bind() { return { run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }), first: async () => null }; } }; } };
  const BUCKET = { async put(key, value) { writes.push({ key, value }); } };
  const result = await read(await worker.fetch(request("/api/scripts", {
    method: "POST",
    body: JSON.stringify({ username: "Jinhyuk", scriptName: "BadScript", sourceCode: "local = ???", loaderMode: "keyless" }),
  }), { DB, BUCKET }));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "compile_failed");
  assert.equal(writes.length, 0);
});


test("JavaScript compiler packages supported source and masks string constants", () => {
  const output = compileAndPack('local secret = "private-literal"\nprint(secret)');
  assert.match(output, /local PROTOS =/);
  assert.match(output, /getfenv/);
  assert.doesNotMatch(output, /private-literal/);
});

test("JavaScript compiler rejects unsupported generic iteration", () => {
  assert.throws(() => compileAndPack('for key, value in pairs({}) do print(key) end'), /컴파일 오류/);
});
