const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
import { obfuscate } from './obfuscator.js';
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const OBJECT_META = { httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' } };
const ROLES = ['owner', 'admin', 'user'];
const MODES = ['keyless', 'key'];
const POLICIES = ['open', 'closed'];
const KEY_STATUSES = ['active', 'suspended'];
const RESERVED = ['api', 'raw', 'assets', 'admin', 'login', 'favicon.ico', 'robots.txt'];
const SLUG_RE = /^[\p{L}\p{N}_-]{1,56}(\.lua)?$/u;
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SCRIPT_LIMIT = 18;
const USER_LIMIT = 10000;
const MAX_FILES = 10;
const BATCH_LIMIT = 300;
const PROJECT_NAME_MAX = 60;
const SCRIPT_COLUMNS = 'id, slug, name, mode, key_policy, hwid_lock, silent, heartbeat, lightweight, secure_loader, obfuscated, status, version, project_id, byte_size, sha256, served_sha256, created_at, updated_at, created_by';

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' };
const withCors = (response) => {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (status, error) => json({ ok: false, error }, status);
const plain = (body, status) => new Response(body, { status, headers: TEXT_HEADERS });
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (value) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const randomHex = (bytes = 12) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const randomAlnum = (length) => {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < 248 && out.length < length) out += ALNUM[b % ALNUM.length];
    }
  }
  return out;
};
const newSecret = (prefix, length = 52) => prefix + randomAlnum(length);
const licenseKey = () => {
  const s = randomAlnum(20);
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}`;
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
const keyStub = (slug, origin) => `local request_fn = (syn and syn.request) or (http and http.request) or http_request or request
assert(request_fn, "이 실행기는 request 함수를 지원하지 않습니다")
assert(type(script_key) == "string" and script_key ~= "", "script_key를 먼저 설정하세요")
local HttpService = game:GetService("HttpService")
local hwid = "unknown"
pcall(function() hwid = game:GetService("RbxAnalyticsService"):GetClientId() end)
local function post(path, body)
	return request_fn({ Url = "${origin}" .. path, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = HttpService:JSONEncode(body) })
end
local started = post("/api/key-session", { slug = "${slug}", key = script_key, hwid = hwid })
assert(started and started.StatusCode == 200, "스크립트 키 검증에 실패했습니다")
local session = HttpService:JSONDecode(started.Body)
assert(session and session.ok and type(session.token) == "string", "보안 세션을 만들 수 없습니다")
local chunks = {}
for index = 0, 5 do
	local response = post("/api/key-chunk", { token = session.token, index = index })
	assert(response and response.StatusCode == 200, "스크립트 조각 검증에 실패했습니다")
	local part = HttpService:JSONDecode(response.Body)
	assert(part and part.ok and part.index == index and part.total == 6 and type(part.chunk) == "string", "스크립트 조각이 유효하지 않습니다")
	chunks[index + 1] = part.chunk
end
local code = table.concat(chunks)
assert(#code > 0, "스크립트 데이터가 비어 있습니다")
loadstring(code)()
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
const isBrowserRequest = (request) =>
  isBrowserNavigation(request) || (request.headers.get('accept') || '').includes('text/html');
const expiresFromDays = (value) => {
  if (value === undefined || value === null) return { ok: true, expiresAt: null };
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false };
  return { ok: true, expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
};
const scopeAllows = (actor, holderRole) => actor.role === 'owner' || (actor.role === 'admin' && holderRole === 'user');
const bumpVersion = (value) => {
  const parts = String(value).replace(/^v/, '').split('.').map((n) => parseInt(n, 10));
  if (!parts.length || parts.some(Number.isNaN)) return 'v0.0.0.1';
  parts[parts.length - 1] += 1;
  return `v${parts.join('.')}`;
};
const boolInt = (value, fallback) => (value === undefined ? fallback : value ? 1 : 0);
const isoNow = () => new Date().toISOString();

async function authenticateToken(token, env) {
  const row = await env.DB.prepare(
    `SELECT k.id AS key_id, k.expires_at, k.revoked_at, u.id AS user_id, u.username, u.role, u.status
     FROM api_keys k JOIN api_users u ON u.id = k.user_id WHERE k.key_hash = ?`
  ).bind(await sha256Hex(token)).first();
  if (!row || row.revoked_at || row.status !== 'active' || isExpired(row.expires_at)) return null;
  await env.DB.prepare(`UPDATE api_keys SET last_used_at = ${NOW_SQL} WHERE id = ?`).bind(row.key_id).run();
  return { user: { id: row.user_id, username: row.username, role: row.role }, keyId: row.key_id, token };
}

async function authenticate(request, env) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(tmk_[A-Za-z0-9_-]{20,})$/);
  return match ? authenticateToken(match[1], env) : null;
}

const canViewSource = (user, row) => user.role === 'owner' || (!!row.created_by && row.created_by === user.id);

async function audit(env, request, auth, action, target, status) {
  try {
    await env.DB.prepare('INSERT INTO api_audit_logs (user_id, key_id, action, target, status, ip) VALUES (?,?,?,?,?,?)')
      .bind(auth?.user.id ?? null, auth?.keyId ?? null, action, target ?? null, status, request.headers.get('cf-connecting-ip')).run();
  } catch (error) {
    console.error('Audit write failed:', error);
  }
}

const TURNSTILE_CLEARANCE_SECONDS = 1800;
const DECOY_CODE = 'local function _safe_result() return nil end\nreturn _safe_result()';
const turnstileEnabled = (env) => !!(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
const isBrowserInitiated = (request, url) => isBrowserRequest(request)
  || request.headers.get('sec-fetch-site') === 'same-origin'
  || request.headers.get('origin') === url.origin;

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret + ':jinhyuk-turnstile-clearance'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function hasTurnstileClearance(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)jxy_clearance=([0-9]{10})\.([a-f0-9]{64})/);
  if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(env.TURNSTILE_SECRET_KEY, match[1]);
  if (expected.length !== match[2].length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ match[2].charCodeAt(i);
  return diff === 0;
}

async function verifyTurnstile(request, env, body) {
  if (!turnstileEnabled(env)) return fail(503, 'Bot verification is not configured.');
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token || token.length > 4096) return fail(400, 'Complete the bot verification first.');
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  let result;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form
    });
    result = await response.json();
  } catch {
    return fail(502, 'Bot verification service is temporarily unavailable.');
  }
  const expectedHost = String(env.TURNSTILE_HOSTNAME || new URL(request.url).hostname).toLowerCase();
  if (!result?.success || String(result.hostname || '').toLowerCase() !== expectedHost) {
    await recordSecurityEvent(env, request, 'turnstile.failed', 'denied');
    return fail(403, 'Bot verification failed. Please try again.');
  }
  const expiry = String(Math.floor(Date.now() / 1000) + TURNSTILE_CLEARANCE_SECONDS);
  const signature = await hmacHex(env.TURNSTILE_SECRET_KEY, expiry);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {
    ...JSON_HEADERS,
    'set-cookie': `jxy_clearance=${expiry}.${signature}; Max-Age=${TURNSTILE_CLEARANCE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict`
  }});
}

async function recordSecurityEvent(env, request, action, status, target = null) {
  try {
    await env.DB.prepare('INSERT INTO security_events (ip, action, target, status) VALUES (?,?,?,?)')
      .bind(request.headers.get('cf-connecting-ip') || null, action, target, status).run();
  } catch (error) {
    console.error('Security event write failed:', error);
  }
}

function turnstileGatePage(request, env) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('next') || (url.pathname + url.search);
  const next = requested.startsWith('/') && !requested.startsWith('//') && !requested.startsWith('/\\') ? requested : '/';
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').replace(/[&<>"']/g, '');
  const safeNext = JSON.stringify(next).replace(/</g, '\\u003c');
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>보안 확인 · jinhyuk.xyz</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111318;color:#f5f6fa;font:16px system-ui,sans-serif}.card{width:min(92vw,420px);box-sizing:border-box;padding:28px;border:1px solid #ffffff28;border-radius:20px;background:#ffffff0b;box-shadow:0 20px 70px #0008;text-align:center}.muted{color:#aeb4c2;font-size:14px;line-height:1.6}.widget{display:flex;justify-content:center;margin:24px 0}#error{color:#ff8e8e;font-size:13px}</style><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head><body><main class="card"><h1>보안 확인</h1><p class="muted">자동화된 접근을 방지하기 위해 브라우저 확인이 필요합니다.</p><div class="widget"><div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="verified" data-error-callback="failed" data-expired-callback="expired" data-theme="dark"></div></div><p id="error" role="status"></p><p class="muted">확인이 완료되면 요청한 페이지로 이동합니다.</p></main><script>const next=${safeNext};async function verified(token){const e=document.getElementById('error');e.textContent='확인 중...';try{const r=await fetch('/api/security/turnstile-verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'확인에 실패했습니다.');location.replace(next)}catch(err){e.textContent=err.message||'다시 시도해 주세요.';if(window.turnstile)turnstile.reset()}}function failed(){document.getElementById('error').textContent='인증을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'}function expired(){document.getElementById('error').textContent='인증이 만료되었습니다. 다시 확인해 주세요.'}</script></body></html>`, { status: 200, headers: HTML_HEADERS });
}

