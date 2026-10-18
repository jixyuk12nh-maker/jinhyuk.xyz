const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function cleanName(value) {
  return String(value || "").trim().slice(0, 80);
}

function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, b => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
}

function isValidId(id) {
  return /^[a-zA-Z0-9]{6,20}$/.test(id || "");
}

async function getScript(env, id) {
  const row = await env.DB.prepare(
    "SELECT id, name, source, created_at, updated_at FROM scripts WHERE id = ?"
  ).bind(id).first();
  return row || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400"
      }});
    }

    if (path === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "script-hosting-starter" });
    }

    if (path === "/api/scripts" && request.method === "GET") {
      const { results = [] } = await env.DB.prepare(
        "SELECT id, name, created_at, updated_at, length(source) AS size FROM scripts ORDER BY updated_at DESC LIMIT 100"
      ).all();
      return json({ ok: true, scripts: results });
    }

    if (path === "/api/scripts" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
      const name = cleanName(body.name);
      const source = typeof body.source === "string" ? body.source : "";
      if (!name) return json({ ok: false, error: "name_required" }, 400);
      if (!source.trim()) return json({ ok: false, error: "source_required" }, 400);
      if (new TextEncoder().encode(source).byteLength > 256 * 1024) return json({ ok: false, error: "source_too_large" }, 413);

      const id = makeId();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO scripts (id, name, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, name, source, now, now).run();

      return json({ ok: true, script: { id, name, url: `${url.origin}/raw/${id}`, created_at: now } }, 201);
    }

    const rawMatch = path.match(/^\/raw\/([a-zA-Z0-9]{6,20})$/);
    if (rawMatch && request.method === "GET") {
      const script = await getScript(env, rawMatch[1]);
      if (!script) return new Response("Script not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      return new Response(script.source, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "x-content-type-options": "nosniff"
        }
      });
    }

    const scriptMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9]{6,20})$/);
    if (scriptMatch) {
      const id = scriptMatch[1];
      if (request.method === "GET") {
        const script = await getScript(env, id);
        if (!script) return json({ ok: false, error: "not_found" }, 404);
        return json({ ok: true, script });
      }
      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
        const name = cleanName(body.name);
        const source = typeof body.source === "string" ? body.source : "";
        if (!name || !source.trim()) return json({ ok: false, error: "name_and_source_required" }, 400);
        if (new TextEncoder().encode(source).byteLength > 256 * 1024) return json({ ok: false, error: "source_too_large" }, 413);
        const now = new Date().toISOString();
        const result = await env.DB.prepare(
          "UPDATE scripts SET name = ?, source = ?, updated_at = ? WHERE id = ?"
        ).bind(name, source, now, id).run();
        if (!result.meta?.changes) return json({ ok: false, error: "not_found" }, 404);
        return json({ ok: true, script: { id, name, url: `${url.origin}/raw/${id}`, updated_at: now } });
      }
      if (request.method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM scripts WHERE id = ?").bind(id).run();
        if (!result.meta?.changes) return json({ ok: false, error: "not_found" }, 404);
        return json({ ok: true });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
