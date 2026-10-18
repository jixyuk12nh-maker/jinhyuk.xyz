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

test("admin developer-management routes require an authenticated admin role", async () => {
  const missing = await read(await worker.fetch(request("/api/admin/developers"), {}));
  assert.equal(missing.status, 503);
  assert.equal(missing.body.error, "database_not_configured");
  const DB = { prepare(sql) { return { bind() { return { first: async () => ({ id: "dev-1", username: "Developer", username_key: "developer", role: "developer", status: "active" }) }; } }; } };
  const denied = await read(await worker.fetch(request("/api/admin/developers", { headers: { authorization: "Bearer developer-token-012345678901234567890123456789" } }), { DB }));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "admin_role_required");
});

test("admin can rotate a developer token and receives it only once", async () => {
  const updates = [];
  const id = "12345678-1234-1234-1234-123456789012";
  const DB = { prepare(sql) { return { bind(...args) { updates.push({ sql, args }); return { first: async () => ({ id: "admin-1", username: "Admin", username_key: "admin", role: "admin", status: "active" }), run: async () => ({ meta: { changes: 1 } }) }; } }; } };
  const result = await read(await worker.fetch(request(`/api/admin/developers/${id}/rotate-token`, { method: "POST", headers: { authorization: "Bearer admin-token-012345678901234567890123456789" }, body: "{}" }), { DB }));
  assert.equal(result.status, 200);
  assert.match(result.body.apiToken, /^tm_dev_[0-9a-f]{64}$/);
  assert.equal(updates.length, 2);
  assert.match(updates[1].sql, /UPDATE developers SET token_hash/);
  assert.notEqual(updates[1].args[0], result.body.apiToken);
});

test("developer cannot claim a product owned by another developer", async () => {
  const writes = [];
  const DB = { prepare(sql) { return { bind() { return {
    first: async () => sql.includes("FROM developers") ? ({ id: "dev-2", username: "Other", username_key: "other", role: "developer", status: "active" }) : sql.includes("FROM products") ? ({ developer_id: "dev-1" }) : null,
    run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }),
  }; } }; } };
  const BUCKET = { async put(key, value) { writes.push({ key, value }); } };
  const result = await read(await worker.fetch(request("/api/scripts", { method: "POST", headers: { authorization: "Bearer test-token-012345678901234567890123456789" }, body: JSON.stringify({ scriptName: "Demo", sourceCode: "print(1)", loaderMode: "key", productId: "someone-elses-product" }) }), { DB, BUCKET }));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "product_id_owned_by_another_developer");
  assert.equal(writes.length, 0);
});

test("script publishing is denied without a developer bearer token", async () => {
  const result = await read(await worker.fetch(request("/api/scripts", {
    method: "POST", body: JSON.stringify({ scriptName: "Demo", sourceCode: "print(1)" }),
  }), { DB: { prepare() { throw new Error("should not query without token"); } } }));
  assert.equal(result.status, 401);
  assert.equal(result.body.error, "authentication_required");
});

