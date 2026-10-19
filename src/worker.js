const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const OBJECT_META = { httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' } };
const ROLES = ['owner', 'admin', 'user'];
const MODES = ['keyless', 'key'];
const POLICIES = ['open', 'closed'];
const KEY_STATUSES = ['active', 'suspended'];
const RESERVED = ['api', 'raw', 'assets', 'favicon.ico', 'robots.txt'];
const SLUG_RE = /^[\p{L}\p{N}_-]{1,56}(\.lua)?$/u;
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (status, error) => json({ ok: false, error }, status);
const plain = (body, status) => new Response(body, { status, headers: TEXT_HEADERS });
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (value) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const randomHex = (bytes = 12) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const newSecret = (prefix) => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const safeName = (value) => String(value ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 80);
const normalizeSlug = (value) => String(value ?? '').trim().normalize('NFC').toLowerCase();
const safeSlug = (value) => {
  let v = normalizeSlug(value);
  const lua = v.endsWith('.lua');
  if (lua) v = v.slice(0, -4);
  v = v.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 56);
  return v ? (lua ? `${v}.lua` : v) : '';
};
const slugFromPath = (pathname) => {
  let value;
  try {
    value = normalizeSlug(decodeURIComponent(pathname.slice(1)));
  } catch {
    return null;
  }
  return SLUG_RE.test(value) && !RESERVED.includes(value) ? value : null;
};
const publicUrl = (origin, slug) => `${origin}/${slug}`;
const contentDisposition = (slug) => {
  const name = slug.endsWith('.lua') ? slug : `${slug}.lua`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};
const keyStub = (slug) => `local request_fn = (syn and syn.request) or (http and http.request) or http_request or request
assert(request_fn, "이 실행기는 request 함수를 지원하지 않습니다")
assert(type(script_key) == "string" and script_key ~= "", "script_key를 먼저 설정하세요")
local hwid = "unknown"
pcall(function() hwid = game:GetService("RbxAnalyticsService"):GetClientId() end)
local response = request_fn({
	Url = "https://jinhyuk.xyz/api/key-run",
	Method = "POST",
	Headers = { ["Content-Type"] = "application/json" },
	Body = '{"slug":"${slug}","key":"' .. script_key .. '","hwid":"' .. hwid .. '"}'
})
assert(response and response.StatusCode == 200, "스크립트 키 검증에 실패했습니다")
local data = game:GetService("HttpService"):JSONDecode(response.Body)
loadstring(data.code)()
`;
const safeUsername = (value) => {
  const v = String(value ?? '').trim();
  return /^[A-Za-z0-9_.-]{2,40}$/.test(v) ? v : null;
};
const maxBytes = (env) => Math.max(1024, Number(env.MAX_SCRIPT_BYTES || 524288));
const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const readBody = (request) => request.json().catch(() => null);
const isExpired = (iso) => !!iso && Date.parse(iso) <= Date.now();
const isBrowserNavigation = (request) =>
  request.headers.get('sec-fetch-mode') === 'navigate' || request.headers.get('sec-fetch-dest') === 'document';
const expiresFromDays = (value) => {
  if (value === undefined || value === null) return { ok: true, expiresAt: null };
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false };
  return { ok: true, expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
};
const scopeAllows = (actor, holderRole) => actor.role === 'owner' || (actor.role === 'admin' && holderRole === 'user');

async function authenticate(request, env) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(tmk_[A-Za-z0-9_-]{20,})$/);
  if (!match) return null;
  const row = await env.DB.prepare(
    `SELECT k.id AS key_id, k.expires_at, k.revoked_at, u.id AS user_id, u.username, u.role, u.status
     FROM api_keys k JOIN api_users u ON u.id = k.user_id WHERE k.key_hash = ?`
  ).bind(await sha256Hex(match[1])).first();
  if (!row || row.revoked_at || row.status !== 'active' || isExpired(row.expires_at)) return null;
  await env.DB.prepare(`UPDATE api_keys SET last_used_at = ${NOW_SQL} WHERE id = ?`).bind(row.key_id).run();
  return { user: { id: row.user_id, username: row.username, role: row.role }, keyId: row.key_id };
}