async function autoBanIp(env, request, reason, target = null) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip) return false;
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO banned_ips (ip, reason, expires_at, auto_ban) VALUES (?, ?, ?, 1) ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at, auto_ban = 1, created_at = ${NOW_SQL}`)
    .bind(ip, reason, expires).run();
  await recordSecurityEvent(env, request, 'ip.auto_ban', 'blocked', target);
  return true;
}

async function recordInvalidApiAuth(env, request, path, method) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip) return false;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM api_audit_logs WHERE ip = ? AND user_id IS NULL AND status = 'denied' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')`
  ).bind(ip).first();
  const count = Number(row?.n || 0);
  await recordSecurityEvent(env, request, 'api.auth.failed', 'denied', `${method} ${path}`);
  if (count >= 8) return autoBanIp(env, request, 'Repeated unauthorized API requests', `${method} ${path}`);
  return false;
}

async function recordInvalidScriptKey(env, request, scriptId) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  await recordSecurityEvent(env, request, 'script.key.invalid', 'denied', scriptId);
  await audit(env, request, null, 'script.key_run', scriptId, 'denied');
  if (!ip) return { decoy: false, banned: false };
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM api_audit_logs WHERE ip = ? AND action = 'script.key_run' AND status = 'denied' AND target = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')`
  ).bind(ip, scriptId).first();
  const count = Number(row?.n || 0);
  if (count >= 8) {
    await autoBanIp(env, request, 'Repeated invalid script-key attempts', scriptId);
    return { decoy: false, banned: true };
  }
  return { decoy: count >= 6, banned: false };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'OPTIONS' && path.startsWith('/api/')) return new Response(null, { status: 204, headers: { ...CORS_HEADERS, allow: 'GET,POST,PATCH,DELETE,OPTIONS' } });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET,POST,PATCH,DELETE,OPTIONS' } });
    try {
      const ip = request.headers.get('cf-connecting-ip');
      if (ip) {
        const ban = await env.DB.prepare('SELECT ip, expires_at FROM banned_ips WHERE ip = ?').bind(ip).first();
        if (ban && (!ban.expires_at || Date.parse(ban.expires_at) > Date.now())) {
          const denied = fail(403, 'Access denied.');
          return path.startsWith('/api/') ? withCors(denied) : denied;
        }
        if (ban?.expires_at && Date.parse(ban.expires_at) <= Date.now()) {
          await env.DB.prepare('DELETE FROM banned_ips WHERE ip = ? AND expires_at <= ?').bind(ip, new Date().toISOString()).run();
        }
      }
      if (path === '/api/health' && method === 'GET') return health(env);
      if (path === '/api/security/turnstile-config' && method === 'GET') return json({ enabled: turnstileEnabled(env), site_key: turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : null });
      if (path === '/api/security/turnstile-verify' && method === 'POST') return withCors(await verifyTurnstile(request, env, await readBody(request)));
      if (turnstileEnabled(env) && isBrowserInitiated(request, url) && path !== '/api/security/turnstile-config' && path !== '/api/security/turnstile-verify' && path !== '/api/health' && !['/api/key-run', '/api/key-session', '/api/key-chunk'].includes(path)) {
        const clear = await hasTurnstileClearance(request, env);
        if (!clear) {
          if (path.startsWith('/api/')) return withCors(fail(403, 'Complete browser verification first.'));
          if (isBrowserRequest(request)) return turnstileGatePage(request, env);
        }
      }
      if (path === '/api/auth/signup' && method === 'POST') {
        if (turnstileEnabled(env) && !(await hasTurnstileClearance(request, env))) return withCors(fail(403, 'Complete browser verification first.'));
        return withCors(await signup(request, env, await readBody(request)));
      }
      if (path === '/api/key-session' && method === 'POST') return withCors(await startKeyDelivery(request, env, await readBody(request)));
      if (path === '/api/key-chunk' && method === 'POST') return withCors(await deliverKeyChunk(request, env, await readBody(request)));
      if (path === '/api/key-run' && method === 'POST') {
        await recordSecurityEvent(env, request, 'script.delivery.legacy_blocked', 'denied');
        return withCors(fail(410, 'Legacy script delivery is disabled. Fetch a new loader.'));
      }
      if (path.startsWith('/api/')) return withCors(await handleApi(request, env, url));
      // html_handling: "none" 이므로 /, /login, /admin 을 HTML 파일에 명시적으로 연결한다.
      if (method === 'GET' && (path === '/' || path === '/index.html')) {
        return env.ASSETS ? env.ASSETS.fetch(new Request(new URL('/index.html', url), request)) : plain('Not found', 404);
      }
      if (method === 'GET' && (path === '/login' || path === '/login/')) {
        return env.ASSETS ? env.ASSETS.fetch(new Request(new URL('/login.html', url), request)) : plain('Not found', 404);
      }
      if (method === 'GET' && (path === '/admin' || path === '/admin/')) {
        return env.ASSETS ? env.ASSETS.fetch(new Request(new URL('/admin.html', url), request)) : plain('Not found', 404);
      }
      if (method === 'GET' && env.ASSETS) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }
      const rawId = path.match(/^\/raw\/([A-Za-z0-9_-]{8,40})$/);
      if (rawId && method === 'GET') return await serveRaw(request, env, 'id', rawId[1]);
      const slug = slugFromPath(path);
      if (slug && method === 'GET') return await serveRaw(request, env, 'slug', slug);
      return env.ASSETS ? env.ASSETS.fetch(request) : plain('Not found', 404);
    } catch (error) {
      console.error('Worker request failed:', error);
      const failed = json({ ok: false, error: 'Internal server error.' }, 500);
      return path.startsWith('/api/') ? withCors(failed) : failed;
    }
  }
};

