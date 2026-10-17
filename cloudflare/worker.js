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
function authorized(request, env) {
  const expected = String(env.ADMIN_API_TOKEN || "");
  const supplied = request.headers.get("Authorization") || "";
  return expected.length >= 24 && supplied.startsWith("Bearer ") && supplied.slice(7) === expected;
}
async function readJson(request, maxBytes = 600 * 1024) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "request_too_large", status: 413 };
  try { return { value: JSON.parse(raw) }; } catch { return { error: "invalid_json", status: 400 }; }
}
async function scriptRoute(request, env, usernameRaw, scriptRaw) {
  const username = cleanSegment(usernameRaw, 40);
  const scriptName = cleanSegment(scriptRaw, 64);
  if (!username || !scriptName) return json(request, { ok: false, error: "invalid_script_path" }, 400);
  // Browser navigation is discouraged; this is not authentication because headers can be forged.
  const accept = request.headers.get("Accept") || "";
  if (accept.includes("text/html") && !accept.includes("application/json")) {
    return json(request, { ok: false, error: "loader_endpoint_only", message: "이 주소는 로더 전용 엔드포인트입니다." }, 403);
  }
  if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
  let row;
  try {
    row = await env.DB.prepare("SELECT username, script_name, protected_code, status FROM scripts WHERE username_key = ? AND script_key = ? LIMIT 1")
      .bind(username.toLowerCase(), scriptName.toLowerCase()).first();
  } catch {
    return json(request, { ok: false, error: "database_unavailable" }, 503);
  }
  if (!row || row.status !== "active") return json(request, { ok: false, error: "script_not_found" }, 404);
  return text(request, row.protected_code, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(request, { ok: true, service: "tm API", version: "1.1.0", database: Boolean(env.DB), scriptLoader: true });
    }

    if (request.method === "POST" && url.pathname === "/api/scripts") {
      if (!authorized(request, env)) return json(request, { ok: false, error: "unauthorized" }, 401);
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const parsed = await readJson(request);
      if (parsed.error) return json(request, { ok: false, error: parsed.error }, parsed.status);
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(request, { ok: false, error: "invalid_body" }, 400);
      const username = cleanSegment(String(body.username ?? ""), 40);
      const scriptName = cleanSegment(String(body.scriptName ?? ""), 64);
      const code = typeof body.protectedCode === "string" ? body.protectedCode : "";
      if (!username || !scriptName || !code.trim()) return json(request, { ok: false, error: "missing_or_invalid_fields" }, 400);
      if (new TextEncoder().encode(code).byteLength > 512 * 1024) return json(request, { ok: false, error: "script_too_large" }, 413);
      // Require output to look like Luau source, not an arbitrary HTML payload.
      if (/<\s*script\b/i.test(code) || /<!doctype\s+html/i.test(code)) return json(request, { ok: false, error: "invalid_script_content" }, 400);
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO scripts (id, username, username_key, script_name, script_key, protected_code, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
          ON CONFLICT(username_key, script_key) DO UPDATE SET username=excluded.username, script_name=excluded.script_name, protected_code=excluded.protected_code, status='active', updated_at=CURRENT_TIMESTAMP`)
          .bind(id, username, username.toLowerCase(), scriptName, scriptName.toLowerCase(), code).run();
      } catch {
        return json(request, { ok: false, error: "database_unavailable" }, 503);
      }
      return json(request, { ok: true, username, scriptName, url: `https://jinhyuk.xyz/${encodeURIComponent(username)}/${encodeURIComponent(scriptName)}`, note: "등록 완료. protectedCode에는 보호 처리가 끝난 Luau 코드가 필요합니다." }, 201);
    }

    if (request.method === "GET" && url.pathname === "/api/scripts") {
      if (!authorized(request, env)) return json(request, { ok: false, error: "unauthorized" }, 401);
      if (!env.DB) return json(request, { ok: false, error: "database_not_configured" }, 503);
      const username = cleanSegment(url.searchParams.get("username") || "", 40);
      if (!username) return json(request, { ok: false, error: "username_required" }, 400);
      try {
        const result = await env.DB.prepare("SELECT username, script_name AS scriptName, status, created_at AS createdAt, updated_at AS updatedAt FROM scripts WHERE username_key = ? ORDER BY updated_at DESC LIMIT 200").bind(username.toLowerCase()).all();
        return json(request, { ok: true, scripts: result.results || [] });
      } catch { return json(request, { ok: false, error: "database_unavailable" }, 503); }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/scripts/")) {
      if (!authorized(request, env)) return json(request, { ok: false, error: "unauthorized" }, 401);
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
    if (request.method === "GET" && pathParts.length === 2) return scriptRoute(request, env, pathParts[0], pathParts[1]);
    if (request.method === "GET" && env.ASSETS) return env.ASSETS.fetch(request);
    return json(request, { ok: false, error: "not_found" }, 404);
  },
};