async function audit(env, request, auth, action, target, status) {
  try {
    await env.DB.prepare('INSERT INTO api_audit_logs (user_id, key_id, action, target, status, ip) VALUES (?,?,?,?,?,?)')
      .bind(auth?.user.id ?? null, auth?.keyId ?? null, action, target ?? null, status, request.headers.get('cf-connecting-ip')).run();
  } catch (error) {
    console.error('Audit write failed:', error);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET,POST,PATCH,DELETE,OPTIONS' } });
    try {
      if (path === '/api/health' && method === 'GET') return health(env);
      if (path === '/api/auth/signup' && method === 'POST') return signup(request, env, await readBody(request));
      if (path === '/api/key-run' && method === 'POST') return keyRun(request, env, await readBody(request));
      if (path.startsWith('/api/')) return await handleApi(request, env, url);
      const rawId = path.match(/^\/raw\/([A-Za-z0-9_-]{8,40})$/);
      if (rawId && method === 'GET') return await serveRaw(request, env, 'id', rawId[1]);
      const slug = slugFromPath(path);
      if (slug && method === 'GET') return await serveRaw(request, env, 'slug', slug);
      return env.ASSETS ? env.ASSETS.fetch(request) : plain('Not found', 404);
    } catch (error) {
      console.error('Worker request failed:', error);
      return json({ ok: false, error: 'Internal server error.' }, 500);
    }
  }
};

async function health(env) {
  let needsSetup = null;
  try {
    const owner = await env.DB.prepare("SELECT id FROM api_users WHERE role = 'owner' LIMIT 1").first();
    needsSetup = !owner;
  } catch {}
  return json({ ok: true, service: 'tm-lua-host', database: !!env.DB, storage: !!env.BUCKET, needs_setup: needsSetup });
}