async function health(env) {
  let needsSetup = null;
  try {
    const owner = await env.DB.prepare("SELECT id FROM api_users WHERE role = 'owner' LIMIT 1").first();
    needsSetup = !owner;
  } catch {}
  return json({ ok: true, service: 'tm-lua-host', database: !!env.DB, storage: !!env.BUCKET, turnstile: turnstileEnabled(env), needs_setup: needsSetup });
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
    await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_by, token) VALUES (?,?,?,?,?,?)')
      .bind(keyId, id, await sha256Hex(token), token.slice(0, 12), id, token).run();
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
    const banned = await recordInvalidApiAuth(env, request, path, method);
    return banned ? fail(403, 'Access temporarily blocked for 72 hours.') : fail(401, 'Unauthorized. Send Authorization: Bearer <API key>.');
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

  if (path === '/api/dashboard' && method === 'GET') {
    if (!manager) return forbidden();
    return dashboard(env);
  }

  if (path === '/api/projects' && method === 'GET') {
    return json({ ok: true, projects: await listProjects(env) });
  }
  if (path === '/api/projects' && method === 'POST') {
    if (!manager) {
      await audit(env, request, auth, `${method} ${path}`, null, 'forbidden');
      return fail(403, '프로젝트는 소유자와 관리자만 만들 수 있습니다.');
    }
    return createProject(request, env, auth, await readBody(request));
  }
  const projectMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{8,40})$/);
  if (projectMatch && method === 'PATCH') {
    if (!manager) return forbidden();
    return renameProject(request, env, auth, projectMatch[1], await readBody(request));
  }
  if (projectMatch && method === 'DELETE') {
    if (!manager) return forbidden();
    return deleteProject(request, env, auth, projectMatch[1]);
  }
  const projectUsersMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{8,40})\/users$/);
  if (projectUsersMatch && method === 'GET') {
    if (!manager) return forbidden();
    return listLicenseUsers(env, projectUsersMatch[1]);
  }
  if (projectUsersMatch && method === 'POST') {
    if (!manager) return forbidden();
    return createLicenseUsers(request, env, auth, projectUsersMatch[1], await readBody(request));
  }
  const unusedMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{8,40})\/users\/delete-unused$/);
  if (unusedMatch && method === 'POST') {
    if (!manager) return forbidden();
    return deleteUnusedLicenseUsers(request, env, auth, unusedMatch[1]);
  }
  const importMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{8,40})\/users\/import$/);
  if (importMatch && method === 'POST') {
    if (!manager) return forbidden();
    return importLicenseUsers(request, env, auth, importMatch[1], await readBody(request));
  }
  const licenseMatch = path.match(/^\/api\/license-users\/([A-Za-z0-9_-]{8,40})$/);
  if (licenseMatch && method === 'PATCH') {
    if (!manager) return forbidden();
    return updateLicenseUser(request, env, auth, licenseMatch[1], await readBody(request));
  }
  if (licenseMatch && method === 'DELETE') {
    if (!manager) return forbidden();
    return deleteLicenseUser(request, env, auth, licenseMatch[1]);
  }
  const licenseResetMatch = path.match(/^\/api\/license-users\/([A-Za-z0-9_-]{8,40})\/reset$/);
  if (licenseResetMatch && method === 'POST') {
    if (!manager) return forbidden();
    return hardResetLicenseUser(request, env, auth, licenseResetMatch[1]);
  }

  if (path === '/api/banned-ips' && method === 'GET') {
    if (!manager) return forbidden();
    const { results = [] } = await env.DB.prepare('SELECT ip, reason, created_at, expires_at, auto_ban FROM banned_ips ORDER BY created_at DESC LIMIT 1000').all();
    return json({ ok: true, banned_ips: results });
  }
  if (path === '/api/security-events' && method === 'GET') {
    if (!manager) return forbidden();
    const { results = [] } = await env.DB.prepare('SELECT id, ip, action, target, status, created_at FROM security_events ORDER BY created_at DESC LIMIT 500').all();
    return json({ ok: true, events: results });
  }
  if (path === '/api/banned-ips' && method === 'POST') {
    if (!manager) return forbidden();
    return banIp(request, env, auth, await readBody(request));
  }
  const bannedMatch = path.match(/^\/api\/banned-ips\/([^/]{3,64})$/);
  if (bannedMatch && method === 'DELETE') {
    if (!manager) return forbidden();
    let ip;
    try { ip = decodeURIComponent(bannedMatch[1]); } catch { return fail(400, 'Invalid IP address.'); }
    return unbanIp(request, env, auth, ip);
  }

  if (path === '/api/execute' && method === 'POST') return execute(request, env, auth, await readBody(request));

  if (path === '/api/scripts' && method === 'GET') {
    const { results = [] } = await env.DB.prepare(`SELECT ${SCRIPT_COLUMNS} FROM hosted_scripts ORDER BY created_at DESC LIMIT 1000`).all();
    return json({ ok: true, scripts: results });
  }
  if (path === '/api/scripts' && method === 'POST') {
    return createScript(request, env, auth, await readBody(request));
  }
  const scriptMatch = path.match(/^\/api\/scripts\/([A-Za-z0-9_-]{8,40})$/);
  if (scriptMatch && method === 'PATCH') {
    return updateScript(request, env, auth, scriptMatch[1], await readBody(request));
  }
  if (scriptMatch && method === 'DELETE') {
    return deleteScript(request, env, auth, scriptMatch[1]);
  }
  const scriptKeysMatch = path.match(/^\/api\/scripts\/([A-Za-z0-9_-]{8,40})\/keys$/);
  if (scriptKeysMatch && method === 'POST') return issueScriptKey(request, env, auth, scriptKeysMatch[1], await readBody(request));
  const scriptBulkMatch = path.match(/^\/api\/scripts\/([A-Za-z0-9_-]{8,40})\/keys\/(bulk|import|unused|export)$/);
  if (scriptBulkMatch) {
    const [, sid, action] = scriptBulkMatch;
    if (action === 'bulk' && method === 'POST') return bulkIssueScriptKeys(request, env, auth, sid, await readBody(request));
    if (action === 'import' && method === 'POST') return importScriptKeys(request, env, auth, sid, await readBody(request));
    if (action === 'unused' && method === 'DELETE') return deleteUnusedScriptKeys(request, env, auth, sid);
    if (action === 'export' && method === 'GET') return exportScriptKeys(env, auth, sid);
  }
  const scriptFilesMatch = path.match(/^\/api\/scripts\/([A-Za-z0-9_-]{8,40})\/files$/);
  if (scriptFilesMatch && method === 'GET') {
    return listScriptFiles(env, scriptFilesMatch[1]);
  }
  if (scriptFilesMatch && method === 'POST') {
    return uploadScriptFile(request, env, auth, scriptFilesMatch[1], await readBody(request));
  }
  const scriptFileMatch = path.match(/^\/api\/script-files\/([A-Za-z0-9_-]{8,40})$/);
  if (scriptFileMatch && method === 'DELETE') {
    return deleteScriptFile(request, env, auth, scriptFileMatch[1]);
  }

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
      `SELECT k.id, k.user_id, k.label, k.project_id, u.username, u.role AS user_role, k.key_prefix, k.token, k.expires_at, k.revoked_at, k.created_at, k.last_used_at
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

async function dashboard(env) {
  const projects = await listProjects(env);
  const { results: scripts = [] } = await env.DB.prepare(
    `SELECT ${SCRIPT_COLUMNS}, (SELECT COUNT(*) FROM script_files f WHERE f.script_id = hosted_scripts.id) AS file_count
     FROM hosted_scripts ORDER BY created_at ASC LIMIT 2000`
  ).all();
  const { results: bannedIps = [] } = await env.DB.prepare('SELECT ip, reason, created_at, expires_at, auto_ban FROM banned_ips ORDER BY created_at DESC LIMIT 1000').all();
  const totalUsers = await env.DB.prepare('SELECT COUNT(*) AS n FROM license_users').first();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const obf = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM api_audit_logs WHERE action = 'script.obfuscate' AND status = 'ok' AND created_at >= ?"
  ).bind(monthStart).first();
  return json({
    ok: true,
    projects,
    scripts,
    banned_ips: bannedIps,
    total_users: Number(totalUsers?.n || 0),
    usage: { obfuscations: Number(obf?.n || 0), limit: null, month_start: monthStart },
    limits: { scripts_per_project: SCRIPT_LIMIT, users: USER_LIMIT }
  });
}

async function listProjects(env) {
  const { results = [] } = await env.DB.prepare(
    `SELECT p.id, p.name, p.created_at,
       (SELECT COUNT(*) FROM hosted_scripts s WHERE s.project_id = p.id) AS script_count,
       (SELECT COUNT(*) FROM license_users u WHERE u.project_id = p.id) AS user_count
     FROM projects p ORDER BY p.created_at ASC LIMIT 500`
  ).all();
  return results;
}

async function projectNameTaken(env, name, exceptId = '') {
  return !!(await env.DB.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id <> ?').bind(name, exceptId).first());
}

async function createProject(request, env, auth, body) {
  const name = safeName(body?.name);
  if (!name) return fail(400, 'Project name is required.');
  if (name.length > PROJECT_NAME_MAX) return fail(400, `Project name must be ${PROJECT_NAME_MAX} characters or less.`);
  if (await projectNameTaken(env, name)) return fail(409, 'A project with this name already exists.');
  const id = randomHex(12);
  await env.DB.prepare('INSERT INTO projects (id, name, created_by) VALUES (?,?,?)').bind(id, name, auth.user.id).run();
  await audit(env, request, auth, 'project.create', id, 'ok');
  return json({ ok: true, project: { id, name, script_count: 0, user_count: 0 } }, 201);
}

async function renameProject(request, env, auth, id, body) {
  const name = safeName(body?.name);
  if (!name) return fail(400, 'Project name is required.');
  if (name.length > PROJECT_NAME_MAX) return fail(400, `Project name must be ${PROJECT_NAME_MAX} characters or less.`);
  const current = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Project not found.');
  if (await projectNameTaken(env, name, id)) return fail(409, 'A project with this name already exists.');
  await env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(name, id).run();
  await audit(env, request, auth, 'project.rename', id, 'ok');
  return json({ ok: true, project: { id, name } });
}

async function deleteProject(request, env, auth, id) {
  const current = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Project not found.');
  const { results: scripts = [] } = await env.DB.prepare('SELECT id, object_key, raw_object_key FROM hosted_scripts WHERE project_id = ?').bind(id).all();
  const orphanKeys = [];
  for (const script of scripts) {
    const { results: files = [] } = await env.DB.prepare('SELECT object_key FROM script_files WHERE script_id = ?').bind(script.id).all();
    orphanKeys.push(...files.map((f) => f.object_key), script.object_key, script.raw_object_key);
  }
  await env.DB.prepare('UPDATE api_keys SET project_id = NULL WHERE project_id = ?').bind(id).run();
  await env.DB.prepare('UPDATE license_users SET project_id = NULL WHERE project_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  await purgeObjects(env, orphanKeys.filter(Boolean));
  await audit(env, request, auth, 'project.delete', id, 'ok');
  return json({ ok: true, id });
}

function licenseFields(body, current = null) {
  const hasDiscord = body?.discord_id !== undefined;
  const hasMemo = body?.memo !== undefined;
  const hasReset = body?.reset_days !== undefined;
  const discord = hasDiscord ? String(body.discord_id ?? '').trim() : current?.discord_id ?? '';
  if (discord && !/^\d{17,20}$/.test(discord)) return { error: 'Discord ID must be 17 to 20 digits.' };
  const rawMemo = hasMemo ? String(body.memo ?? '') : current?.memo ?? '';
  if (rawMemo.length > 300) return { error: 'Memo must be 300 characters or less.' };
  const resetDays = hasReset ? Number(body.reset_days) : current?.reset_days ?? 14;
  if (!Number.isInteger(resetDays) || resetDays < 1 || resetDays > 365) return { error: 'Hard reset period is required (1 to 365 days).' };
  return { discord, memo: rawMemo.trim(), resetDays };
}

const licenseView = (row) => ({
  id: row.id,
  license_key: row.license_key,
  discord_id: row.discord_id,
  memo: row.memo,
  reset_days: row.reset_days,
  resets: row.resets,
  last_reset: row.last_reset,
  used: !!row.used,
  hwid_bound: !!row.hwid,
  created_at: row.created_at
});

async function listLicenseUsers(env, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return fail(404, 'Project not found.');
  const { results = [] } = await env.DB.prepare(
    'SELECT id, license_key, discord_id, memo, reset_days, resets, last_reset, used, hwid, created_at FROM license_users WHERE project_id = ? ORDER BY created_at ASC LIMIT ?'
  ).bind(projectId, USER_LIMIT).all();
  return json({ ok: true, users: results.map(licenseView) });
}

async function totalLicenseUsers(env) {
  return Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM license_users').first())?.n || 0);
}

async function createLicenseUsers(request, env, auth, projectId, body) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return fail(404, 'Project not found.');
  const count = body?.count === undefined ? 1 : Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > BATCH_LIMIT) return fail(400, 'Amount must be a whole number from 1 to 300.');
  const fields = licenseFields(body);
  if (fields.error) return fail(400, fields.error);
  const total = await totalLicenseUsers(env);
  if (total + count > USER_LIMIT) return fail(409, total >= USER_LIMIT ? `User limit reached (${USER_LIMIT}).` : `User limit reached. You can add ${USER_LIMIT - total} more.`);
  const created = [];
  for (let i = 0; i < count; i += 1) {
    let row = null;
    for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
      const id = randomHex(12);
      const key = licenseKey();
      try {
        await env.DB.prepare('INSERT INTO license_users (id, project_id, license_key, discord_id, memo, reset_days) VALUES (?,?,?,?,?,?)')
          .bind(id, projectId, key, fields.discord, fields.memo, fields.resetDays).run();
        row = await env.DB.prepare('SELECT * FROM license_users WHERE id = ?').bind(id).first();
      } catch (error) {
        if (!String(error?.message || error).includes('UNIQUE')) throw error;
      }
    }
    if (!row) return fail(500, 'Could not generate unique keys. Try again.');
    created.push(licenseView(row));
  }
  await audit(env, request, auth, 'license.create', projectId, 'ok');
  return json({ ok: true, users: created }, 201);
}

async function updateLicenseUser(request, env, auth, id, body) {
  const current = await env.DB.prepare('SELECT * FROM license_users WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'User not found.');
  const fields = licenseFields(body, current);
  if (fields.error) return fail(400, fields.error);
  await env.DB.prepare('UPDATE license_users SET discord_id = ?, memo = ?, reset_days = ? WHERE id = ?')
    .bind(fields.discord, fields.memo, fields.resetDays, id).run();
  await audit(env, request, auth, 'license.update', id, 'ok');
  return json({ ok: true, user: licenseView({ ...current, discord_id: fields.discord, memo: fields.memo, reset_days: fields.resetDays }) });
}

async function hardResetLicenseUser(request, env, auth, id) {
  const current = await env.DB.prepare('SELECT * FROM license_users WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'User not found.');
  if (current.last_reset) {
    const readyAt = Date.parse(current.last_reset) + current.reset_days * 86400000;
    if (readyAt > Date.now()) {
      const days = Math.ceil((readyAt - Date.now()) / 86400000);
      return fail(409, `Hard reset is on cooldown. Try again in ${days} day(s).`);
    }
  }
  const at = isoNow();
  const cutoff = new Date(Date.now() - current.reset_days * 86400000).toISOString();
  const applied = await env.DB.prepare(
    'UPDATE license_users SET resets = resets + 1, last_reset = ?, hwid = NULL WHERE id = ? AND (last_reset IS NULL OR last_reset <= ?)'
  ).bind(at, id, cutoff).run();
  if (!applied.meta?.changes) return fail(409, 'Hard reset is on cooldown.');
  await audit(env, request, auth, 'license.reset', id, 'ok');
  return json({ ok: true, user: licenseView({ ...current, resets: current.resets + 1, last_reset: at, hwid: null }) });
}

async function deleteLicenseUser(request, env, auth, id) {
  const result = await env.DB.prepare('DELETE FROM license_users WHERE id = ?').bind(id).run();
  if (!result.meta?.changes) return fail(404, 'User not found.');
  await audit(env, request, auth, 'license.delete', id, 'ok');
  return json({ ok: true, id });
}

async function deleteUnusedLicenseUsers(request, env, auth, projectId) {
  const result = await env.DB.prepare('DELETE FROM license_users WHERE project_id = ? AND used = 0').bind(projectId).run();
  await audit(env, request, auth, 'license.delete_unused', projectId, 'ok');
  return json({ ok: true, deleted: Number(result.meta?.changes || 0) });
}

async function importLicenseUsers(request, env, auth, projectId, body) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return fail(404, 'Project not found.');
  const entries = Array.isArray(body?.entries) ? body.entries : null;
  if (!entries) return fail(400, 'entries array is required.');
  if (entries.length > USER_LIMIT) return fail(400, `Import at most ${USER_LIMIT} entries at once.`);
  let room = USER_LIMIT - (await totalLicenseUsers(env));
  let added = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const entry of entries) {
    const key = typeof entry?.key === 'string' ? entry.key.trim() : '';
    if (!key || key.length > 64) {
      skipped += 1;
      continue;
    }
    if (room <= 0) {
      skipped += 1;
      continue;
    }
    const fields = licenseFields(entry);
    if (fields.error) {
      skipped += 1;
      continue;
    }
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO license_users (id, project_id, license_key, discord_id, memo, reset_days) VALUES (?,?,?,?,?,?)'
    ).bind(randomHex(12), projectId, key, fields.discord, fields.memo, fields.resetDays).run();
    if (result.meta?.changes) {
      added += 1;
      room -= 1;
    } else {
      duplicates += 1;
    }
  }
  await audit(env, request, auth, 'license.import', projectId, 'ok');
  return json({ ok: true, added, duplicates, skipped });
}

async function banIp(request, env, auth, body) {
  const ip = String(body?.ip ?? '').trim();
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return fail(400, 'Enter a valid IP address.');
  if (ip === request.headers.get('cf-connecting-ip')) return fail(409, '현재 접속 중인 IP는 차단할 수 없습니다.');
  const reason = safeName(body?.reason);
  await env.DB.prepare('INSERT OR IGNORE INTO banned_ips (ip, reason) VALUES (?,?)').bind(ip, reason).run();
  await audit(env, request, auth, 'ip.ban', ip, 'ok');
  return json({ ok: true, ip, reason }, 201);
}

async function unbanIp(request, env, auth, ip) {
  const result = await env.DB.prepare('DELETE FROM banned_ips WHERE ip = ?').bind(ip).run();
  if (!result.meta?.changes) return fail(404, 'IP not found.');
  await audit(env, request, auth, 'ip.unban', ip, 'ok');
  return json({ ok: true, ip });
}

function deniedPage() {
  return new Response(`<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>접근 불가</title></head>
