const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "tm API", version: "1.0.0", database: Boolean(env.DB) });
    }

    if (request.method === "POST" && url.pathname === "/v1/license/verify") {
      let rawBody;
      try {
        rawBody = await request.text();
      } catch {
        return json({ ok: false, error: "invalid_body" }, 400);
      }
      if (new TextEncoder().encode(rawBody).byteLength > 4096) {
        return json({ ok: false, error: "request_too_large" }, 413);
      }
      let body;
      try { body = JSON.parse(rawBody); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ ok: false, error: "invalid_body" }, 400);
      }
      const productId = String(body.productId ?? "").trim();
      const licenseKey = String(body.licenseKey ?? "").trim();
      const placeId = String(body.placeId ?? "").trim();
      if (!productId || !licenseKey || !placeId || productId.length > 100 || licenseKey.length > 256 || placeId.length > 32) {
        return json({ ok: false, error: "missing_or_invalid_fields" }, 400);
      }
      if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
      const keyHash = await sha256Hex(licenseKey);
      let row;
      try {
        row = await env.DB.prepare(
          "SELECT id, product_id, status, allowed_place_ids, expires_at FROM licenses WHERE key_hash = ? AND product_id = ? LIMIT 1"
        ).bind(keyHash, productId).first();
      } catch {
        return json({ ok: false, error: "database_unavailable" }, 503);
      }
      if (!row || row.status !== "active") return json({ ok: false, error: "invalid_license" }, 403);
      if (row.expires_at) {
        const expiry = Date.parse(row.expires_at);
        if (!Number.isFinite(expiry)) return json({ ok: false, error: "invalid_license_expiry" }, 403);
        if (expiry <= Date.now()) return json({ ok: false, error: "license_expired" }, 403);
      }
      let allowed;
      try { allowed = JSON.parse(row.allowed_place_ids || "[]"); } catch { allowed = []; }
      if (!Array.isArray(allowed) || !allowed.map(String).includes(placeId)) return json({ ok: false, error: "place_not_allowed" }, 403);
      try {
        await env.DB.prepare("UPDATE licenses SET last_verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
      } catch {
        return json({ ok: false, error: "database_unavailable" }, 503);
      }
      return json({ ok: true, productId, placeId, verifiedAt: new Date().toISOString() });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
