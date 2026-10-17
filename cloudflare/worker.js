import { compileAndPack } from "./compiler.js";
const SITE_ORIGINS = new Set(["https://jinhyuk.xyz", "https://www.jinhyuk.xyz"]);
const corsHeaders = (request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    ...(SITE_ORIGINS.has(origin) ? { "access-control-allow-origin": origin, "vary": "Origin" } : {}),
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
  };
};
const json = (request, data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const text = (request, body, status = 200) => new Response(body, {
  status,
  headers: { ...corsHeaders(request), "content-type": "text/plain; charset=utf-8", "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
});
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cleanSegment(value, max = 64) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  const out = decoded.trim();
  if (!out || out.length > max || out === "." || out === ".." || !/^[A-Za-z0-9_-]+$/.test(out)) return null;
  return out;
}
async function readJson(request, maxBytes = 600 * 1024) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "request_too_large", status: 413 };
  try { return { value: JSON.parse(raw) }; } catch { return { error: "invalid_json", status: 400 }; }
}
function loaderBootstrap(scriptName, mode) {
  const safeName = JSON.stringify(scriptName);
  const base = 'https://jinhyuk.xyz';
  if (mode === 'key') {
    return `-- Jinhyuk.xyz loader | license mode\nlocal HttpService = game:GetService("HttpService")\nlocal scriptName = ${safeName}\nlocal key = rawget(_G, "Script_key") or rawget(getgenv and getgenv() or {}, "Script_key")\nif type(key) ~= "string" or key == "" then error("[Jinhyuk] Script_key is missing", 0) end\nlocal body = HttpService:JSONEncode({scriptName = scriptName, licenseKey = key})\nlocal req = (syn and syn.request) or (http and http.request) or request or http_request\nif type(req) ~= "function" then error("[Jinhyuk] This executor does not support authenticated requests", 0) end\nlocal response = req({Url = "${base}/api/loader/resolve", Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = body})\nif not response or (response.StatusCode and response.StatusCode ~= 200) then error("[Jinhyuk] License verification failed", 0) end\nlocal result = HttpService:JSONDecode(response.Body or "{}")\nif result.ok ~= true or type(result.code) ~= "string" then error("[Jinhyuk] License verification failed", 0) end\nlocal run = loadstring(result.code)\nif not run then error("[Jinhyuk] Script compilation failed", 0) end\nreturn run()\n`;
  }
  return `-- Jinhyuk.xyz loader | keyless mode\nlocal HttpService = game:GetService("HttpService")\nlocal response = game:HttpGet("${base}/api/loader/resolve?name=" .. HttpService:UrlEncode(${safeName}))\nlocal result = HttpService:JSONDecode(response)\nif result.ok ~= true or type(result.code) ~= "string" then error("[Jinhyuk] Script unavailable", 0) end\nlocal run = loadstring(result.code)\nif not run then error("[Jinhyuk] Script compilation failed", 0) end\nreturn run()\n`;
}
async function scriptRoute(request, env, scriptRaw) {
  const scriptName = cleanSegment(scriptRaw, 64);
  if (!scriptName) return json(request, { ok: false, error: "invalid_script_path" }, 400);
  if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
  let rows;
  try {
    rows = await env.DB.prepare("SELECT script_name, loader_mode, status FROM scripts WHERE script_key = ? LIMIT 2")
      .bind(scriptName.toLowerCase()).all();
  } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
  const matches = rows.results || [];
  if (matches.length !== 1 || matches[0].status !== "active") return json(request, { ok: false, error: matches.length > 1 ? "script_name_ambiguous" : "script_not_found" }, matches.length > 1 ? 409 : 404);
  await logRequest(env, scriptName, "loader_requested", request);
  return text(request, loaderBootstrap(matches[0].script_name, matches[0].loader_mode || "keyless"), 200);
}
async function logRequest(env, scriptName, eventType, request) {
  try {
    await env.DB.prepare("INSERT INTO loader_events (id, script_name, event_type, country, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), scriptName, eventType, request.cf?.country || null).run();
  } catch { /* logging must not break script delivery */ }
}
async function resolveLoader(request, env) {
  if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
  let parsed = { value: {} };
  if (request.method === "POST") parsed = await readJson(request, 4096);
  if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
  const name = cleanSegment(String(request.method === "GET" ? new URL(request.url).searchParams.get("name") || "" : parsed.value.scriptName || ""), 64);
  const licenseKey = String(parsed.value.licenseKey || "").trim();
  if (!name) return json(request, { ok: false, error: "script_name_required" }, 400);
  let rows;
  try { rows = await env.DB.prepare("SELECT id, username_key, script_key, script_name, protected_code, status, loader_mode, product_id FROM scripts WHERE script_key = ? LIMIT 2").bind(name.toLowerCase()).all(); }
  catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
  const matches = rows.results || [];
  if (matches.length !== 1) return json(request, { ok: false, error: matches.length > 1 ? "script_name_ambiguous" : "script_not_found" }, matches.length > 1 ? 409 : 404);
  const script = matches[0];
  if (script.status !== "active") return json(request, { ok: false, error: "script_disabled" }, 403);
  if ((script.loader_mode || "keyless") === "key" || script.product_id) {
    if (!licenseKey) { await logRequest(env, name, "license_missing", request); return json(request, { ok: false, error: "license_required" }, 403); }
    const keyHash = await sha256Hex(licenseKey);
    let license;
    try { license = await env.DB.prepare("SELECT id, status, expires_at FROM licenses WHERE key_hash = ? AND product_id = ? LIMIT 1").bind(keyHash, script.product_id || script.id).first(); }
    catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    if (!license || license.status !== "active") { await logRequest(env, name, "license_invalid", request); return json(request, { ok: false, error: "invalid_license" }, 403); }
    if (license.expires_at && Date.parse(license.expires_at) <= Date.now()) { await logRequest(env, name, "license_expired", request); return json(request, { ok: false, error: "license_expired" }, 403); }
    try { await env.DB.prepare("UPDATE licenses SET last_verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(license.id).run(); } catch {}
  }
  let code = script.protected_code || "";
  if (env.BUCKET) {
    const objectKey = `scripts/${script.username_key}/${script.script_key}.lua`;
    try {
      const object = await env.BUCKET.get(objectKey);
      if (object) code = await object.text();
      else if (!code) {
        await logRequest(env, name, "script_storage_missing", request);
        return json(request, { ok: false, error: "script_storage_missing" }, 503);
      }
    } catch {
      await logRequest(env, name, "script_storage_unavailable", request);
      return json(request, { ok: false, error: "r2_storage_unavailable" }, 503);
    }
  }
  if (!code) return json(request, { ok: false, error: "script_content_empty" }, 503);
  await logRequest(env, name, "script_delivered", request);
  return json(request, { ok: true, scriptName: script.script_name, code });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(request, { ok: true, service: "tm API", version: "1.2.0", database: Boolean(env.DB), r2Storage: Boolean(env.BUCKET), scriptLoader: true });
    }

    // TEST MODE: admin endpoints intentionally have no API-token requirement. Do not expose publicly before adding account/session authorization.
    if (request.method === "POST" && url.pathname === "/api/scripts") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(request, { ok: false, error: "invalid_body" }, 400);
      const username = cleanSegment(String(body.username ?? ""), 40);
      const scriptName = cleanSegment(String(body.scriptName ?? ""), 64);
      const sourceCode = typeof body.sourceCode === "string" ? body.sourceCode : "";
      const loaderMode = body.loaderMode === "key" ? "key" : "keyless";
      const productId = typeof body.productId === "string" && body.productId.trim() ? body.productId.trim().slice(0, 100) : null;
      if (!username || !scriptName || !sourceCode.trim()) return json(request, { ok: false, error: "missing_or_invalid_fields" }, 400);
      if (new TextEncoder().encode(sourceCode).byteLength > 512 * 1024) return json(request, { ok: false, error: "script_too_large" }, 413);
      // Compile the uploaded source into a standalone custom-VM Luau payload in the Worker.
      let code;
      try {
        code = compileAndPack(sourceCode, `${scriptName}.lua`);
      } catch (error) {
        const message = String(error?.message || "compile_failed").slice(0, 500);
        return json(request, { ok: false, error: "compile_failed", message }, 400);
      }
      if (new TextEncoder().encode(code).byteLength > 1024 * 1024) return json(request, { ok: false, error: "compiled_script_too_large" }, 413);
      const id = crypto.randomUUID();
      const usernameKey = username.toLowerCase();
      const scriptKey = scriptName.toLowerCase();
      const objectKey = `scripts/${usernameKey}/${scriptKey}.lua`;
      let storedInR2 = false;
      // R2 is the primary file store when the BUCKET binding exists.
      // Keep D1 protected_code as an empty compatibility value for R2-backed scripts.
      if (env.BUCKET) {
        try {
          await env.BUCKET.put(objectKey, code, {
            httpMetadata: { contentType: "text/plain; charset=utf-8", cacheControl: "no-store" },
            customMetadata: { username: usernameKey, scriptName: scriptKey },
          });
          storedInR2 = true;
        } catch {
          return json(request, { ok: false, error: "r2_storage_unavailable" }, 503);
        }
      }
      try {
        await env.DB.prepare(`INSERT INTO scripts (id, username, username_key, script_name, script_key, protected_code, status, loader_mode, product_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(username_key, script_key) DO UPDATE SET username=excluded.username, script_name=excluded.script_name, protected_code=excluded.protected_code, status='active', loader_mode=excluded.loader_mode, product_id=excluded.product_id, updated_at=CURRENT_TIMESTAMP`)
          .bind(id, username, usernameKey, scriptName, scriptKey, storedInR2 ? "" : code, loaderMode, loaderMode === "key" ? (productId || id) : null).run();
      } catch {
        // If D1 registration fails after the R2 write, the object may remain orphaned.
        return json(request, { ok: false, error: "database_unavailable" }, 503);
      }
      return json(request, { ok: true, username, scriptName, loaderMode, storage: storedInR2 ? "r2" : "d1_fallback", productId: productId || id, url: `https://jinhyuk.xyz/api/${encodeURIComponent(scriptName)}`, protected: true, compiler: "worker-js-lgvm", note: storedInR2 ? "컴파일 및 VM 패키징 완료. 보호된 Luau 코드가 R2에 저장되었습니다." : "컴파일 및 VM 패키징 완료. R2 바인딩이 없어 D1에 저장되었습니다." }, 201);
    }

    if (request.method === "GET" && url.pathname === "/api/scripts") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const username = cleanSegment(url.searchParams.get("username") || "", 40);
      if (!username) return json(request, { ok: false, error: "username_required" }, 400);
      try {
        const result = await env.DB.prepare("SELECT username, script_name AS scriptName, status, created_at AS createdAt, updated_at AS updatedAt FROM scripts WHERE username_key = ? ORDER BY updated_at DESC LIMIT 200").bind(username.toLowerCase()).all();
        return json(request, { ok: true, scripts: result.results || [] });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/scripts/")) {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parts = url.pathname.split("/").slice(3);
      if (parts.length !== 2) return json(request, { ok: false, error: "invalid_script_path" }, 400);
      const username = cleanSegment(parts[0], 40), scriptName = cleanSegment(parts[1], 64);
      if (!username || !scriptName) return json(request, { ok: false, error: "invalid_script_path" }, 400);
      try {
        const result = await env.DB.prepare("UPDATE scripts SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE username_key = ? AND script_key = ?").bind(username.toLowerCase(), scriptName.toLowerCase()).run();
        if (!result.meta?.changes) return json(request, { ok: false, error: "script_not_found" }, 404);
        return json(request, { ok: true, status: "disabled" });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/loader/resolve") return resolveLoader(request, env);

    if (request.method === "POST" && url.pathname === "/api/licenses") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value || {};
      const productId = String(body.productId || "").trim();
      const expiresAt = body.expiresAt ? String(body.expiresAt) : null;
      if (!productId || productId.length > 100) return json(request, { ok: false, error: "product_id_required" }, 400);
      if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) return json(request, { ok: false, error: "invalid_expiry" }, 400);
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const key = "JX-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare("INSERT INTO licenses (id, product_id, key_hash, status, allowed_place_ids, expires_at) VALUES (?, ?, ?, 'active', '[]', ?)")
          .bind(id, productId, await sha256Hex(key), expiresAt).run();
      } catch { return json(request, { ok: false, error: "license_create_failed" }, 503); }
      return json(request, { ok: true, id, productId, licenseKey: key, expiresAt, warning: "키는 이번 응답에서만 표시됩니다. 안전한 곳에 보관하세요." }, 201);
    }

    if (request.method === "POST" && url.pathname === "/api/licenses/revoke") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const id = String(parsed.value?.id || "").trim();
      if (!id) return json(request, { ok: false, error: "license_id_required" }, 400);
      try {
        const result = await env.DB.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ?").bind(id).run();
        if (!result.meta?.changes) return json(request, { ok: false, error: "license_not_found" }, 404);
        return json(request, { ok: true, status: "revoked" });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    // Keep the existing license-verification endpoint.
    if (request.method === "POST" && url.pathname === "/v1/license/verify") {
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(request, { ok: false, error: "invalid_body" }, 400);
      const productId = String(body.productId ?? "").trim();
      const licenseKey = String(body.licenseKey ?? "").trim();
      const placeId = String(body.placeId ?? "").trim();
      if (!productId || !licenseKey || !placeId || productId.length > 100 || licenseKey.length > 256 || placeId.length > 32) return json(request, { ok: false, error: "missing_or_invalid_fields" }, 400);
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const keyHash = await sha256Hex(licenseKey);
      let row;
      try { row = await env.DB.prepare("SELECT id, product_id, status, allowed_place_ids, expires_at FROM licenses WHERE key_hash = ? AND product_id = ? LIMIT 1").bind(keyHash, productId).first(); }
      catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      if (!row || row.status !== "active") return json(request, { ok: false, error: "invalid_license" }, 403);
      if (row.expires_at) { const expiry = Date.parse(row.expires_at); if (!Number.isFinite(expiry)) return json(request, { ok: false, error: "invalid_license_expiry" }, 403); if (expiry <= Date.now()) return json(request, { ok: false, error: "license_expired" }, 403); }
      let allowed; try { allowed = JSON.parse(row.allowed_place_ids || "[]"); } catch { allowed = []; }
      if (!Array.isArray(allowed) || !allowed.map(String).includes(placeId)) return json(request, { ok: false, error: "place_not_allowed" }, 403);
      try { await env.DB.prepare("UPDATE licenses SET last_verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run(); }
      catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      return json(request, { ok: true, productId, placeId, verifiedAt: new Date().toISOString() });
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && pathParts.length === 2 && pathParts[0] === "api") return scriptRoute(request, env, pathParts[1]);
    if (request.method === "GET" && pathParts.length === 2) return scriptRoute(request, env, pathParts[1]);
    if (request.method === "GET" && env.ASSETS) return env.ASSETS.fetch(request);
    return json(request, { ok: false, error: "not_found" }, 404);
  },
};