<body style="font-family:system-ui,sans-serif;background:#15171c;color:#f3f4f6;padding:40px"><h1>브라우저에서는 열람할 수 없습니다</h1><p>스크립트 원문은 관리 화면의 프로필 탭에서 확인하세요.</p></body></html>`, { status: 403, headers: HTML_HEADERS });
}

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function scriptPage(request, row) {
  const page = (status, title, inner) => new Response(`<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head>
<body><main class="shell">${inner}<footer class="footer">© 2026 jinhyuk.xyz</footer></main></body></html>`, { status, headers: HTML_HEADERS });
  if (!row) {
    return page(404, '스크립트를 찾을 수 없습니다', `<header class="topbar"><div><h1>스크립트를 찾을 수 없습니다</h1><p class="hint">주소를 다시 확인하세요.</p></div></header>`);
  }
  const keyMode = row.mode === 'key';
  const origin = new URL(request.url).origin;
  const loader = `${keyMode ? 'script_key = "여기에_스크립트_키"\n' : ''}loadstring(game:HttpGet("${origin}/${row.slug}"))()`;
  const note = keyMode
    ? '이 스크립트는 스크립트 키가 있어야 실행됩니다. 발급받은 키를 위 줄에 넣으세요.'
    : '아래 로더를 Roblox 실행기에 붙여넣으면 바로 실행됩니다.';
  return page(200, row.name, `
  <header class="topbar"><div><nav class="breadcrumb"><span>jinhyuk.xyz</span></nav><h1>${esc(row.name)}</h1></div></header>
  <section class="panel">
    <div class="panel-head">
      <div class="project-text"><p>${esc(row.slug)}</p></div>
      <span class="pill ${keyMode ? 'draft' : 'active'}">${keyMode ? 'KEY 필요' : '공개'}</span>
    </div>
    <div class="block" style="padding:22px;gap:14px">
      <p class="hint">${esc(note)}</p>
      <pre style="overflow-x:auto;padding:16px;border-radius:12px;background:rgba(0,0,0,.35);font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre"><code id="loader">${esc(loader)}</code></pre>
      <div class="row-inline"><button class="btn primary" id="copy" type="button">로더 복사</button></div>
    </div>
  </section>
  <script>
    document.getElementById('copy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(document.getElementById('loader').textContent);
        e.currentTarget.textContent = '복사됨';
      } catch {
        e.currentTarget.textContent = '복사 실패';
      }
    });
  </script>`);
}

async function serveRaw(request, env, kind, value) {
  const row = await env.DB.prepare(`SELECT id, slug, name, object_key, sha256, mode, created_by FROM hosted_scripts WHERE ${kind === 'id' ? 'id' : 'slug'} = ?`).bind(value).first();
  if (isBrowserRequest(request)) {
    if (!row) return scriptPage(request, null);
    return deniedPage();
  }
  if (!row) return new Response('Script not found', { status: 404, headers: TEXT_HEADERS });
  if (row.mode === 'key') {
    await audit(env, request, null, 'script.raw.stub', row.id, 'ok');
    return new Response(keyStub(row.slug, new URL(request.url).origin), { headers: { ...TEXT_HEADERS, 'content-disposition': contentDisposition(row.slug) } });
  }
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return new Response('Script content missing', { status: 404, headers: TEXT_HEADERS });
  await audit(env, request, null, 'script.raw', row.id, 'ok');
  return new Response(object.body, { headers: { ...TEXT_HEADERS, 'content-disposition': contentDisposition(row.slug), 'x-script-sha256': row.sha256 } });
}

const DELIVERY_CHUNK_COUNT = 6;
const DELIVERY_SESSION_SECONDS = 120;

function splitScriptIntoChunks(code) {
  const points = Array.from(code);
  const chunks = [];
  for (let i = 0; i < DELIVERY_CHUNK_COUNT; i++) {
    const start = Math.floor(points.length * i / DELIVERY_CHUNK_COUNT);
    const end = Math.floor(points.length * (i + 1) / DELIVERY_CHUNK_COUNT);
    chunks.push(points.slice(start, end).join(''));
  }
  return chunks;
}

async function startKeyDelivery(request, env, body) {
  if (!body || typeof body.slug !== 'string' || typeof body.key !== 'string' || body.key.length > 256) return fail(400, 'slug and key are required.');
  const slug = normalizeSlug(body.slug);
  const key = body.key.trim();
  const script = await env.DB.prepare('SELECT * FROM hosted_scripts WHERE slug = ?').bind(slug).first();
  if (!script || script.mode !== 'key' || script.status === 'DRAFT') return fail(404, 'Script not found.');
  const hwid = typeof body.hwid === 'string' ? body.hwid.trim().slice(0, 128) : '';
  if (script.hwid_lock && !hwid) return fail(400, 'hwid is required for this script.');
  const keyHash = await sha256Hex(key);
  let keyType = '';
  let keyId = '';
  let license = null;
  if (script.project_id) {
    license = await env.DB.prepare('SELECT id, hwid FROM license_users WHERE license_key = ? AND project_id = ?').bind(key, script.project_id).first();
  }
  if (license) {
    keyType = 'license';
    keyId = license.id;
    if (script.hwid_lock) {
      if (license.hwid && license.hwid !== hwid) {
        await audit(env, request, null, 'script.key_session', script.id, 'hwid_mismatch');
        return fail(403, 'This key is bound to another device.');
      }
      if (!license.hwid) {
        await env.DB.prepare('UPDATE license_users SET hwid = ? WHERE id = ? AND hwid IS NULL').bind(hwid, license.id).run();
        const bound = await env.DB.prepare('SELECT hwid FROM license_users WHERE id = ?').bind(license.id).first();
        if (bound?.hwid !== hwid) return fail(403, 'This key is bound to another device.');
      }
    }
    await env.DB.prepare('UPDATE license_users SET used = 1 WHERE id = ?').bind(license.id).run();
  } else {
    const row = await env.DB.prepare(
      `SELECT sk.id, sk.user_id, sk.status, sk.expires_at, sk.hwid, u.status AS user_status
       FROM script_keys sk JOIN api_users u ON u.id = sk.user_id
       WHERE sk.key_hash = ? AND sk.script_id = ?`
    ).bind(keyHash, script.id).first();
    const valid = row && row.status === 'active' && row.user_status === 'active' && !isExpired(row.expires_at);
    if (!valid) {
      const result = await recordInvalidScriptKey(env, request, script.id);
      if (result.banned) return fail(403, 'Access temporarily blocked for 72 hours.');
      if (result.decoy) {
        keyType = 'decoy';
        keyId = '';
      } else {
        return fail(403, 'Invalid or inactive script key.');
      }
    } else {
      keyType = 'script';
      keyId = row.id;
      if (script.hwid_lock) {
        if (row.hwid && row.hwid !== hwid) {
          await audit(env, request, { user: { id: row.user_id }, keyId: row.id }, 'script.key_session', script.id, 'hwid_mismatch');
          return fail(403, 'This key is bound to another device.');
        }
        if (!row.hwid) {
          await env.DB.prepare('UPDATE script_keys SET hwid = ? WHERE id = ? AND hwid IS NULL').bind(hwid, row.id).run();
          const bound = await env.DB.prepare('SELECT hwid FROM script_keys WHERE id = ?').bind(row.id).first();
          if (bound?.hwid !== hwid) return fail(403, 'This key is bound to another device.');
        }
      }
      await env.DB.prepare(`UPDATE script_keys SET last_used_at = ${NOW_SQL} WHERE id = ?`).bind(row.id).run();
    }
  }
  const token = newSecret('tds_', 48);
  const expiresAt = new Date(Date.now() + DELIVERY_SESSION_SECONDS * 1000).toISOString();
  const sessionId = randomHex(16);
  await env.DB.prepare(
    `INSERT INTO script_delivery_sessions (id, token_hash, script_id, key_type, key_id, key_hash, hwid, initial_ip, next_chunk, expires_at, decoy)
     VALUES (?,?,?,?,?,?,?,?,0,?,?)`
  ).bind(sessionId, await sha256Hex(token), script.id, keyType, keyId || null, keyHash, hwid || null, request.headers.get('cf-connecting-ip') || null, expiresAt, keyType === 'decoy' ? 1 : 0).run();
  await env.DB.prepare(`DELETE FROM script_delivery_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))`).bind(new Date().toISOString()).run();
  await recordSecurityEvent(env, request, 'script.delivery.session_created', 'ok', script.id);
  return json({ ok: true, token, chunks: DELIVERY_CHUNK_COUNT, expires_at: expiresAt });
}

async function validateDeliverySession(env, session) {
  if (session.decoy) return true;
  const script = await env.DB.prepare('SELECT project_id, hwid_lock, status FROM hosted_scripts WHERE id = ?').bind(session.script_id).first();
  if (!script || script.status === 'DRAFT') return false;
  if (session.key_type === 'license') {
    const row = await env.DB.prepare('SELECT license_key, hwid, project_id FROM license_users WHERE id = ?').bind(session.key_id).first();
    if (!row || row.project_id !== script.project_id || await sha256Hex(row.license_key) !== session.key_hash) return false;
    if (script.hwid_lock && (!session.hwid || row.hwid !== session.hwid)) return false;
    return true;
  }
  if (session.key_type === 'script') {
    const row = await env.DB.prepare(
      `SELECT sk.key_hash, sk.status, sk.expires_at, sk.hwid, u.status AS user_status
       FROM script_keys sk JOIN api_users u ON u.id = sk.user_id
       WHERE sk.id = ? AND sk.script_id = ?`
    ).bind(session.key_id, session.script_id).first();
    if (!row || row.key_hash !== session.key_hash || row.status !== 'active' || row.user_status !== 'active' || isExpired(row.expires_at)) return false;
    if (script.hwid_lock && (!session.hwid || row.hwid !== session.hwid)) return false;
    return true;
  }
  return false;
}

async function deliverKeyChunk(request, env, body) {
  if (!body || typeof body.token !== 'string' || body.token.length > 256 || !Number.isInteger(body.index)) return fail(400, 'token and chunk index are required.');
  const tokenHash = await sha256Hex(body.token);
  const session = await env.DB.prepare('SELECT * FROM script_delivery_sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!session) return fail(403, 'Delivery session is invalid.');
  const now = new Date().toISOString();
  if (session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
    await recordSecurityEvent(env, request, 'script.delivery.expired_or_revoked', 'denied', session.script_id);
    return fail(403, 'Delivery session expired. Request a new loader.');
  }
  if (body.index < 0 || body.index >= DELIVERY_CHUNK_COUNT || body.index !== session.next_chunk) {
    await env.DB.prepare('UPDATE script_delivery_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, session.id).run();
    await recordSecurityEvent(env, request, 'script.delivery.replay_or_order_violation', 'blocked', session.script_id);
    return fail(409, 'Chunk order is invalid. Request a new loader.');
  }
  if (!(await validateDeliverySession(env, session))) {
    await env.DB.prepare('UPDATE script_delivery_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, session.id).run();
    await recordSecurityEvent(env, request, 'script.delivery.key_revoked', 'blocked', session.script_id);
    return fail(403, 'License is no longer active.');
  }
  let code = DECOY_CODE;
  if (!session.decoy) {
    const script = await env.DB.prepare('SELECT object_key, served_sha256 FROM hosted_scripts WHERE id = ?').bind(session.script_id).first();
    const object = script?.object_key ? await env.BUCKET.get(script.object_key) : null;
    if (!object) return fail(404, 'Script content missing.');
    code = await object.text();
    const actualDigest = await sha256Hex(code);
    if (script.served_sha256 && actualDigest !== script.served_sha256) {
      await env.DB.prepare('UPDATE script_delivery_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, session.id).run();
      await recordSecurityEvent(env, request, 'script.delivery.integrity_failure', 'blocked', session.script_id);
      return fail(500, 'Protected script integrity check failed.');
    }
    if (!script.served_sha256) {
      await env.DB.prepare('UPDATE hosted_scripts SET served_sha256 = ? WHERE id = ? AND served_sha256 IS NULL').bind(actualDigest, session.script_id).run();
    }
  }
  const chunks = splitScriptIntoChunks(code);
  const chunk = chunks[body.index];
  const updated = await env.DB.prepare(
    `UPDATE script_delivery_sessions
     SET next_chunk = next_chunk + 1, revoked_at = CASE WHEN next_chunk = ? THEN ? ELSE revoked_at END
     WHERE id = ? AND next_chunk = ? AND revoked_at IS NULL AND expires_at > ?`
  ).bind(DELIVERY_CHUNK_COUNT - 1, now, session.id, body.index, now).run();
  if (!updated.meta || updated.meta.changes !== 1) {
    await env.DB.prepare('UPDATE script_delivery_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, session.id).run();
    await recordSecurityEvent(env, request, 'script.delivery.replay_or_race', 'blocked', session.script_id);
    return fail(409, 'Chunk was already consumed. Request a new loader.');
  }
  await recordSecurityEvent(env, request, 'script.delivery.chunk_sent', 'ok', `${session.script_id}:${body.index}`);
  return json({ ok: true, index: body.index, total: DELIVERY_CHUNK_COUNT, chunk, sha256: await sha256Hex(chunk) });
}

async function execute(request, env, auth, body) {
  if (!body || (!body.id && !body.slug)) return fail(400, 'id or slug is required.');
  const script = body.id
    ? await env.DB.prepare('SELECT * FROM hosted_scripts WHERE id = ?').bind(String(body.id)).first()
    : await env.DB.prepare('SELECT * FROM hosted_scripts WHERE slug = ?').bind(normalizeSlug(body.slug)).first();
  if (!script) return fail(404, 'Script not found.');
  if (!canViewSource(auth.user, script)) return fail(403, '원문은 작성자와 소유자만 볼 수 있습니다.');
  const object = await env.BUCKET.get(script.raw_object_key || script.object_key);
  if (!object) return fail(404, 'Script content missing.');
  const code = await object.text();
  await audit(env, request, auth, 'script.execute', script.id, 'ok');
  return json({ ok: true, script: { id: script.id, name: script.name, slug: script.slug, mode: script.mode, key_policy: script.key_policy, sha256: script.sha256 }, code });
}

async function uniqueSlug(env, name) {
  const root = (safeSlug(name) || `script-${randomHex(3)}`).replace(/\.lua$/, '');
  for (let i = 0; i < 50; i += 1) {
    const suffix = i === 0 ? '' : `-${i + 1}`;
    const candidate = root.slice(0, 56 - suffix.length) + suffix;
    if (RESERVED.includes(candidate)) continue;
    if (!(await env.DB.prepare('SELECT id FROM hosted_scripts WHERE slug = ?').bind(candidate).first())) return candidate;
  }
  return null;
}

const scriptView = (row) => ({ ...row });

async function getScriptRow(env, id) {
  return env.DB.prepare(`SELECT ${SCRIPT_COLUMNS} FROM hosted_scripts WHERE id = ?`).bind(id).first();
}

function scriptOptions(body, current) {
  return {
    hwid: boolInt(body.hwid_lock, current?.hwid_lock ?? 0),
    silent: boolInt(body.silent, current?.silent ?? 0),
    heartbeat: boolInt(body.heartbeat, current?.heartbeat ?? 1),
    lightweight: boolInt(body.lightweight, current?.lightweight ?? 0),
    secure: boolInt(body.secure_loader, current?.secure_loader ?? 1)
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function obfuscateLua(env, code) {
  try {
    return obfuscate(code);
  } catch (error) {
    throw new HttpError(422, `난독화 실패: ${error.message}`);
  }
}

async function putRaw(env, { scriptId, rawKey, rawCode, objectKey, digest }) {
  await env.BUCKET.put(rawKey, rawCode, {
    ...OBJECT_META,
    customMetadata: { scriptId, sha256: digest, role: 'raw', pair: objectKey },
  });
}

async function putObfuscated(env, { scriptId, rawKey, objectKey, served, digest, servedDigest }) {
  await env.BUCKET.put(objectKey, served, {
    ...OBJECT_META,
    customMetadata: { scriptId, sha256: digest, servedSha256: servedDigest, role: 'obfuscated', obfuscated: '1', pair: rawKey },
  });
}

async function createScript(request, env, auth, body) {
  if (!body || typeof body.code !== 'string') return fail(400, 'A code string is required.');
  const name = safeName(body.name) || 'Untitled script';
  const mode = body.mode === undefined ? 'keyless' : String(body.mode);
  const policy = body.key_policy === undefined ? 'open' : String(body.key_policy);
  if (!MODES.includes(mode) || !POLICIES.includes(policy)) return fail(400, 'Invalid mode or key_policy.');
  const projectId = body.project_id ? String(body.project_id) : null;
  if (projectId) {
    const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
    if (!project) return fail(404, 'Project not found.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM hosted_scripts WHERE project_id = ?').bind(projectId).first();
    if (Number(count.n) >= SCRIPT_LIMIT) return fail(409, `Script limit reached (${SCRIPT_LIMIT}).`);
  }
  let slug;
  if (body.slug) {
    slug = safeSlug(body.slug);
    if (!slug || RESERVED.includes(slug)) return fail(400, 'A valid URL name is required.');
    if (await env.DB.prepare('SELECT id FROM hosted_scripts WHERE slug = ?').bind(slug).first()) return fail(409, 'That URL name is already in use.');
  } else {
    slug = await uniqueSlug(env, name);
    if (!slug) return fail(409, 'Could not create a unique URL name.');
  }
  const size = byteLength(body.code);
  if (size === 0) return fail(400, 'Script cannot be empty.');
  if (size > maxBytes(env)) return fail(413, `Script exceeds ${maxBytes(env)} bytes.`);
  const opts = scriptOptions(body, null);
  const id = randomHex(12);
  const objectKey = `scripts/${id}.lua`;
  const rawKey = `scripts/${id}.raw.lua`;
  const digest = await sha256Hex(body.code);

  await putRaw(env, { scriptId: id, rawKey, rawCode: body.code, objectKey, digest });

  let served;
  let servedDigest;
  try {
    served = await obfuscateLua(env, body.code);
    if (byteLength(served) > maxBytes(env)) throw new HttpError(413, `Obfuscated script exceeds ${maxBytes(env)} bytes.`);
    servedDigest = await sha256Hex(served);
    await audit(env, request, auth, 'script.obfuscate', id, 'ok');
  } catch (error) {
    await audit(env, request, auth, 'script.obfuscate', id, 'failed');
    await purgeObjects(env, [rawKey]);
    if (error instanceof HttpError) return fail(error.status, error.message);
    throw error;
  }

  try {
    await putObfuscated(env, { scriptId: id, rawKey, objectKey, served, digest, servedDigest });
  } catch (error) {
    await purgeObjects(env, [rawKey, objectKey]);
    throw error;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO hosted_scripts (id, slug, name, object_key, raw_object_key, obfuscated, byte_size, sha256, served_sha256, mode, key_policy, hwid_lock, silent, heartbeat, lightweight, secure_loader, project_id, status, version, created_by)
       VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE','v0.0.0.1',?)`
    ).bind(id, slug, name, objectKey, rawKey, size, digest, servedDigest, mode, policy, opts.hwid, opts.silent, opts.heartbeat, opts.lightweight, opts.secure, projectId, auth.user.id).run();
  } catch (error) {
    await purgeObjects(env, [objectKey, rawKey]);
    throw error;
  }
  await audit(env, request, auth, 'script.create', id, 'ok');
  return json({ ok: true, script: scriptView(await getScriptRow(env, id)), raw_url: publicUrl(new URL(request.url).origin, slug) }, 201);
}

