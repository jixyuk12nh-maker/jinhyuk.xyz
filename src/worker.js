const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function safeName(value) {
  return String(value ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 80);
}
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function corsHeaders(request) {
  const origin = request.headers.get('origin');
  // The admin UI is same-origin. No permissive cross-origin write access is enabled.
  return origin ? { vary: 'Origin' } : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'allow': 'GET,POST,PATCH,DELETE,OPTIONS' } });

    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({ ok: true, service: 'tm-lua-host', database: !!env.DB, storage: !!env.BUCKET, publicWriteEnabled: true });
      }

      if (path === '/api/scripts' && request.method === 'GET') {
        const { results = [] } = await env.DB.prepare('SELECT id, name, byte_size, sha256, created_at, updated_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 200').all();
        return json({ ok: true, scripts: results });
      }

      if (path.startsWith('/api/scripts')) {
        if (path === '/api/scripts' && request.method === 'POST') {
          const body = await request.json().catch(() => null);
          if (!body || typeof body.code !== 'string') return json({ ok: false, error: 'A code string is required.' }, 400);
          const name = safeName(body.name) || 'Untitled script';
          const maxBytes = Math.max(1024, Number(env.MAX_SCRIPT_BYTES || 524288));
          const byteSize = new TextEncoder().encode(body.code).byteLength;
          if (byteSize === 0) return json({ ok: false, error: 'Script cannot be empty.' }, 400);
          if (byteSize > maxBytes) return json({ ok: false, error: `Script exceeds ${maxBytes} bytes.` }, 413);
          const id = randomId();
          const objectKey = `scripts/${id}.lua`;
          const digest = await sha256(body.code);
          await env.BUCKET.put(objectKey, body.code, { httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' }, customMetadata: { scriptId: id, sha256: digest } });
          try {
            await env.DB.prepare('INSERT INTO hosted_scripts (id,name,object_key,byte_size,sha256) VALUES (?,?,?,?,?)').bind(id, name, objectKey, byteSize, digest).run();
          } catch (error) {
            await env.BUCKET.delete(objectKey);
            throw error;
          }
          return json({ ok: true, script: { id, name, byte_size: byteSize, sha256: digest, raw_url: `${url.origin}/raw/${id}` } }, 201);
        }
        const match = path.match(/^\/api\/scripts\/([a-zA-Z0-9_-]{8,40})$/);
        if (match && request.method === 'PATCH') {
          const id = match[1];
          const current = await env.DB.prepare('SELECT * FROM hosted_scripts WHERE id = ?').bind(id).first();
          if (!current) return json({ ok: false, error: 'Script not found.' }, 404);
          const body = await request.json().catch(() => null);
          if (!body || typeof body.code !== 'string') return json({ ok: false, error: 'A code string is required.' }, 400);
          const byteSize = new TextEncoder().encode(body.code).byteLength;
          const maxBytes = Math.max(1024, Number(env.MAX_SCRIPT_BYTES || 524288));
          if (!byteSize || byteSize > maxBytes) return json({ ok: false, error: `Script size must be between 1 and ${maxBytes} bytes.` }, 413);
          const name = safeName(body.name) || current.name;
          const digest = await sha256(body.code);
          await env.BUCKET.put(current.object_key, body.code, { httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' }, customMetadata: { scriptId: id, sha256: digest } });
          await env.DB.prepare("UPDATE hosted_scripts SET name=?, byte_size=?, sha256=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(name, byteSize, digest, id).run();
          return json({ ok: true, script: { id, name, byte_size: byteSize, sha256: digest, raw_url: `${url.origin}/raw/${id}` } });
        }
        if (match && request.method === 'DELETE') {
          const id = match[1];
          const current = await env.DB.prepare('SELECT object_key FROM hosted_scripts WHERE id=?').bind(id).first();
          if (!current) return json({ ok: false, error: 'Script not found.' }, 404);
          await env.BUCKET.delete(current.object_key);
          await env.DB.prepare('DELETE FROM hosted_scripts WHERE id=?').bind(id).run();
          return json({ ok: true, id });
        }
        return json({ ok: false, error: 'Method not allowed.' }, 405, { allow: 'GET, POST, PATCH, DELETE' });
      }

      const rawMatch = path.match(/^\/raw\/([a-zA-Z0-9_-]{8,40})$/);
      if (rawMatch && request.method === 'GET') {
        const id = rawMatch[1];
        const row = await env.DB.prepare('SELECT object_key, name, sha256 FROM hosted_scripts WHERE id=?').bind(id).first();
        if (!row) return new Response('Script not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
        const object = await env.BUCKET.get(row.object_key);
        if (!object) return new Response('Script content missing', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
        return new Response(object.body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename="${id}.lua"`, 'x-script-sha256': row.sha256 } });
      }

      if (path.startsWith('/api/')) return json({ ok: false, error: 'API route not found.' }, 404);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Worker request failed:', error);
      return json({ ok: false, error: 'Internal server error.' }, 500);
    }
  }
};