async function signup(request, env, body) {
  const username = safeUsername(body?.username);
  if (!username) return fail(400, '사용자 이름은 영문, 숫자, _, -, . 조합 2~40자입니다.');
  const id = randomHex(12);
  const token = newSecret('tmk_');
  const keyId = randomHex(12);
  let created = false;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO api_users (id, username, role, status, created_by)
       SELECT ?, ?, 'owner', 'active', ? WHERE NOT EXISTS (SELECT 1 FROM api_users WHERE role = 'owner')`
    ).bind(id, username, id).run();
    if (!result.meta?.changes) return fail(403, '소유자가 이미 있습니다. 관리자에게 API 키를 요청하세요.');
    created = true;
    await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_by) VALUES (?,?,?,?,?)')
      .bind(keyId, id, await sha256Hex(token), token.slice(0, 12), id).run();
  } catch (error) {
    if (created) await env.DB.prepare('DELETE FROM api_users WHERE id = ?').bind(id).run().catch(() => {});
    return fail(409, '이미 쓰는 사용자 이름이거나 가입할 수 없습니다.');
  }
  await audit(env, request, { user: { id }, keyId }, 'auth.signup', id, 'ok');
  return json({ ok: true, user: { id, username, role: 'owner' }, key: { id: keyId, token } }, 201);
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const auth = await authenticate(request, env);
  if (!auth) {
    await audit(env, request, null, `${method} ${path}`, null, 'denied');
    return fail(401, 'Unauthorized. Send Authorization: Bearer <API key>.');
  }
  const actor = auth.user;
  const manager = actor.role === 'owner' || actor.role === 'admin';
  const forbidden = async () => {
    await audit(env, request, auth, `${method} ${path}`, null, 'forbidden');
    return fail(403, 'Forbidden for this role.');
  };

  if (path === '/api/auth/login' && method === 'POST') {
    await audit(env, request, auth, 'auth.login', null, 'ok');
    return json({ ok: true, user: actor });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    await audit(env, request, auth, 'auth.logout', null, 'ok');
    return json({ ok: true });
  }
  if (path === '/api/auth/me' && method === 'GET') return json({ ok: true, user: actor });

  if (path === '/api/execute' && method === 'POST') return execute(request, env, auth, await readBody(request));

  if (path === '/api/scripts' && method === 'GET') {
    const { results = [] } = await env.DB.prepare('SELECT id, slug, name, mode, key_policy, hwid_lock, byte_size, sha256, created_at, updated_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 200').all();
    return json({ ok: true, scripts: results });
  }
  if (path === '/api/scripts' && method === 'POST') {
    if (!manager) return forbidden();
    return createScript(request, env, auth, await readBody(request));
  }
  const scriptMatch = path.match(/^\/api\/scripts\/([A-Za-z0-9_-]{8,40})$/);
  if (scriptMatch && method === 'PATCH') {
    if (!manager) return forbidden();
    return updateScript(request, env, auth, scriptMatch[1], await readBody(request));
  }
  if (scriptMatch && method === 'DELETE') {
    if (!manager) return forbidden();
    return deleteScript(request, env, auth, scriptMatch[1]);
  }
  const scriptKeysMatch = path.match(/^\/api\/scripts\/([A-Za-z0-9_-]{8,40})\/keys$/);
  if (scriptKeysMatch && method === 'POST') return issueScriptKey(request, env, auth, scriptKeysMatch[1], await readBody(request));

  if (path === '/api/script-keys' && method === 'GET') return listScriptKeys(env, auth);
  const scriptKeyMatch = path.match(/^\/api\/script-keys\/([A-Za-z0-9_-]{8,40})$/);
  if (scriptKeyMatch && method === 'PATCH') return updateScriptKey(request, env, auth, scriptKeyMatch[1], await readBody(request));
  if (scriptKeyMatch && method === 'DELETE') return revokeScriptKey(request, env, auth, scriptKeyMatch[1]);

  if (path === '/api/users' && method === 'GET') {
    if (!manager) return forbidden();
    const where = actor.role === 'owner' ? '' : "WHERE role = 'user'";
    const { results = [] } = await env.DB.prepare(`SELECT id, username, role, status, created_at FROM api_users ${where} ORDER BY created_at DESC LIMIT 500`).all();
    return json({ ok: true, users: results });
  }
  if (path === '/api/keys' && method === 'GET') {
    if (!manager) return forbidden();
    const where = actor.role === 'owner' ? '' : "WHERE u.role = 'user'";
    const { results = [] } = await env.DB.prepare(
      `SELECT k.id, k.user_id, u.username, u.role AS user_role, k.key_prefix, k.expires_at, k.revoked_at, k.created_at, k.last_used_at
       FROM api_keys k JOIN api_users u ON u.id = k.user_id ${where} ORDER BY k.created_at DESC LIMIT 500`
    ).all();
    return json({ ok: true, keys: results });
  }
  if (path === '/api/keys' && method === 'POST') {
    if (!manager) return forbidden();
    return issueKey(request, env, auth, await readBody(request));
  }
  const keyMatch = path.match(/^\/api\/keys\/([A-Za-z0-9_-]{1,64})$/);
  if (keyMatch && method === 'DELETE') {
    if (!manager) return forbidden();
    return revokeKey(request, env, auth, keyMatch[1]);
  }

  const userMatch = path.match(/^\/api\/users\/([A-Za-z0-9_-]{1,64})$/);
  if (userMatch && method === 'PATCH') {
    if (!manager) return forbidden();
    return updateUser(request, env, auth, userMatch[1], await readBody(request));
  }

  return fail(404, 'API route not found.');
}

async function serveRaw(request, env, kind, value) {
  if (isBrowserNavigation(request)) return plain('403 Forbidden', 403);
  const row = await env.DB.prepare(`SELECT id, slug, object_key, sha256, mode FROM hosted_scripts WHERE ${kind === 'id' ? 'id' : 'slug'} = ?`).bind(value).first();
  if (!row) return new Response('Script not found', { status: 404, headers: TEXT_HEADERS });
  if (row.mode === 'key') {
    await audit(env, request, null, 'script.raw.stub', row.id, 'ok');
    return new Response(keyStub(row.slug), { headers: { ...TEXT_HEADERS, 'content-disposition': contentDisposition(row.slug) } });
  }
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return new Response('Script content missing', { status: 404, headers: TEXT_HEADERS });
  await audit(env, request, null, 'script.raw', row.id, 'ok');
  return new Response(object.body, { headers: { ...TEXT_HEADERS, 'content-disposition': contentDisposition(row.slug), 'x-script-sha256': row.sha256 } });
}

async function keyRun(request, env, body) {
  if (!body || typeof body.slug !== 'string' || typeof body.key !== 'string') return fail(400, 'slug and key are required.');
  const script = await env.DB.prepare('SELECT * FROM hosted_scripts WHERE slug = ?').bind(normalizeSlug(body.slug)).first();
  if (!script || script.mode !== 'key') return fail(404, 'Script not found.');
  const row = await env.DB.prepare(
    'SELECT id, user_id, status, expires_at, hwid FROM script_keys WHERE key_hash = ? AND script_id = ?'
  ).bind(await sha256Hex(body.key), script.id).first();
  const valid = row && row.status === 'active' && !isExpired(row.expires_at);
  if (!valid) {
    await audit(env, request, null, 'script.key_run', script.id, 'denied');
    return fail(403, 'Invalid or inactive script key.');
  }
  if (script.hwid_lock) {
    const hwid = typeof body.hwid === 'string' ? body.hwid.trim() : '';
    if (!hwid || hwid.length > 128) return fail(400, 'hwid is required for this script.');
    if (row.hwid && row.hwid !== hwid) {
      await audit(env, request, { user: { id: row.user_id }, keyId: row.id }, 'script.key_run', script.id, 'hwid_mismatch');
      return fail(403, 'This key is bound to another device.');
    }
    if (!row.hwid) await env.DB.prepare('UPDATE script_keys SET hwid = ? WHERE id = ?').bind(hwid, row.id).run();
  }
  await env.DB.prepare(`UPDATE script_keys SET last_used_at = ${NOW_SQL} WHERE id = ?`).bind(row.id).run();
  const object = await env.BUCKET.get(script.object_key);
  if (!object) return fail(404, 'Script content missing.');
  await audit(env, request, { user: { id: row.user_id }, keyId: row.id }, 'script.key_run', script.id, 'ok');
  return json({ ok: true, code: await object.text() });
}

async function execute(request, env, auth, body) {
  if (!body || (!body.id && !body.slug)) return fail(400, 'id or slug is required.');
  const script = body.id
    ? await env.DB.prepare('SELECT * FROM hosted_scripts WHERE id = ?').bind(String(body.id)).first()
    : await env.DB.prepare('SELECT * FROM hosted_scripts WHERE slug = ?').bind(normalizeSlug(body.slug)).first();
  if (!script) return fail(404, 'Script not found.');
  if (script.mode === 'key') return fail(403, '키 모드 스크립트는 스크립트 키로만 실행할 수 있습니다.');
  const object = await env.BUCKET.get(script.object_key);
  if (!object) return fail(404, 'Script content missing.');
  const code = await object.text();
  await audit(env, request, auth, 'script.execute', script.id, 'ok');
  return json({ ok: true, script: { id: script.id, name: script.name, slug: script.slug, mode: script.mode, key_policy: script.key_policy, sha256: script.sha256 }, code });
}

async function createScript(request, env, auth, body) {
  if (!body || typeof body.code !== 'string') return fail(400, 'A code string is required.');
  const name = safeName(body.name) || 'Untitled script';
  const slug = safeSlug(body.slug || body.name);
  if (!slug || RESERVED.includes(slug)) return fail(400, 'A valid URL name is required.');
  const mode = body.mode === undefined ? 'keyless' : String(body.mode);
  const policy = body.key_policy === undefined ? 'open' : String(body.key_policy);
  if (!MODES.includes(mode) || !POLICIES.includes(policy)) return fail(400, 'Invalid mode or key_policy.');
  const hwidLock = body.hwid_lock ? 1 : 0;
  if (await env.DB.prepare('SELECT id FROM hosted_scripts WHERE slug = ?').bind(slug).first()) return fail(409, 'That URL name is already in use.');
  const size = byteLength(body.code);
  if (size === 0) return fail(400, 'Script cannot be empty.');
  if (size > maxBytes(env)) return fail(413, `Script exceeds ${maxBytes(env)} bytes.`);
  const id = randomHex(12);
  const objectKey = `scripts/${id}.lua`;
  const digest = await sha256Hex(body.code);
  await env.BUCKET.put(objectKey, body.code, { ...OBJECT_META, customMetadata: { scriptId: id, sha256: digest } });
  try {
    await env.DB.prepare('INSERT INTO hosted_scripts (id, slug, name, object_key, byte_size, sha256, mode, key_policy, hwid_lock) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, slug, name, objectKey, size, digest, mode, policy, hwidLock).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
  await audit(env, request, auth, 'script.create', id, 'ok');
  return json({ ok: true, script: { id, slug, name, mode, key_policy: policy, hwid_lock: hwidLock, byte_size: size, sha256: digest, raw_url: publicUrl(new URL(request.url).origin, slug) } }, 201);
}

async function updateScript(request, env, auth, id, body) {
  const current = await env.DB.prepare('SELECT * FROM hosted_scripts WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Script not found.');
  if (!body || typeof body.code !== 'string') return fail(400, 'A code string is required.');
  const size = byteLength(body.code);
  if (!size || size > maxBytes(env)) return fail(413, `Script size must be between 1 and ${maxBytes(env)} bytes.`);
  const name = safeName(body.name) || current.name;
  const slug = safeSlug(body.slug || current.slug || body.name);
  if (!slug || RESERVED.includes(slug)) return fail(400, 'A valid URL name is required.');
  const mode = body.mode === undefined ? current.mode : String(body.mode);
  const policy = body.key_policy === undefined ? current.key_policy : String(body.key_policy);
  if (!MODES.includes(mode) || !POLICIES.includes(policy)) return fail(400, 'Invalid mode or key_policy.');
  const hwidLock = body.hwid_lock === undefined ? current.hwid_lock : (body.hwid_lock ? 1 : 0);
  if (await env.DB.prepare('SELECT id FROM hosted_scripts WHERE slug = ? AND id <> ?').bind(slug, id).first()) return fail(409, 'That URL name is already in use.');
  const digest = await sha256Hex(body.code);
  await env.BUCKET.put(current.object_key, body.code, { ...OBJECT_META, customMetadata: { scriptId: id, sha256: digest } });
  await env.DB.prepare(`UPDATE hosted_scripts SET slug = ?, name = ?, byte_size = ?, sha256 = ?, mode = ?, key_policy = ?, hwid_lock = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
    .bind(slug, name, size, digest, mode, policy, hwidLock, id).run();
  await audit(env, request, auth, 'script.update', id, 'ok');
  return json({ ok: true, script: { id, slug, name, mode, key_policy: policy, hwid_lock: hwidLock, byte_size: size, sha256: digest, raw_url: publicUrl(new URL(request.url).origin, slug) } });
}