async function updateScript(request, env, auth, id, body) {
  const current = await env.DB.prepare('SELECT * FROM hosted_scripts WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Script not found.');
  if (!body || typeof body !== 'object') return fail(400, 'JSON body required.');
  const name = body.name === undefined ? current.name : safeName(body.name) || current.name;
  const mode = body.mode === undefined ? current.mode : String(body.mode);
  const policy = body.key_policy === undefined ? current.key_policy : String(body.key_policy);
  if (!MODES.includes(mode) || !POLICIES.includes(policy)) return fail(400, 'Invalid mode or key_policy.');
  let slug = current.slug;
  if (body.slug !== undefined) {
    slug = safeSlug(body.slug);
    if (!slug || RESERVED.includes(slug)) return fail(400, 'A valid URL name is required.');
    if (await env.DB.prepare('SELECT id FROM hosted_scripts WHERE slug = ? AND id <> ?').bind(slug, id).first()) return fail(409, 'That URL name is already in use.');
  }
  const opts = scriptOptions(body, current);
  let size = current.byte_size;
  let digest = current.sha256;
  let servedDigest = current.served_sha256 || null;
  const newCode = typeof body.code === 'string' ? body.code : null;
  if (newCode !== null) {
    size = byteLength(newCode);
    if (!size || size > maxBytes(env)) return fail(413, `Script size must be between 1 and ${maxBytes(env)} bytes.`);
    digest = await sha256Hex(newCode);
  }
  const changed = name !== current.name || mode !== current.mode || policy !== current.key_policy || slug !== current.slug
    || opts.hwid !== current.hwid_lock || opts.silent !== current.silent || opts.heartbeat !== current.heartbeat
    || opts.lightweight !== current.lightweight || opts.secure !== current.secure_loader || digest !== current.sha256;
  const oldObjectKey = current.object_key;
  const oldRawKey = current.raw_object_key;
  let objectKey = oldObjectKey;
  let rawKey = oldRawKey;
  let obfuscated = current.obfuscated;
  if (newCode !== null) {
    const suffix = randomHex(6);
    objectKey = `scripts/${id}-${suffix}.lua`;
    rawKey = `scripts/${id}-${suffix}.raw.lua`;
    obfuscated = 1;

    await putRaw(env, { scriptId: id, rawKey, rawCode: newCode, objectKey, digest });

    let served;
    try {
      served = await obfuscateLua(env, newCode);
      if (byteLength(served) > maxBytes(env)) throw new HttpError(413, `Obfuscated script exceeds ${maxBytes(env)} bytes.`);
      servedDigest = await sha256Hex(served);
      await audit(env, request, auth, 'script.obfuscate', id, 'ok');
    } catch (error) {
      await audit(env, request, auth, 'script.obfuscate', id, 'failed');
      await purgeObjects(env, [rawKey]);
      if (error instanceof HttpError) return fail(error.status, error.message);
      throw error;
    }

    try {
      await putObfuscated(env, { scriptId: id, rawKey, objectKey, served, digest, servedDigest });
    } catch (error) {
      await purgeObjects(env, [rawKey, objectKey]);
      throw error;
    }
  }
  const version = changed ? bumpVersion(current.version) : current.version;
  const status = changed || current.status !== 'ACTIVE' ? 'ACTIVE' : current.status;
  try {
    await env.DB.prepare(
      `UPDATE hosted_scripts SET object_key = ?, raw_object_key = ?, obfuscated = ?, slug = ?, name = ?, byte_size = ?, sha256 = ?, served_sha256 = ?, mode = ?, key_policy = ?, hwid_lock = ?, silent = ?, heartbeat = ?, lightweight = ?, secure_loader = ?, status = ?, version = ?, updated_at = ${NOW_SQL} WHERE id = ?`
    ).bind(objectKey, rawKey, obfuscated, slug, name, size, digest, servedDigest, mode, policy, opts.hwid, opts.silent, opts.heartbeat, opts.lightweight, opts.secure, status, version, id).run();
  } catch (error) {
    if (objectKey !== oldObjectKey) await purgeObjects(env, [objectKey, rawKey]);
    throw error;
  }
  if (objectKey !== oldObjectKey) await purgeObjects(env, [oldObjectKey, oldRawKey].filter(Boolean));
  await audit(env, request, auth, 'script.update', id, 'ok');
  return json({ ok: true, script: scriptView(await getScriptRow(env, id)), raw_url: publicUrl(new URL(request.url).origin, slug) });
}