test("script publishing writes code to R2 when BUCKET is bound and developer is authenticated", async () => {
  const writes = [];
  const DB = {
    prepare(sql) {
      return {
        bind() { return { run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }), first: async () => sql.includes("FROM developers") ? ({ id: "dev-1", username: "Jinhyuk", username_key: "jinhyuk", role: "developer", status: "active" }) : null }; },
      };
    },
  };
  const BUCKET = {
    async put(key, value, options) { writes.push({ key, value, options }); },
  };
  const result = await read(await worker.fetch(request("/api/scripts", {
    method: "POST",
    body: JSON.stringify({ username: "attacker-supplied-name", scriptName: "DemoScript", sourceCode: "print('hello')", loaderMode: "keyless" }),
    headers: { authorization: "Bearer test-token-012345678901234567890123456789" },
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
  const DB = {
    prepare(sql) {
      return { bind() {
        return {
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
          first: async () => sql.includes("FROM developers") ? ({ id: "dev-1", username: "Jinhyuk", username_key: "jinhyuk", role: "developer", status: "active" }) : null,
        };
      } };
    },
  };
  const BUCKET = { async put(key, value) { writes.push({ key, value }); } };
  const result = await read(await worker.fetch(request("/api/scripts", {
    method: "POST",
    body: JSON.stringify({ username: "Jinhyuk", scriptName: "BadScript", sourceCode: "local = ???", loaderMode: "keyless" }),
    headers: { authorization: "Bearer test-token-012345678901234567890123456789" },
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

test("JavaScript compiler isolates globals and preserves the host print function", () => {
  const output = compileAndPack("print(1, 2)");
  assert.match(output, /local HOST_ENV = \(getfenv and getfenv\(\)\) or _G or \{\}/);
  assert.match(output, /local hostPrint = HOST_ENV\.print or print/);
  assert.match(output, /local ENV = setmetatable\(\{\}, \{__index=HOST_ENV\}\)/);
  assert.match(output, /hostPrint\(table\.concat\(out,/);
  assert.doesNotMatch(output, /local ENV = \(getfenv and getfenv\(\)\) or _G or \{\}\s*[\s\S]*ENV\.print=[\s\S]*; print\(table\.concat/);
});

test("license creation validates and stores allowed place IDs", async () => {
  const calls = [];
  const DB = { prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return { run: async () => ({ meta: { changes: 1 } }), first: async () => sql.includes("FROM developers") ? ({ id: "dev-1", username: "Jinhyuk", username_key: "jinhyuk", role: "developer", status: "active" }) : sql.includes("FROM products") ? ({ product_id: "p" }) : null }; } }; } };
  const invalid = await read(await worker.fetch(request("/api/licenses", {
    method: "POST", body: JSON.stringify({ productId: "p", allowedPlaceIds: ["abc"] }), headers: { authorization: "Bearer test-token-012345678901234567890123456789" },
  }), { DB }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "invalid_allowed_place_ids");
  const valid = await read(await worker.fetch(request("/api/licenses", {
    method: "POST", body: JSON.stringify({ productId: "p", allowedPlaceIds: [123, "456", "123"] }), headers: { authorization: "Bearer test-token-012345678901234567890123456789" },
  }), { DB }));
  assert.equal(valid.status, 201);
  assert.deepEqual(valid.body.allowedPlaceIds, ["123", "456"]);
  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO licenses"));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].args[3], '["123","456"]');
});

test("owner-scoped loader URL resolves only within the specified developer", async () => {
  const queries = [];
  const DB = { prepare(sql) { return { bind(...args) { queries.push({ sql, args }); return {
    all: async () => ({ results: [{ username: "DevOne", username_key: "devone", script_name: "Demo", loader_mode: "keyless", status: "active" }] }),
    run: async () => ({ meta: { changes: 1 } }),
  }; } }; } };
  const result = await worker.fetch(request("/api/DevOne/Demo"), { DB });
  assert.equal(result.status, 200);
  const body = await result.text();
  assert.match(body, /UrlEncode\(\"devone\"\)/);
  assert.match(queries[0].sql, /username_key = \? AND script_key = \?/);
  assert.deepEqual(queries[0].args, ["devone", "demo"]);
});

test("legacy license verification treats an empty place allowlist as unrestricted", async () => {
  const DB = { prepare(sql) { return { bind() { return { first: async () => ({ id: "l1", product_id: "p", status: "active", allowed_place_ids: "[]", expires_at: null }), run: async () => ({ meta: { changes: 1 } }) }; } }; } };
  const result = await read(await worker.fetch(request("/v1/license/verify", {
    method: "POST", body: JSON.stringify({ productId: "p", licenseKey: "key", placeId: "123" }),
  }), { DB }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test("loader resolve rejects a license used outside its configured place allowlist", async () => {
  const licenseKey = "JX-TEST-KEY";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(licenseKey));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const DB = { prepare(sql) { return { bind(...args) {
    if (sql.includes("FROM scripts WHERE username_key")) return { all: async () => ({ results: [{ id: "s1", username_key: "u", script_key: "demo", script_name: "Demo", protected_code: "print(1)", status: "active", loader_mode: "key", product_id: "p" }] }) };
    if (sql.includes("FROM licenses WHERE key_hash")) { assert.equal(args[0], hash); return { first: async () => ({ id: "l1", status: "active", allowed_place_ids: '["123"]', expires_at: null }) }; }
    return { run: async () => ({ meta: { changes: 1 } }) };
  } }; } };
  const result = await read(await worker.fetch(request("/api/loader/resolve", {
    method: "POST", body: JSON.stringify({ username: "u", scriptName: "Demo", licenseKey, placeId: "999" }),
  }), { DB }));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "place_not_allowed");
});

test("JavaScript compiler rejects unsupported generic iteration", () => {
  assert.throws(() => compileAndPack('for key, value in pairs({}) do print(key) end'), /컴파일 오류/);
});

test("JavaScript compiler rejects Luau syntax outside its documented subset", () => {
  const unsupported = [
    "for key, value in pairs({}) do print(key) end",
    "local function f(...) return ... end",
    "do local x = 1 end",
    "local x = if true then 1 else 2",
    "while true do continue end",
    "function t:foo() end",
    "local x = `hello {name}`",
    "local x: number = 1",
  ];
  for (const source of unsupported) {
    assert.throws(() => compileAndPack(source), undefined, source);
  }
});
