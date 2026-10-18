import { compileAndPack } from "./compiler.js";
const SITE_ORIGINS = new Set(["https://jinhyuk.xyz", "https://www.jinhyuk.xyz"]);
const corsHeaders = (request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    ...(SITE_ORIGINS.has(origin) ? { "access-control-allow-origin": origin, "vary": "Origin" } : {}),
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
function randomHex(size = 16) {
  return [...crypto.getRandomValues(new Uint8Array(size))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function passwordHash(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (x) => parseInt(x, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
function cookieResponse(response, token, maxAge = 604800) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", `tm_session=${token || ""}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function requireAccount(request, env) {
  if (!env.DB) return { error: "database_not_configured", status: 503 };
  const token = cookieValue(request, "tm_session");
  if (!token) return { error: "login_required", status: 401 };
  try {
    const account = await env.DB.prepare("SELECT a.id, a.username, a.email, a.role, a.status, a.created_at AS createdAt FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP LIMIT 1").bind(await sha256Hex(token)).first();
    if (!account || account.status !== "active") return { error: "invalid_session", status: 401 };
    return account;
  } catch { return { error: "database_unavailable", status: 503 }; }
}
function withSession(response, token) {
  return cookieResponse(response, token, 604800);
}
function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S{24,512})$/i.exec(value);
  return match ? match[1] : null;
}
async function requireDeveloper(request, env) {
  if (!env.DB) return { error: "database_not_configured", status: 503 };
  const token = bearerToken(request);
  if (!token) return { error: "authentication_required", status: 401 };
  try {
    const developer = await env.DB.prepare("SELECT id, username, username_key, role, status FROM developers WHERE token_hash = ? LIMIT 1")
      .bind(await sha256Hex(token)).first();
    if (!developer || developer.status !== "active" || !["developer", "admin"].includes(developer.role)) return { error: "invalid_credentials", status: 401 };
    return developer;
  } catch { return { error: "database_unavailable", status: 503 }; }
}
function randomSecret(prefix = "tm_dev_") {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
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
function loaderBootstrap(username, scriptName, mode) {
  const safeUsername = JSON.stringify(username);
  const safeName = JSON.stringify(scriptName);
  const base = 'https://jinhyuk.xyz';
  if (mode === 'key') {
    return `local HttpService = game:GetService("HttpService")\nlocal username = ${safeUsername}\nlocal scriptName = ${safeName}\nlocal key = rawget(_G, "Script_key") or rawget(getgenv and getgenv() or {}, "Script_key")\nif type(key) ~= "string" or key == "" then error("[Jinhyuk] Script_key is missing", 0) end\nlocal body = HttpService:JSONEncode({username = username, scriptName = scriptName, licenseKey = key, placeId = tostring(game.PlaceId)})\nlocal req = (syn and syn.request) or (http and http.request) or request or http_request\nif type(req) ~= "function" then error("[Jinhyuk] This executor does not support authenticated requests", 0) end\nlocal response = req({Url = "${base}/api/loader/resolve", Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = body})\nif not response or (response.StatusCode and response.StatusCode ~= 200) then error("[Jinhyuk] License verification failed", 0) end\nlocal result = HttpService:JSONDecode(response.Body or "{}")\nif result.ok ~= true or type(result.code) ~= "string" then error("[Jinhyuk] License verification failed", 0) end\nlocal run = loadstring(result.code)\nif not run then error("[Jinhyuk] Script compilation failed", 0) end\nreturn run()\n`;
  }
  return `local HttpService = game:GetService("HttpService")\nlocal response = game:HttpGet("${base}/api/loader/resolve?username=" .. HttpService:UrlEncode(${safeUsername}) .. "&name=" .. HttpService:UrlEncode(${safeName}))\nlocal result = HttpService:JSONDecode(response)\nif result.ok ~= true or type(result.code) ~= "string" then error("[Jinhyuk] Script unavailable", 0) end\nlocal run = loadstring(result.code)\nif not run then error("[Jinhyuk] Script compilation failed", 0) end\nreturn run()\n`;
}
async function scriptRoute(request, env, scriptRaw, usernameRaw = null) {
  const scriptName = cleanSegment(scriptRaw, 64);
  const username = usernameRaw === null ? null : cleanSegment(usernameRaw, 40);
  if (!scriptName || (usernameRaw !== null && !username)) return json(request, { ok: false, error: "invalid_script_path" }, 400);
  if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
  let rows;
  try {
    rows = username
      ? await env.DB.prepare("SELECT developer_id, username, username_key, script_name, loader_mode, status FROM scripts WHERE username_key = ? AND script_key = ? LIMIT 2").bind(username.toLowerCase(), scriptName.toLowerCase()).all()
      : await env.DB.prepare("SELECT developer_id, username, username_key, script_name, loader_mode, status FROM scripts WHERE script_key = ? LIMIT 2").bind(scriptName.toLowerCase()).all();
  } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
  const matches = rows.results || [];
  if (matches.length !== 1 || matches[0].status !== "active") return json(request, { ok: false, error: matches.length > 1 ? "script_name_ambiguous" : "script_not_found" }, matches.length > 1 ? 409 : 404);
  await logRequest(env, matches[0].developer_id, scriptName, "loader_requested", request);
  return text(request, loaderBootstrap(matches[0].username_key || matches[0].username, matches[0].script_name, matches[0].loader_mode || "keyless"), 200);
}
async function logRequest(env, developerId, scriptName, eventType, request) {
  try {
    await env.DB.prepare("INSERT INTO loader_events (id, developer_id, script_name, event_type, country, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), developerId || null, scriptName, eventType, request.cf?.country || null).run();
  } catch {  }
}
async function resolveLoader(request, env) {
  if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
  let parsed = { value: {} };
  if (request.method === "POST") parsed = await readJson(request, 4096);
  if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
  const query = new URL(request.url).searchParams;
  const name = cleanSegment(String(request.method === "GET" ? query.get("name") || "" : parsed.value.scriptName || ""), 64);
  const username = cleanSegment(String(request.method === "GET" ? query.get("username") || "" : parsed.value.username || ""), 40);
  const licenseKey = String(parsed.value.licenseKey || "").trim();
  if (!name) return json(request, { ok: false, error: "script_name_required" }, 400);
  if (!username) return json(request, { ok: false, error: "script_username_required" }, 400);
  let rows;
  try { rows = await env.DB.prepare("SELECT id, developer_id, username_key, script_key, script_name, protected_code, status, loader_mode, product_id FROM scripts WHERE username_key = ? AND script_key = ? LIMIT 2").bind(username.toLowerCase(), name.toLowerCase()).all(); }
  catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
  const matches = rows.results || [];
  if (matches.length !== 1) return json(request, { ok: false, error: matches.length > 1 ? "script_name_ambiguous" : "script_not_found" }, matches.length > 1 ? 409 : 404);
  const script = matches[0];
  if (script.status !== "active") return json(request, { ok: false, error: "script_disabled" }, 403);
  if (script.product_id) {
    try {
      const product = await env.DB.prepare("SELECT status FROM products WHERE product_id = ? LIMIT 1").bind(script.product_id).first();
      if (!product || product.status !== "active") return json(request, { ok: false, error: "product_disabled" }, 403);
    } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
  }
  if ((script.loader_mode || "keyless") === "key" || script.product_id) {
    if (!licenseKey) { await logRequest(env, script.developer_id, name, "license_missing", request); return json(request, { ok: false, error: "license_required" }, 403); }
    const keyHash = await sha256Hex(licenseKey);
    let license;
    try { license = await env.DB.prepare("SELECT id, status, allowed_place_ids, expires_at FROM licenses WHERE key_hash = ? AND product_id = ? LIMIT 1").bind(keyHash, script.product_id || script.id).first(); }
    catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    if (!license || license.status !== "active") { await logRequest(env, script.developer_id, name, "license_invalid", request); return json(request, { ok: false, error: "invalid_license" }, 403); }
    if (license.expires_at && Date.parse(license.expires_at) <= Date.now()) { await logRequest(env, script.developer_id, name, "license_expired", request); return json(request, { ok: false, error: "license_expired" }, 403); }
    let allowedPlaceIds;
    try {
      allowedPlaceIds = JSON.parse(license.allowed_place_ids || "[]");
      if (!Array.isArray(allowedPlaceIds) || allowedPlaceIds.some((id) => !/^\d{1,32}$/.test(String(id)))) throw new Error("invalid place list");
    } catch {
      await logRequest(env, script.developer_id, name, "license_place_config_invalid", request);
      return json(request, { ok: false, error: "invalid_license_place_config" }, 403);
    }
    const placeId = String(parsed.value.placeId || "").trim();
    if (allowedPlaceIds.length && (!/^\d{1,32}$/.test(placeId) || !allowedPlaceIds.map(String).includes(placeId))) {
      await logRequest(env, script.developer_id, name, "license_place_denied", request);
      return json(request, { ok: false, error: "place_not_allowed" }, 403);
    }
    try { await env.DB.prepare("UPDATE licenses SET last_verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(license.id).run(); } catch {}
  }
  let code = script.protected_code || "";
  if (env.BUCKET) {
    const objectKey = `scripts/${script.username_key}/${script.script_key}.lua`;
    try {
      const object = await env.BUCKET.get(objectKey);
      if (object) code = await object.text();
      else if (!code) {
        await logRequest(env, script.developer_id, name, "script_storage_missing", request);
        return json(request, { ok: false, error: "script_storage_missing" }, 503);
      }
    } catch {
      await logRequest(env, script.developer_id, name, "script_storage_unavailable", request);
      return json(request, { ok: false, error: "r2_storage_unavailable" }, 503);
    }
  }
  if (!code) return json(request, { ok: false, error: "script_content_empty" }, 503);
  await logRequest(env, script.developer_id, name, "script_delivered", request);
  return json(request, { ok: true, scriptName: script.script_name, code });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(request, { ok: true, service: "tm API", version: "1.2.0", database: Boolean(env.DB), r2Storage: Boolean(env.BUCKET), scriptLoader: true });
    }

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request, 8192);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value || {};
      const username = cleanSegment(String(body.username || ""), 40);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = body.role === "admin" ? "admin" : body.role === "user" ? "user" : null;
      if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 10 || password.length > 128 || !role) return json(request, { ok: false, error: "invalid_signup_fields", message: "사용자 이름, 이메일, 10~128자 비밀번호와 역할을 확인하세요." }, 400);
      const salt = randomHex(16);
      const hash = await passwordHash(password, salt);
      const accountId = crypto.randomUUID();
      const sessionToken = randomSecret("tm_session_");
      const sessionId = crypto.randomUUID();
      try {
        await env.DB.prepare("INSERT INTO accounts (id, username, username_key, email, password_hash, password_salt, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')")
          .bind(accountId, username, username.toLowerCase(), email, hash, salt, role).run();
        await env.DB.prepare("INSERT INTO sessions (id, account_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))")
          .bind(sessionId, accountId, await sha256Hex(sessionToken)).run();
        const response = json(request, { ok: true, account: { id: accountId, username, email, role, status: "active" }, betaNotice: role === "admin" ? "베타 설정: 공개 회원가입에서 관리자 역할을 선택할 수 있습니다." : undefined }, 201);
        return withSession(response, sessionToken);
      } catch (error) {
        const message = String(error?.message || "");
        return json(request, { ok: false, error: message.includes("UNIQUE") ? "account_already_exists" : "account_create_failed" }, message.includes("UNIQUE") ? 409 : 503);
      }
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request, 8192);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const email = String(parsed.value?.email || "").trim().toLowerCase();
      const password = String(parsed.value?.password || "");
      if (!email || !password || password.length > 128) return json(request, { ok: false, error: "invalid_credentials" }, 400);
      try {
        const row = await env.DB.prepare("SELECT id, username, email, password_hash, password_salt, role, status, created_at AS createdAt FROM accounts WHERE email = ? LIMIT 1").bind(email).first();
        if (!row || row.status !== "active" || await passwordHash(password, row.password_salt) !== row.password_hash) return json(request, { ok: false, error: "invalid_credentials" }, 401);
        const token = randomSecret("tm_session_");
        await env.DB.prepare("INSERT INTO sessions (id, account_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))").bind(crypto.randomUUID(), row.id, await sha256Hex(token)).run();
        const response = json(request, { ok: true, account: { id: row.id, username: row.username, email: row.email, role: row.role, status: row.status, createdAt: row.createdAt } });
        return withSession(response, token);
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const token = cookieValue(request, "tm_session");
      if (env.DB && token) {
        try { await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run(); } catch {}
      }
      return cookieResponse(json(request, { ok: true }), "", 0);
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const account = await requireAccount(request, env);
      if (account.error) return json(request, { ok: true, authenticated: false });
      return json(request, { ok: true, authenticated: true, account });
    }

    if (url.pathname === "/api/account/api-token" && request.method === "POST") {
      const account = await requireAccount(request, env);
      if (account.error) return json(request, { ok: false, error: account.error }, account.status);
      const token = randomSecret();
      try {
        const existing = await env.DB.prepare("SELECT id FROM developers WHERE account_id = ? LIMIT 1").bind(account.id).first();
        if (existing) {
          await env.DB.prepare("UPDATE developers SET username = ?, username_key = ?, token_hash = ?, role = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(account.username, account.username.toLowerCase(), await sha256Hex(token), account.role === "admin" ? "admin" : "developer", existing.id).run();
        } else {
          await env.DB.prepare("INSERT INTO developers (id, account_id, username, username_key, token_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')")
            .bind(crypto.randomUUID(), account.id, account.username, account.username.toLowerCase(), await sha256Hex(token), account.role === "admin" ? "admin" : "developer").run();
        }
        return json(request, { ok: true, apiToken: token, role: account.role === "admin" ? "admin" : "developer", warning: "새 API 키는 이번 응답에서만 표시됩니다. 재발급하면 이전 키는 즉시 무효화됩니다." }, 201);
      } catch { return json(request, { ok: false, error: "api_token_issue_failed" }, 503); }
    }

    if (url.pathname === "/api/account/admin/users" && request.method === "GET") {
      const account = await requireAccount(request, env);
      if (account.error) return json(request, { ok: false, error: account.error }, account.status);
      if (account.role !== "admin") return json(request, { ok: false, error: "admin_role_required" }, 403);
      try {
        const result = await env.DB.prepare("SELECT id, username, email, role, status, created_at AS createdAt FROM accounts ORDER BY created_at DESC LIMIT 500").all();
        return json(request, { ok: true, users: result.results || [] });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    const accountStatusMatch = /^\/api\/account\/admin\/users\/([0-9a-f-]{36})\/status$/.exec(url.pathname);
    if (accountStatusMatch && request.method === "POST") {
      const account = await requireAccount(request, env);
      if (account.error) return json(request, { ok: false, error: account.error }, account.status);
      if (account.role !== "admin") return json(request, { ok: false, error: "admin_role_required" }, 403);
      if (account.id === accountStatusMatch[1]) return json(request, { ok: false, error: "cannot_disable_self" }, 400);
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const status = parsed.value?.status;
      if (!["active", "disabled"].includes(status)) return json(request, { ok: false, error: "invalid_status" }, 400);
      try {
        const result = await env.DB.prepare("UPDATE accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, accountStatusMatch[1]).run();
        if (!result.meta?.changes) return json(request, { ok: false, error: "user_not_found" }, 404);
        await env.DB.prepare("UPDATE developers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?").bind(status, accountStatusMatch[1]).run();
        if (status === "disabled") await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountStatusMatch[1]).run();
        return json(request, { ok: true, status });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (request.method === "GET" && url.pathname === "/api/products") {
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      try {
        const result = await env.DB.prepare("SELECT product_id AS productId, name, status, script_id AS scriptId, created_at AS createdAt, updated_at AS updatedAt FROM products WHERE developer_id = ? ORDER BY created_at DESC LIMIT 500").bind(developer.id).all();
        return json(request, { ok: true, products: result.results || [] });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    const productMatch = /^\/api\/products\/([^/]+)$/.exec(url.pathname);
    if (productMatch && request.method === "PATCH") {
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      let productId;
      try { productId = decodeURIComponent(productMatch[1]); } catch { return json(request, { ok: false, error: "invalid_product_id" }, 400); }
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const name = parsed.value?.name === undefined ? null : String(parsed.value.name).trim().slice(0, 100);
      const status = parsed.value?.status === undefined ? null : parsed.value.status;
      if ((name !== null && !name) || (status !== null && !["active", "disabled"].includes(status)) || (name === null && status === null)) return json(request, { ok: false, error: "invalid_product_update" }, 400);
      try {
        const current = await env.DB.prepare("SELECT product_id FROM products WHERE product_id = ? AND developer_id = ? LIMIT 1").bind(productId, developer.id).first();
        if (!current) return json(request, { ok: false, error: "product_not_found_or_forbidden" }, 404);
        await env.DB.prepare("UPDATE products SET name = COALESCE(?, name), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND developer_id = ?").bind(name, status, productId, developer.id).run();
        return json(request, { ok: true });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (request.method === "GET" && url.pathname === "/api/analytics") {
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      try {
        const scripts = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM scripts WHERE developer_id = ?").bind(developer.id).first();
        const products = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM products WHERE developer_id = ?").bind(developer.id).first();
        const licenses = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM licenses WHERE product_id IN (SELECT product_id FROM products WHERE developer_id = ?)").bind(developer.id).first();
        const events = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN event_type = 'script_delivered' THEN 1 ELSE 0 END) AS delivered FROM loader_events WHERE developer_id = ?").bind(developer.id).first();
        return json(request, { ok: true, scripts: scripts || { total: 0, active: 0 }, products: products || { total: 0, active: 0 }, licenses: licenses || { total: 0, active: 0 }, loaderEvents: events || { total: 0, delivered: 0 } });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (url.pathname.startsWith("/api/admin/")) {
      const administrator = await requireDeveloper(request, env);
      if (administrator.error) return json(request, { ok: false, error: administrator.error }, administrator.status);
      if (administrator.role !== "admin") return json(request, { ok: false, error: "admin_role_required" }, 403);
      if (request.method === "POST" && url.pathname === "/api/admin/developers") {
        if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
        const parsed = await readJson(request, 4096);
        if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
        const username = cleanSegment(String(parsed.value?.username || ""), 40);
        if (!username) return json(request, { ok: false, error: "invalid_username" }, 400);
        const token = randomSecret();
        const id = crypto.randomUUID();
        try {
          await env.DB.prepare("INSERT INTO developers (id, username, username_key, token_hash, role, status) VALUES (?, ?, ?, ?, 'developer', 'active')")
            .bind(id, username, username.toLowerCase(), await sha256Hex(token)).run();
          return json(request, { ok: true, developer: { id, username, role: "developer", status: "active" }, apiToken: token, warning: "API token is shown once. Store it securely." }, 201);
        } catch { return json(request, { ok: false, error: "developer_create_failed" }, 409); }
      }
      if (request.method === "GET" && url.pathname === "/api/admin/developers") {
        if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
        try {
          const result = await env.DB.prepare("SELECT id, username, role, status, created_at AS createdAt FROM developers ORDER BY created_at DESC LIMIT 500").all();
          return json(request, { ok: true, developers: result.results || [] });
        } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      }
      const match = /^\/api\/admin\/developers\/([0-9a-f-]{36})\/status$/.exec(url.pathname);
      if (request.method === "POST" && match) {
        const parsed = await readJson(request, 4096);
        if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
        const status = parsed.value?.status;
        if (!["active", "disabled"].includes(status)) return json(request, { ok: false, error: "invalid_status" }, 400);
        try {
          const result = await env.DB.prepare("UPDATE developers SET status = ? WHERE id = ?").bind(status, match[1]).run();
          if (!result.meta?.changes) return json(request, { ok: false, error: "developer_not_found" }, 404);
          return json(request, { ok: true, status });
        } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      }
      const rotateMatch = /^\/api\/admin\/developers\/([0-9a-f-]{36})\/rotate-token$/.exec(url.pathname);
      if (request.method === "POST" && rotateMatch) {
        if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
        const token = randomSecret();
        try {
          const result = await env.DB.prepare("UPDATE developers SET token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(await sha256Hex(token), rotateMatch[1]).run();
          if (!result.meta?.changes) return json(request, { ok: false, error: "developer_not_found" }, 404);
          return json(request, { ok: true, apiToken: token, warning: "Previous developer token is now invalid. Store this token securely; it is shown once." });
        } catch { return json(request, { ok: false, error: "token_rotation_failed" }, 503); }
      }
      return json(request, { ok: false, error: "not_found" }, 404);
    }

    if (request.method === "POST" && url.pathname === "/api/scripts") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(request, { ok: false, error: "invalid_body" }, 400);
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      const username = developer.username;
      const scriptName = cleanSegment(String(body.scriptName ?? ""), 64);
      const sourceCode = typeof body.sourceCode === "string" ? body.sourceCode : "";
      const loaderMode = body.loaderMode === "key" ? "key" : "keyless";
      const productId = typeof body.productId === "string" && body.productId.trim() ? body.productId.trim().slice(0, 100) : null;
      if (!username || !scriptName || !sourceCode.trim()) return json(request, { ok: false, error: "missing_or_invalid_fields" }, 400);
      if (new TextEncoder().encode(sourceCode).byteLength > 512 * 1024) return json(request, { ok: false, error: "script_too_large" }, 413);
      let code;
      try {
        code = compileAndPack(sourceCode, `${scriptName}.lua`);
      } catch (error) {
        const message = String(error?.message || "compile_failed").slice(0, 500);
        return json(request, { ok: false, error: "compile_failed", message }, 400);
      }
      if (new TextEncoder().encode(code).byteLength > 1024 * 1024) return json(request, { ok: false, error: "compiled_script_too_large" }, 413);
      let id = crypto.randomUUID();
      const usernameKey = username.toLowerCase();
      const scriptKey = scriptName.toLowerCase();
      try {
        const existing = await env.DB.prepare("SELECT id, developer_id FROM scripts WHERE username_key = ? AND script_key = ? LIMIT 1").bind(usernameKey, scriptKey).first();
        if (existing && existing.developer_id && existing.developer_id !== developer.id) return json(request, { ok: false, error: "script_owned_by_another_developer" }, 403);
        if (existing && !existing.developer_id) return json(request, { ok: false, error: "legacy_script_owner_migration_required" }, 409);
        if (existing) id = existing.id;
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      if (loaderMode === "key" && productId) {
        try {
          const existingProduct = await env.DB.prepare("SELECT developer_id, script_id FROM products WHERE product_id = ? LIMIT 1").bind(productId).first();
          if (existingProduct && existingProduct.developer_id !== developer.id) return json(request, { ok: false, error: "product_id_owned_by_another_developer" }, 403);
          if (existingProduct && existingProduct.script_id !== id) return json(request, { ok: false, error: "product_id_already_linked_to_another_script" }, 409);
        } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      }
      const objectKey = `scripts/${usernameKey}/${scriptKey}.lua`;
      let storedInR2 = false;
      
      
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
        const resolvedProductId = loaderMode === "key" ? (productId || id) : null;
        await env.DB.prepare(`INSERT INTO scripts (id, developer_id, username, username_key, script_name, script_key, protected_code, status, loader_mode, product_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(username_key, script_key) DO UPDATE SET developer_id=excluded.developer_id, username=excluded.username, script_name=excluded.script_name, protected_code=excluded.protected_code, status='active', loader_mode=excluded.loader_mode, product_id=excluded.product_id, updated_at=CURRENT_TIMESTAMP`)
          .bind(id, developer.id, username, usernameKey, scriptName, scriptKey, storedInR2 ? "" : code, loaderMode, resolvedProductId).run();
        if (resolvedProductId) {
          await env.DB.prepare(`INSERT INTO products (product_id, developer_id, script_id, name, status) VALUES (?, ?, ?, ?, 'active')
            ON CONFLICT(product_id) DO UPDATE SET developer_id=excluded.developer_id, script_id=excluded.script_id, name=excluded.name, status='active'`)
            .bind(resolvedProductId, developer.id, id, scriptName).run();
        }
      } catch {
        
        return json(request, { ok: false, error: "database_unavailable" }, 503);
      }
      return json(request, { ok: true, username, scriptName, loaderMode, storage: storedInR2 ? "r2" : "d1_fallback", productId: productId || id, url: `https://jinhyuk.xyz/api/${encodeURIComponent(username)}/${encodeURIComponent(scriptName)}`, protected: true, compiler: "worker-js-lgvm", note: storedInR2 ? "컴파일 및 VM 패키징 완료. 보호된 Luau 코드가 R2에 저장되었습니다." : "컴파일 및 VM 패키징 완료. R2 바인딩이 없어 D1에 저장되었습니다." }, 201);
    }

    if (request.method === "GET" && url.pathname === "/api/scripts") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      try {
        const result = await env.DB.prepare("SELECT username, script_name AS scriptName, status, created_at AS createdAt, updated_at AS updatedAt FROM scripts WHERE developer_id = ? ORDER BY updated_at DESC LIMIT 200").bind(developer.id).all();
        return json(request, { ok: true, scripts: result.results || [] });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/scripts/")) {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      const parts = url.pathname.split("/").slice(3);
      if (parts.length !== 2) return json(request, { ok: false, error: "invalid_script_path" }, 400);
      const username = cleanSegment(parts[0], 40), scriptName = cleanSegment(parts[1], 64);
      if (!username || !scriptName || username.toLowerCase() !== developer.username_key) return json(request, { ok: false, error: "forbidden" }, 403);
      try {
        const result = await env.DB.prepare("UPDATE scripts SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE developer_id = ? AND username_key = ? AND script_key = ?").bind(developer.id, username.toLowerCase(), scriptName.toLowerCase()).run();
        if (!result.meta?.changes) return json(request, { ok: false, error: "script_not_found" }, 404);
        return json(request, { ok: true, status: "disabled" });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/loader/resolve") return resolveLoader(request, env);

    if (request.method === "POST" && url.pathname === "/api/licenses") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value || {};
      const productId = String(body.productId || "").trim();
      const expiresAt = body.expiresAt ? String(body.expiresAt) : null;
      const allowedPlaceIds = body.allowedPlaceIds === undefined ? [] : body.allowedPlaceIds;
      if (!productId || productId.length > 100) return json(request, { ok: false, error: "product_id_required" }, 400);
      try {
        const owned = await env.DB.prepare("SELECT product_id FROM products WHERE product_id = ? AND developer_id = ? AND status = 'active' LIMIT 1").bind(productId, developer.id).first();
        if (!owned) return json(request, { ok: false, error: "product_not_found_or_forbidden" }, 403);
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      if (!Array.isArray(allowedPlaceIds) || allowedPlaceIds.length > 100 || allowedPlaceIds.some((id) => !/^\d{1,32}$/.test(String(id)))) return json(request, { ok: false, error: "invalid_allowed_place_ids" }, 400);
      const normalizedPlaceIds = [...new Set(allowedPlaceIds.map(String))];
      if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) return json(request, { ok: false, error: "invalid_expiry" }, 400);
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const key = "JX-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare("INSERT INTO licenses (id, product_id, key_hash, status, allowed_place_ids, expires_at) VALUES (?, ?, ?, 'active', ?, ?)")
          .bind(id, productId, await sha256Hex(key), JSON.stringify(normalizedPlaceIds), expiresAt).run();
      } catch { return json(request, { ok: false, error: "license_create_failed" }, 503); }
      return json(request, { ok: true, id, productId, licenseKey: key, allowedPlaceIds: normalizedPlaceIds, expiresAt, warning: "키는 이번 응답에서만 표시됩니다. 안전한 곳에 보관하세요." }, 201);
    }

    if (request.method === "POST" && url.pathname === "/api/licenses/revoke") {
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const developer = await requireDeveloper(request, env);
      if (developer.error) return json(request, { ok: false, error: developer.error }, developer.status);
      const parsed = await readJson(request, 4096);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const id = String(parsed.value?.id || "").trim();
      if (!id) return json(request, { ok: false, error: "license_id_required" }, 400);
      try {
        const result = await env.DB.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ? AND product_id IN (SELECT product_id FROM products WHERE developer_id = ?)").bind(id, developer.id).run();
        if (!result.meta?.changes) return json(request, { ok: false, error: "license_not_found" }, 404);
        return json(request, { ok: true, status: "revoked" });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    
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
      try {
        const product = await env.DB.prepare("SELECT status FROM products WHERE product_id = ? LIMIT 1").bind(productId).first();
        if (!product || product.status !== "active") return json(request, { ok: false, error: "product_disabled" }, 403);
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      if (row.expires_at) { const expiry = Date.parse(row.expires_at); if (!Number.isFinite(expiry)) return json(request, { ok: false, error: "invalid_license_expiry" }, 403); if (expiry <= Date.now()) return json(request, { ok: false, error: "license_expired" }, 403); }
      let allowed;
      try {
        allowed = JSON.parse(row.allowed_place_ids || "[]");
        if (!Array.isArray(allowed) || allowed.some((id) => !/^\d{1,32}$/.test(String(id)))) throw new Error("invalid place list");
      } catch { return json(request, { ok: false, error: "invalid_license_place_config" }, 403); }
      if (allowed.length && !allowed.map(String).includes(placeId)) return json(request, { ok: false, error: "place_not_allowed" }, 403);
      try { await env.DB.prepare("UPDATE licenses SET last_verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run(); }
      catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
      return json(request, { ok: true, productId, placeId, verifiedAt: new Date().toISOString() });
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && pathParts.length === 3 && pathParts[0] === "api") return scriptRoute(request, env, pathParts[2], pathParts[1]);
    if (request.method === "GET" && pathParts.length === 2 && pathParts[0] === "api") return scriptRoute(request, env, pathParts[1]);
    if (request.method === "GET" && pathParts.length === 2) return scriptRoute(request, env, pathParts[1], pathParts[0]);
    if (request.method === "GET" && env.ASSETS) return env.ASSETS.fetch(request);
    return json(request, { ok: false, error: "not_found" }, 404);
  },
};