async function purgeObjects(env, keys) {
  for (const key of keys) {
    try {
      await env.BUCKET.delete(key);
    } catch (error) {
      console.error('R2 cleanup failed:', key, error);
    }
  }
}

async function deleteScript(request, env, auth, id) {
  const current = await env.DB.prepare('SELECT object_key, raw_object_key FROM hosted_scripts WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Script not found.');
  const { results: files = [] } = await env.DB.prepare('SELECT object_key FROM script_files WHERE script_id = ?').bind(id).all();
  await env.DB.prepare('DELETE FROM script_files WHERE script_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM script_keys WHERE script_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM hosted_scripts WHERE id = ?').bind(id).run();
  await purgeObjects(env, [...files.map((f) => f.object_key), current.object_key, current.raw_object_key].filter(Boolean));
  await audit(env, request, auth, 'script.delete', id, 'ok');
  return json({ ok: true, id });
}

async function listScriptFiles(env, scriptId) {
  const script = await env.DB.prepare('SELECT id FROM hosted_scripts WHERE id = ?').bind(scriptId).first();
  if (!script) return fail(404, 'Script not found.');
  const { results = [] } = await env.DB.prepare('SELECT id, name, byte_size, created_at FROM script_files WHERE script_id = ? ORDER BY created_at ASC').bind(scriptId).all();
  return json({ ok: true, files: results });
}