async function deleteScript(request, env, auth, id) {
  const current = await env.DB.prepare('SELECT object_key FROM hosted_scripts WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Script not found.');
  await env.BUCKET.delete(current.object_key);
  await env.DB.prepare('DELETE FROM hosted_scripts WHERE id = ?').bind(id).run();
  await audit(env, request, auth, 'script.delete', id, 'ok');
  return json({ ok: true, id });
}

async function issueScriptKey(request, env, auth, scriptId, body) {
  const actor = auth.user;
  const manager = actor.role !== 'user';
  const script = await env.DB.prepare('SELECT id, slug, mode, key_policy FROM hosted_scripts WHERE id = ?').bind(scriptId).first();
  if (!script) return fail(404, 'Script not found.');
  if (script.mode !== 'key') return fail(400, 'This script is keyless. No script key is needed.');
  let holderId = actor.id;
  if (manager && body?.user_id) {
    const found = await env.DB.prepare('SELECT id, role, status FROM api_users WHERE id = ?').bind(String(body.user_id)).first();
    if (!found) return fail(404, 'User not found.');
    if (!scopeAllows(actor, found.role)) return fail(403, 'Admins can only issue keys for user accounts.');
    if (found.status !== 'active') return fail(409, 'User is blocked.');
    holderId = found.id;
  }
  const exists = await env.DB.prepare("SELECT id FROM script_keys WHERE script_id = ? AND user_id = ? AND status <> 'revoked'").bind(script.id, holderId).first();
  if (exists) return fail(409, 'An active key already exists. Revoke it before issuing a new one.');
  const expiry = expiresFromDays(body?.expires_in_days);
  if (!expiry.ok) return fail(400, 'expires_in_days must be between 1 and 3650.');
  const token = newSecret('skey_');
  const keyId = randomHex(12);
  await env.DB.prepare('INSERT INTO script_keys (id, script_id, user_id, key_hash, key_prefix, created_by, expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind(keyId, script.id, holderId, await sha256Hex(token), token.slice(0, 12), actor.id, expiry.expiresAt).run();
  await audit(env, request, auth, 'script_key.issue', keyId, 'ok');
  return json({ ok: true, key: { id: keyId, script_id: script.id, slug: script.slug, user_id: holderId, token, expires_at: expiry.expiresAt } }, 201);
}

async function listScriptKeys(env, auth) {
  const actor = auth.user;
  const base = `SELECT sk.id, sk.script_id, s.slug, sk.user_id, u.username, sk.key_prefix, sk.status, sk.expires_at, sk.created_at, sk.last_used_at, (sk.hwid IS NOT NULL) AS hwid_bound
    FROM script_keys sk JOIN hosted_scripts s ON s.id = sk.script_id JOIN api_users u ON u.id = sk.user_id`;
  const statement = actor.role === 'user'
    ? env.DB.prepare(`${base} WHERE sk.user_id = ? ORDER BY sk.created_at DESC LIMIT 200`).bind(actor.id)
    : env.DB.prepare(`${base} ORDER BY sk.created_at DESC LIMIT 200`);
  const { results = [] } = await statement.all();
  return json({ ok: true, keys: results });
}

async function updateScriptKey(request, env, auth, keyId, body) {
  const actor = auth.user;
  if (actor.role === 'user') return fail(403, 'Forbidden for this role.');
  const row = await env.DB.prepare('SELECT sk.id, sk.status, u.role AS holder_role FROM script_keys sk JOIN api_users u ON u.id = sk.user_id WHERE sk.id = ?').bind(keyId).first();
  if (!row) return fail(404, 'Key not found.');
  if (!scopeAllows(actor, row.holder_role)) return fail(403, 'Admins can only manage user keys.');
  if (row.status === 'revoked') return fail(409, 'Revoked keys cannot be changed.');
  if (body?.reset_hwid === true) {
    await env.DB.prepare('UPDATE script_keys SET hwid = NULL WHERE id = ?').bind(keyId).run();
    await audit(env, request, auth, 'script_key.reset_hwid', keyId, 'ok');
    return json({ ok: true, id: keyId, hwid_bound: false });
  }
  if (!body || !KEY_STATUSES.includes(body.status)) return fail(400, 'status must be active or suspended.');
  await env.DB.prepare('UPDATE script_keys SET status = ? WHERE id = ?').bind(body.status, keyId).run();
  await audit(env, request, auth, 'script_key.update', keyId, 'ok');
  return json({ ok: true, id: keyId, status: body.status });
}

async function revokeScriptKey(request, env, auth, keyId) {
  const actor = auth.user;
  const row = await env.DB.prepare('SELECT sk.id, sk.user_id, u.role AS holder_role FROM script_keys sk JOIN api_users u ON u.id = sk.user_id WHERE sk.id = ?').bind(keyId).first();
  if (!row) return fail(404, 'Key not found.');
  const isHolder = row.user_id === actor.id;
  if (!isHolder && (actor.role === 'user' || !scopeAllows(actor, row.holder_role))) return fail(403, 'Forbidden for this role.');
  await env.DB.prepare("UPDATE script_keys SET status = 'revoked' WHERE id = ?").bind(keyId).run();
  await audit(env, request, auth, 'script_key.revoke', keyId, 'ok');
  return json({ ok: true, id: keyId });
}

async function issueKey(request, env, auth, body) {
  const actor = auth.user;
  if (!body || typeof body !== 'object') return fail(400, 'JSON body required.');
  const role = body.role === undefined ? 'user' : String(body.role);
  if (!ROLES.includes(role)) return fail(400, 'Invalid role.');

  let target = null;
  if (body.user_id) {
    target = await env.DB.prepare('SELECT id, username, role, status FROM api_users WHERE id = ?').bind(String(body.user_id)).first();
    if (!target) return fail(404, 'User not found.');
  } else {
    const username = safeUsername(body.username);
    if (!username) return fail(400, 'user_id or a valid username is required.');
    target = await env.DB.prepare('SELECT id, username, role, status FROM api_users WHERE username = ?').bind(username).first();
    if (!target) {
      if (actor.role === 'admin' && role !== 'user') return fail(403, 'Admins can only create user accounts.');
      const id = randomHex(12);
      await env.DB.prepare('INSERT INTO api_users (id, username, role, status, created_by) VALUES (?,?,?,?,?)').bind(id, username, role, 'active', actor.id).run();
      target = { id, username, role, status: 'active' };
    }
  }
  if (actor.role === 'admin' && target.role !== 'user') return fail(403, 'Admins can only manage user accounts.');
  if (target.status !== 'active') return fail(409, 'User is blocked.');
  const expiry = expiresFromDays(body.expires_in_days);
  if (!expiry.ok) return fail(400, 'expires_in_days must be between 1 and 3650.');

  const key = newSecret('tmk_');
  const keyId = randomHex(12);
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_by, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(keyId, target.id, await sha256Hex(key), key.slice(0, 12), actor.id, expiry.expiresAt).run();
  await audit(env, request, auth, 'key.issue', keyId, 'ok');
  return json({ ok: true, key: { id: keyId, user_id: target.id, username: target.username, role: target.role, expires_at: expiry.expiresAt, token: key } }, 201);
}

async function revokeKey(request, env, auth, keyId) {
  const row = await env.DB.prepare('SELECT k.id, u.role FROM api_keys k JOIN api_users u ON u.id = k.user_id WHERE k.id = ?').bind(keyId).first();
  if (!row) return fail(404, 'Key not found.');
  if (auth.user.role === 'admin' && row.role !== 'user') return fail(403, 'Admins can only revoke user keys.');
  await env.DB.prepare(`UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ${NOW_SQL}), revoked_by = ? WHERE id = ?`).bind(auth.user.id, keyId).run();
  await audit(env, request, auth, 'key.revoke', keyId, 'ok');
  return json({ ok: true, id: keyId });
}

async function updateUser(request, env, auth, userId, body) {
  const actor = auth.user;
  const target = await env.DB.prepare('SELECT id, username, role, status FROM api_users WHERE id = ?').bind(userId).first();
  if (!target) return fail(404, 'User not found.');
  if (actor.role === 'admin' && target.role !== 'user') return fail(403, 'Admins can only manage user accounts.');
  if (target.id === actor.id) return fail(409, 'You cannot change your own account here.');
  if (!body || typeof body !== 'object') return fail(400, 'JSON body required.');
  const { status, role } = body;
  if (status === undefined && role === undefined) return fail(400, 'Nothing to update.');
  if (status !== undefined && !['active', 'blocked'].includes(status)) return fail(400, 'Invalid status.');
  if (role !== undefined) {
    if (actor.role !== 'owner') return fail(403, 'Only the owner can change roles.');
    if (!ROLES.includes(role)) return fail(400, 'Invalid role.');
  }
  const nextStatus = status ?? target.status;
  const nextRole = role ?? target.role;
  await env.DB.prepare(`UPDATE api_users SET status = ?, role = ?, updated_at = ${NOW_SQL} WHERE id = ?`).bind(nextStatus, nextRole, userId).run();
  await audit(env, request, auth, 'user.update', userId, 'ok');
  return json({ ok: true, user: { id: userId, username: target.username, role: nextRole, status: nextStatus } });
}
