const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
const MAX_SOURCE_BYTES = 256 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function cleanName(value) { return String(value || "").trim().slice(0, 80); }
function makeId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
function isValidId(id) { return /^[a-zA-Z0-9]{6,20}$/.test(id || ""); }
function rawNotFound() {
  return new Response("Script not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
async function getScriptMeta(env, id) {
  return await env.DB.prepare(
    "SELECT id, name, object_key, size_bytes, created_at, updated_at FROM hosted_scripts WHERE id = ?"
  ).bind(id).first();
}
async function getScript(env, id) {
  const row = await getScriptMeta(env, id);
  if (!row) return null;
  const object = await env.SCRIPTS.get(row.object_key);
  if (!object) return null;
  return { ...row, source: await object.text() };
}
async function saveSource(env, key, source) {
  await env.SCRIPTS.put(key, source, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400"
        }});
      }
      if (path === "/api/health" && request.method === "GET") {
        let database = false, bucket = false;
        try { await env.DB.prepare("SELECT 1 AS ok").first(); database = true; } catch {}
        try { await env.SCRIPTS.list({ limit: 1 }); bucket = true; } catch {}
        return json({ ok: database && bucket, service: "tm", database, bucket });
      }
      if (path === "/api/scripts" && request.method === "GET") {
        const { results = [] } = await env.DB.prepare(
          "SELECT id, name, created_at, updated_at, size_bytes AS size FROM hosted_scripts ORDER BY updated_at DESC LIMIT 100"
        ).all();
        return json({ ok: true, scripts: results });
      }
      if (path === "/api/scripts" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
        const name = cleanName(body?.name);
        const source = typeof body?.source === "string" ? body.source : "";
        if (!name) return json({ ok: false, error: "name_required" }, 400);
        if (!source.trim()) return json({ ok: false, error: "source_required" }, 400);
        const size = new TextEncoder().encode(source).byteLength;
        if (size > MAX_SOURCE_BYTES) return json({ ok: false, error: "source_too_large" }, 413);
        const id = makeId();
        const key = `scripts/${id}.lua`;
        const now = new Date().toISOString();
        await saveSource(env, key, source);
        try {
          await env.DB.prepare("INSERT INTO hosted_scripts (id, name, object_key, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id, name, key, size, now, now).run();
        } catch (error) {
          await env.SCRIPTS.delete(key);
          throw error;
        }
        return json({ ok: true, script: { id, name, size, url: `${url.origin}/raw/${id}`, created_at: now } }, 201);
      }
      const rawMatch = path.match(/^\/raw\/([a-zA-Z0-9]{6,20})$/);
      if (rawMatch && request.method === "GET") {
        const script = await getScript(env, rawMatch[1]);
        if (!script) return rawNotFound();
        return new Response(script.source, { headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "x-content-type-options": "nosniff"
        }});
      }
      const scriptMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9]{6,20})$/);
      if (scriptMatch && isValidId(scriptMatch[1])) {
        const id = scriptMatch[1];
        if (request.method === "GET") {
          const script = await getScript(env, id);
          if (!script) return json({ ok: false, error: "not_found" }, 404);
          return json({ ok: true, script: { id: script.id, name: script.name, source: script.source, size: script.size_bytes, created_at: script.created_at, updated_at: script.updated_at } });
        }
        if (request.method === "PUT") {
          let body;
          try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
          const name = cleanName(body?.name);
          const source = typeof body?.source === "string" ? body.source : "";
          if (!name || !source.trim()) return json({ ok: false, error: "name_and_source_required" }, 400);
          const size = new TextEncoder().encode(source).byteLength;
          if (size > MAX_SOURCE_BYTES) return json({ ok: false, error: "source_too_large" }, 413);
          const current = await getScriptMeta(env, id);
          if (!current) return json({ ok: false, error: "not_found" }, 404);
          const now = new Date().toISOString();
          await saveSource(env, current.object_key, source);
          await env.DB.prepare("UPDATE hosted_scripts SET name = ?, size_bytes = ?, updated_at = ? WHERE id = ?")
            .bind(name, size, now, id).run();
          return json({ ok: true, script: { id, name, size, url: `${url.origin}/raw/${id}`, updated_at: now } });
        }
        if (request.method === "DELETE") {
          const current = await getScriptMeta(env, id);
          if (!current) return json({ ok: false, error: "not_found" }, 404);
          await env.DB.prepare("DELETE FROM hosted_scripts WHERE id = ?").bind(id).run();
          await env.SCRIPTS.delete(current.object_key);
          return json({ ok: true });
        }
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ ok: false, error: "internal_error" }, 500);
    }
  }
};