async function uploadScriptFile(request, env, auth, scriptId, body) {
  const script = await env.DB.prepare('SELECT id FROM hosted_scripts WHERE id = ?').bind(scriptId).first();
  if (!script) return fail(404, 'Script not found.');
  if (!body || typeof body.name !== 'string' || typeof body.content !== 'string') return fail(400, 'name and content are required.');
  const name = safeName(body.name);
  if (!name) return fail(400, 'File name is required.');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM script_files WHERE script_id = ?').bind(scriptId).first();
  if (Number(count.n) >= MAX_FILES) return fail(409, `File limit reached (${MAX_FILES}).`);
  const size = byteLength(body.content);
  if (!size || size > maxBytes(env)) return fail(413, `File size must be between 1 and ${maxBytes(env)} bytes.`);
  const id = randomHex(12);
  const objectKey = `scripts/${scriptId}/files/${id}`;
  await env.BUCKET.put(objectKey, body.content, OBJECT_META);
  await env.DB.prepare('INSERT INTO script_files (id, script_id, name, byte_size, object_key) VALUES (?,?,?,?,?)').bind(id, scriptId, name, size, objectKey).run();
  await audit(env, request, auth, 'script.file.upload', id, 'ok');
  const file = await env.DB.prepare('SELECT id, name, byte_size, created_at FROM script_files WHERE id = ?').bind(id).first();
  return json({ ok: true, file }, 201);
}

async function deleteScriptFile(request, env, auth, id) {
  const file = await env.DB.prepare('SELECT object_key FROM script_files WHERE id = ?').bind(id).first();
  if (!file) return fail(404, 'File not found.');
  await env.BUCKET.delete(file.object_key);
  await env.DB.prepare('DELETE FROM script_files WHERE id = ?').bind(id).run();
  await audit(env, request, auth, 'script.file.delete', id, 'ok');
  return json({ ok: true, id });
}

const MIN_KEY_MINUTES = 30;
const MAX_KEY_MINUTES = 3650 * 1440;
const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const expiresFromMinutes = (value) => {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < MIN_KEY_MINUTES || minutes > MAX_KEY_MINUTES) return { ok: false };
  return { ok: true, expiresAt: new Date(Date.now() + minutes * 60000).toISOString() };
};

const keyExpiry = (body) => {
  if (body?.expires_in_minutes !== undefined && body?.expires_in_minutes !== null && body?.expires_in_minutes !== '') {
    return expiresFromMinutes(body.expires_in_minutes);
  }
  return expiresFromDays(body?.expires_in_days === '' ? undefined : body?.expires_in_days);
};

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
  const expiry = keyExpiry(body);
  if (!expiry.ok) return fail(400, 'Expiry must be at least 30 minutes, or empty for a permanent key.');
  const memo = cleanText(body?.memo, 300);
  const discordId = cleanText(body?.discord_id, 20).replace(/\D/g, '');
  const token = newSecret('skey_', 32);
  const keyId = randomHex(12);
  await env.DB.prepare('INSERT INTO script_keys (id, script_id, user_id, key_hash, key_prefix, created_by, expires_at, token, memo, discord_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(keyId, script.id, holderId, await sha256Hex(token), token.slice(0, 12), actor.id, expiry.expiresAt, token, memo, discordId).run();
  await audit(env, request, auth, 'script_key.issue', keyId, 'ok');
  return json({ ok: true, key: { id: keyId, script_id: script.id, slug: script.slug, user_id: holderId, token, expires_at: expiry.expiresAt, memo, discord_id: discordId } }, 201);
}

async function findKeyScript(env, scriptId) {
  const script = await env.DB.prepare('SELECT id, slug, mode FROM hosted_scripts WHERE id = ?').bind(scriptId).first();
  if (!script) return { error: fail(404, 'Script not found.') };
  if (script.mode !== 'key') return { error: fail(400, 'This script is keyless. No script key is needed.') };
  return { script };
}

async function bulkIssueScriptKeys(request, env, auth, scriptId, body) {
  const found = await findKeyScript(env, scriptId);
  if (found.error) return found.error;
  const count = Number(body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 300) return fail(400, 'count must be between 1 and 300.');
  const expiry = keyExpiry(body);
  if (!expiry.ok) return fail(400, 'Expiry must be at least 30 minutes, or empty for a permanent key.');
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const token = newSecret('skey_', 32);
    const keyId = randomHex(12);
    await env.DB.prepare('INSERT INTO script_keys (id, script_id, user_id, key_hash, key_prefix, created_by, expires_at, token) VALUES (?,?,?,?,?,?,?,?)')
      .bind(keyId, found.script.id, auth.user.id, await sha256Hex(token), token.slice(0, 12), auth.user.id, expiry.expiresAt, token).run();
    keys.push({ id: keyId, token });
  }
  await audit(env, request, auth, 'script_key.bulk', found.script.id, 'ok');
  return json({ ok: true, count: keys.length, keys, slug: found.script.slug, expires_at: expiry.expiresAt }, 201);
}

async function importScriptKeys(request, env, auth, scriptId, body) {
  const found = await findKeyScript(env, scriptId);
  if (found.error) return found.error;
  const entries = Array.isArray(body?.entries) ? body.entries : null;
  if (!entries) return fail(400, 'entries array is required.');
  if (entries.length > 300) return fail(400, 'Import at most 300 entries at once.');
  let room = Infinity;
  let added = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const entry of entries) {
    const token = typeof entry?.key === 'string' ? entry.key.trim() : '';
    if (!token || token.length > 128 || room <= 0) {
      skipped += 1;
      continue;
    }
    const hash = await sha256Hex(token);
    const exists = await env.DB.prepare('SELECT id FROM script_keys WHERE key_hash = ?').bind(hash).first();
    if (exists) {
      duplicates += 1;
      continue;
    }
    await env.DB.prepare('INSERT INTO script_keys (id, script_id, user_id, key_hash, key_prefix, created_by, expires_at, token) VALUES (?,?,?,?,?,?,?,?)')
      .bind(randomHex(12), found.script.id, auth.user.id, hash, token.slice(0, 12), auth.user.id, null, token).run();
    added += 1;
    room -= 1;
  }
  await audit(env, request, auth, 'script_key.import', found.script.id, 'ok');
  return json({ ok: true, added, duplicates, skipped });
}

async function deleteUnusedScriptKeys(request, env, auth, scriptId) {
  const found = await findKeyScript(env, scriptId);
  if (found.error) return found.error;
  const own = auth.user.role === 'user';
  const sql = 'DELETE FROM script_keys WHERE script_id = ? AND last_used_at IS NULL AND hwid IS NULL' + (own ? ' AND user_id = ?' : '');
  const bound = own ? [found.script.id, auth.user.id] : [found.script.id];
  const result = await env.DB.prepare(sql).bind(...bound).run();
  const removed = result.meta?.changes ?? 0;
  await audit(env, request, auth, 'script_key.delete_unused', found.script.id, 'ok');
  return json({ ok: true, removed });
}

async function exportScriptKeys(env, auth, scriptId) {
  const found = await findKeyScript(env, scriptId);
  if (found.error) return found.error;
  const own = auth.user.role === 'user';
  const sql = 'SELECT id, token, status, expires_at FROM script_keys WHERE script_id = ? AND token IS NOT NULL' + (own ? ' AND user_id = ?' : '') + ' ORDER BY created_at DESC';
  const bound = own ? [found.script.id, auth.user.id] : [found.script.id];
  const { results = [] } = await env.DB.prepare(sql).bind(...bound).all();
  return json({ ok: true, slug: found.script.slug, keys: results });
}

async function listScriptKeys(env, auth) {
  const actor = auth.user;
  const base = `SELECT sk.id, sk.script_id, s.slug, sk.user_id, u.username, sk.key_prefix, sk.memo, sk.discord_id, sk.status, sk.expires_at, sk.created_at, sk.last_used_at, (sk.hwid IS NOT NULL) AS hwid_bound
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
  if (body && (body.memo !== undefined || body.discord_id !== undefined)) {
    const memo = cleanText(body.memo, 300);
    const discordId = cleanText(body.discord_id, 20).replace(/\D/g, '');
    await env.DB.prepare('UPDATE script_keys SET memo = ?, discord_id = ? WHERE id = ?').bind(memo, discordId, keyId).run();
    await audit(env, request, auth, 'script_key.meta', keyId, 'ok');
    return json({ ok: true, id: keyId, memo, discord_id: discordId });
  }
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

  const expiry = expiresFromDays(body.expires_in_days);
  if (!expiry.ok) return fail(400, 'expires_in_days must be between 1 and 3650.');
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : null;
  const projectId = body.project_id ? String(body.project_id) : null;
  if (projectId && !(await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first())) return fail(404, 'Project not found.');

  let target = null;
  let newUser = null;
  if (body.user_id) {
    target = await env.DB.prepare('SELECT id, username, role, status FROM api_users WHERE id = ?').bind(String(body.user_id)).first();
    if (!target) return fail(404, 'User not found.');
  } else if (body.username === undefined || body.username === null || body.username === '') {
    target = await env.DB.prepare('SELECT id, username, role, status FROM api_users WHERE id = ?').bind(actor.id).first();
    if (!target) return fail(404, 'User not found.');
  } else {
    const username = safeUsername(body.username);
    if (!username) return fail(400, 'username is invalid.');
    target = await env.DB.prepare('SELECT id, username, role, status FROM api_users WHERE username = ?').bind(username).first();
    if (!target) {
      if (actor.role === 'admin' && role !== 'user') return fail(403, 'Admins can only create user accounts.');
      newUser = { id: randomHex(12), username, role, status: 'active' };
      target = newUser;
    }
  }
  if (actor.role === 'admin' && target.role !== 'user') return fail(403, 'Admins can only manage user accounts.');
  if (target.status !== 'active') return fail(409, 'User is blocked.');
  if (newUser) {
    await env.DB.prepare('INSERT INTO api_users (id, username, role, status, created_by) VALUES (?,?,?,?,?)').bind(newUser.id, newUser.username, newUser.role, 'active', actor.id).run();
  }
  const key = newSecret('tmk_');
  const keyId = randomHex(12);
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_by, expires_at, label, project_id, token) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(keyId, target.id, await sha256Hex(key), key.slice(0, 12), actor.id, expiry.expiresAt, label, projectId, key).run();
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
  if (role !== undefined && role !== target.role) {
    if (actor.role !== 'owner') return fail(403, 'Only the owner can change roles.');
    if (!ROLES.includes(role)) return fail(400, 'Invalid role.');
  }
  const nextStatus = status ?? target.status;
  const nextRole = role ?? target.role;
  await env.DB.prepare(`UPDATE api_users SET status = ?, role = ?, updated_at = ${NOW_SQL} WHERE id = ?`).bind(nextStatus, nextRole, userId).run();
  await audit(env, request, auth, 'user.update', userId, 'ok');
  return json({ ok: true, user: { id: userId, username: target.username, role: nextRole, status: nextStatus } });
}
