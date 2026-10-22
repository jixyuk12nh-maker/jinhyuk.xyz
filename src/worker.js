const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
import { obfuscate, obfuscateBundle, plainBundle, plainDecoyPart } from './obfuscator.js';
import { withAutoSchema, ensureMigrated } from './autoschema.js';
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
const SCRIPT_COLUMNS = 'id, slug, name, mode, key_policy, hwid_lock, silent, heartbeat, lightweight, secure_loader, obfuscated, vm_obfuscate, status, version, project_id, byte_size, sha256, served_sha256, created_at, updated_at, created_by';

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
// Lua 문자열 리터럴(바이트 단위 이스케이프). 엔진 텍스트를 로더 안에 넣을 때 쓴다.
const luaQuote = (text) => {
  let out = '"';
  for (const b of new TextEncoder().encode(text)) {
    out += b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : '\\' + String(b).padStart(3, '0');
  }
  return out + '"';
};
const keyStub = (slug, origin, engine) => `local request_fn = (syn and syn.request) or (http and http.request) or http_request or request
assert(request_fn, "이 실행기는 request 함수를 지원하지 않습니다")
assert(type(script_key) == "string" and script_key ~= "", "script_key를 먼저 설정하세요")
local HttpService = game:GetService("HttpService")
local hwid = "unknown"
pcall(function() hwid = game:GetService("RbxAnalyticsService"):GetClientId() end)
local function post(path, body)
    return request_fn({ Url = "${origin}" .. path, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = HttpService:JSONEncode(body) })
end
local function fletcher(s)
    local a, b = 1, 0
    for i = 1, #s do
        a = (a + string.byte(s, i)) % 65521
        b = (b + a) % 65521
    end
    return b * 65521 + a
end
local started = post("/api/key-session", { slug = "${slug}", key = script_key, hwid = hwid })
assert(started and started.StatusCode == 200, "스크립트 키 검증에 실패했습니다")
local session = HttpService:JSONDecode(started.Body)
assert(session and session.ok and type(session.token) == "string", "보안 세션을 만들 수 없습니다")
local ENGINE = ${luaQuote(engine)}
local PR, seen, got = {}, {}, 0
for seq = 0, 5 do
    local response = post("/api/key-chunk", { token = session.token, seq = seq })
    assert(response and response.StatusCode == 200, "스크립트 조각 검증에 실패했습니다")
    local part = HttpService:JSONDecode(response.Body)
    assert(part and part.ok and part.total == 6 and type(part.index) == "number" and part.index >= 0 and part.index <= 5, "스크립트 조각이 유효하지 않습니다")
    assert(not seen[part.index] and type(part.chunk) == "string", "스크립트 조각 순서가 잘못됐습니다")
    assert(fletcher(part.chunk) == part.cf, "스크립트 조각 변조가 감지됐습니다")
    seen[part.index] = true
    local piece = assert(loadstring(part.chunk), "스크립트 조각을 읽을 수 없습니다")
    for k, v in pairs(piece()) do PR[k] = v end
    got = got + 1
end
assert(got == 6, "스크립트 조각이 모두 도착하지 않았습니다")
local main = assert(loadstring(ENGINE), "엔진을 읽을 수 없습니다")()(PR)
main()
`;
// R2 경로 규칙: scripts/<유저이름>/obfuscated/<id>.lua (난독화본), scripts/<유저이름>/raw/<id>.lua (원문).
// 유저 이름이 경로에 못 쓰이면 유저 id 를 쓴다. 실제 경로는 D1(object_key, raw_object_key)에 저장되므로 기존 스크립트는 그대로 동작한다.
async function ownerFolder(env, userId) {
  const row = await env.DB.prepare('SELECT username FROM api_users WHERE id = ?').bind(userId).first();
  return safeUsername(row?.username) ?? userId;
}
async function scriptObjectKeys(env, userId, scriptId, suffix = '') {
  const folder = await ownerFolder(env, userId);
  const name = suffix ? `${scriptId}-${suffix}` : scriptId;
  return {
    objectKey: `scripts/${folder}/obfuscated/${name}.lua`,
    rawKey: `scripts/${folder}/raw/${name}.lua`,
  };
}

// 저장 시 만드는 R2 객체 묶음. objectKey(scripts/<id>.lua) 기준으로 이름을 정한다.
//   <base>.part0~5.lua      난독화본을 6조각으로 나눈 것 (조각 번호 = 인덱스)
//   <base>.manifest.json    조각별 sha256/cf, 전체 sha256/len/fp
//   <base>.loader.lua       키 모드 로더 (난독화됨, slug/origin 포함)
function bundleKeys(objectKey) {
  const base = objectKey.replace(/\.lua$/, '');
  return {
    parts: Array.from({ length: DELIVERY_CHUNK_COUNT }, (_, i) => `${base}.part${i + 1}.lua`),
    manifest: `${base}.manifest.json`,
    engine: `${base}.engine.lua`,
    loader: `${base}.loader.lua`,
  };
}
function allBundleKeys(objectKey) {
  if (!objectKey) return [];
  const k = bundleKeys(objectKey);
  return [objectKey, ...k.parts, k.manifest, k.engine, k.loader];
}
// 저장할 때 한 번만 호출한다. 조각 6개 → 엔진 → 매니페스트 → 로더 순으로 쓴다. 매니페스트가 있어야 전송이 시작된다.
async function putDelivery(env, { objectKey, bundle, servedDigest, slug, origin }) {
  const keys = bundleKeys(objectKey);
  const parts = [];
  for (let i = 0; i < DELIVERY_CHUNK_COUNT; i++) {
    const text = bundle.parts[i];
    parts.push({ sha: await sha256Hex(text), cf: fletcher(text) });
    await env.BUCKET.put(keys.parts[i], text, OBJECT_META);
  }
  await env.BUCKET.put(keys.engine, bundle.engine, OBJECT_META);
  const manifest = { v: 2, full_sha: servedDigest, parts };
  await env.BUCKET.put(keys.manifest, JSON.stringify(manifest), OBJECT_META);
  await putLoader(env, objectKey, slug, origin);
}
// 로더는 엔진을 R2에서 읽어 만든다 (slug 가 바뀌었을 때도 이것만 다시 만든다)
async function putLoader(env, objectKey, slug, origin) {
  const keys = bundleKeys(objectKey);
  const engineObj = await env.BUCKET.get(keys.engine);
  if (!engineObj) throw new HttpError(500, '엔진 객체가 없습니다. 스크립트를 다시 저장하세요.');
  const loader = await obfuscateLua(env, keyStub(slug, origin, await engineObj.text()));
  await env.BUCKET.put(keys.loader, loader, OBJECT_META);
}
async function bundleDigest(bundle) {
  return sha256Hex(bundle.engine + '\u0000' + bundle.parts.join('\u0000'));
}
const safeUsername = (value) => {
  const v = String(value ?? '').trim();
  return /^[A-Za-z0-9_.-]{2,40}$/.test(v) ? v : null;
};
const maxBytes = (env) => Math.max(1024, Number(env.MAX_SCRIPT_BYTES || 41943040));
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
// 가짜 응답(decoy)도 난독화본만 보낸다. 빌드 시 obfuscate(원문 decoy, antiTamper:false) 결과를 상수로 둔다.
const DECOY_OBF = "local __vm56a42e62 = (function(_2cff6bda)\n  local unpack = unpack or table.unpack\n  local _19e9872f = _G\n  local getfenv = getfenv or function() return _G end\n  local setfenv = setfenv or function() end\n  local _5f04e5c4 = (bit32 and bit32.bxor) or function(_34fad1c2, _09d8e5e5)\n    local _8dde9f5a, _5b79b666 = 0, 1\n    while _34fad1c2 > 0 or _09d8e5e5 > 0 do\n      local _f36da3bf, _32c47afa = _34fad1c2 % 2, _09d8e5e5 % 2\n      if _f36da3bf ~= _32c47afa then _8dde9f5a = _8dde9f5a + _5b79b666 end\n      _34fad1c2, _09d8e5e5, _5b79b666 = (_34fad1c2 - _f36da3bf) / 2, (_09d8e5e5 - _32c47afa) / 2, _5b79b666 * 2\n    end\n    return _8dde9f5a\n  end\n  local _d6d93788 = _5f04e5c4(3741516, 42405)\n  local function _e595edcc(...) return { n = select(\"#\", ...), ... } end\n  -- base64 변형: 문자 4개 = 24비트 값 하나 (little-endian). 이스케이프 없이 문자열에 바로 들어간다.\n  local B64 = \"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\"\n  local MAPV = {}\n  for _c5ca279f = 1, 64 do MAPV[string.byte(B64, _c5ca279f)] = _c5ca279f - 1 end\n  local function unb64(_4ace96cc)\n    local _4ad4c841, n = {}, 0\n    for _c5ca279f = 1, #_4ace96cc, 4 do\n      local c1, c2, c3, c4 = string.byte(_4ace96cc, _c5ca279f, _c5ca279f + 3)\n      local _d03fcce1 = MAPV[c1] + MAPV[c2] * 64 + MAPV[c3] * 4096 + MAPV[c4] * 262144\n      n = n + 1\n      _4ad4c841[n] = string.char(_d03fcce1 % 256, math.floor(_d03fcce1 / 256) % 256, math.floor(_d03fcce1 / 65536) % 256)\n    end\n    return table.concat(_4ad4c841)\n  end\n  -- 문자열 상수: 바이트마다 키가 달라진다 (compile 쪽 kbAt과 같은 식)\n  local function _ae3ab974(_4ace96cc, _57daf2b2, ln)\n    local raw = unb64(_4ace96cc)\n    local _4ad4c841 = {}\n    for _c5ca279f = 1, ln do\n      local _7eb07bec = _c5ca279f - 1\n      local _7de0737a = (_57daf2b2 + _7eb07bec * 73 + (_7eb07bec * _7eb07bec) % 251) % 256\n      _4ad4c841[_c5ca279f] = string.char(_5f04e5c4(string.byte(raw, _c5ca279f), _7de0737a))\n    end\n    return table.concat(_4ad4c841)\n  end\n  -- 명령 블롭: 값마다 키 스트림으로 가려져 있다. compile 쪽 ksAt과 같은 식이다.\n  -- 로드 때 한 번만 풀고, 실행 루프에는 XOR이 없다.\n  local function _0f3e5807(_4ace96cc, sl)\n    local _4ad4c841, n, _5e5aa3e1 = {}, 0, 0\n    for _c5ca279f = 1, #_4ace96cc, 4 do\n      local c1, c2, c3, c4 = string.byte(_4ace96cc, _c5ca279f, _c5ca279f + 3)\n      local _d03fcce1 = MAPV[c1] + MAPV[c2] * 64 + MAPV[c3] * 4096 + MAPV[c4] * 262144\n      local _f36da3bf = (n * 2654435761 + sl) % 8388608\n      _f36da3bf = (_f36da3bf * _f36da3bf + _d6d93788) % 8388608\n      _f36da3bf = (_f36da3bf + _5e5aa3e1 * 131) % 8388608\n      local _18f9adf1 = _5f04e5c4(_d03fcce1, _f36da3bf)\n      n = n + 1\n      _4ad4c841[n] = _18f9adf1\n      _5e5aa3e1 = _18f9adf1\n    end\n    return _4ad4c841\n  end\n  -- 5.3 정수 연산. 64비트 두 보수를 32비트 두 조각(lo, hi)으로 나눠 처리한다. 모든 중간값은 2^53 안에서 정확하다.\n  -- 2^53을 넘는 결과는 부동소수점이라 정밀도가 떨어진다 (문서 참고).\n  local TWO32, TWO63, TWO64 = 2 ^ 32, 2 ^ 63, 2 ^ 64\n  local mtype = math.type\n  local shl, shr\n  local function split(_34fad1c2)\n    _34fad1c2 = math.floor(_34fad1c2)\n    return _34fad1c2 % TWO32, math.floor(_34fad1c2 / TWO32) % TWO32\n  end\n  local function join(lo, hi)\n    if hi >= 2147483648 then return math.floor((hi - TWO32) * TWO32 + lo) end\n    return math.floor(hi * TWO32 + lo)\n  end\n  local function idiv(_34fad1c2, _09d8e5e5)\n    local q = math.floor(_34fad1c2 / _09d8e5e5)\n    if mtype and (mtype(_34fad1c2) == \"float\" or mtype(_09d8e5e5) == \"float\" or type(_34fad1c2) == \"string\" or type(_09d8e5e5) == \"string\") then return q + 0.0 end\n    return q\n  end\n  local function b32(_d4de930b, _f36da3bf, _32c47afa)\n    local _8dde9f5a, _5b79b666 = 0, 1\n    for _ = 1, 32 do\n      local bx, by = _f36da3bf % 2, _32c47afa % 2\n      local bit\n      if _d4de930b == 1 then bit = bx * by\n      elseif _d4de930b == 2 then bit = (bx + by > 0) and 1 or 0\n      else bit = (bx ~= by) and 1 or 0 end\n      _8dde9f5a = _8dde9f5a + bit * _5b79b666\n      _f36da3bf, _32c47afa, _5b79b666 = (_f36da3bf - bx) / 2, (_32c47afa - by) / 2, _5b79b666 * 2\n    end\n    return _8dde9f5a\n  end\n  local function bitw(_d4de930b, _34fad1c2, _09d8e5e5)\n    local al, ah = split(_34fad1c2)\n    local bl, bh = split(_09d8e5e5)\n    return join(b32(_d4de930b, al, bl), b32(_d4de930b, ah, bh))\n  end\n  shl = function(_34fad1c2, n)\n    n = math.floor(n)\n    if n < 0 then return shr(_34fad1c2, -n) end\n    if n >= 64 then return 0 end\n    if n == 0 then return math.floor(_34fad1c2) end\n    local lo, hi = split(_34fad1c2)\n    if n >= 32 then return join(0, (lo * 2 ^ (n - 32)) % TWO32) end\n    local nlo = (lo * 2 ^ n) % TWO32\n    local nhi = ((hi % 2 ^ (32 - n)) * 2 ^ n + math.floor(lo / 2 ^ (32 - n))) % TWO32\n    return join(nlo, nhi)\n  end\n  shr = function(_34fad1c2, n) -- 논리 시프트 (5.3의 >> 는 부호 없는 시프트)\n    n = math.floor(n)\n    if n < 0 then return shl(_34fad1c2, -n) end\n    if n >= 64 then return 0 end\n    if n == 0 then return math.floor(_34fad1c2) end\n    local lo, hi = split(_34fad1c2)\n    if n >= 32 then return math.floor(hi / 2 ^ (n - 32)) end\n    return math.floor(hi * 2 ^ (32 - n) + math.floor(lo / 2 ^ n))\n  end\n  local function bnot(_34fad1c2) return -math.floor(_34fad1c2) - 1 end\n  -- 5.3 실행기(math.type 과 load 가 있음)에서는 내장 연산을 쓴다. 5.1 계열에서는 NAT 가 nil 이라 위 근사 구현을 쓴다.\n  local NAT = nil\n  if mtype and (load or loadstring) then\n    local okn, fns = pcall(function()\n      return { (load or loadstring)(\"return function(a, b) return a // b end, function(a, b) return a & b end, function(a, b) return a | b end, function(a, b) return a ~ b end, function(a, b) return a << b end, function(a, b) return a >> b end, function(a) return ~a end\")() }\n    end)\n    if okn and fns and fns[1] then NAT = fns end\n  end\n  local _4735e893 = {\n    [1] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 + _09d8e5e5 end,\n    [2] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 - _09d8e5e5 end,\n    [3] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 * _09d8e5e5 end,\n    [4] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 / _09d8e5e5 end,\n    [5] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 .. _09d8e5e5 end,\n    [6] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 == _09d8e5e5 end,\n    [7] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 ~= _09d8e5e5 end,\n    [8] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 < _09d8e5e5 end,\n    [9] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 <= _09d8e5e5 end,\n    [10] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 > _09d8e5e5 end,\n    [11] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 >= _09d8e5e5 end,\n    [12] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 % _09d8e5e5 end,\n    [13] = function(_34fad1c2, _09d8e5e5) return _34fad1c2 ^ _09d8e5e5 end,\n    [14] = function(_34fad1c2, _09d8e5e5) if NAT then return NAT[1](_34fad1c2, _09d8e5e5) end return idiv(_34fad1c2, _09d8e5e5) end,\n    [15] = function(_34fad1c2, _09d8e5e5) if NAT then return NAT[2](_34fad1c2, _09d8e5e5) end return bitw(1, _34fad1c2, _09d8e5e5) end,\n    [16] = function(_34fad1c2, _09d8e5e5) if NAT then return NAT[3](_34fad1c2, _09d8e5e5) end return bitw(2, _34fad1c2, _09d8e5e5) end,\n    [17] = function(_34fad1c2, _09d8e5e5) if NAT then return NAT[4](_34fad1c2, _09d8e5e5) end return bitw(3, _34fad1c2, _09d8e5e5) end,\n    [18] = function(_34fad1c2, _09d8e5e5) if NAT then return NAT[5](_34fad1c2, _09d8e5e5) end return shl(_34fad1c2, _09d8e5e5) end,\n    [19] = function(_34fad1c2, _09d8e5e5) if NAT then return NAT[6](_34fad1c2, _09d8e5e5) end return shr(_34fad1c2, _09d8e5e5) end,\n  }\n  local _e3de4954 = {\n    [1] = function(_34fad1c2) return -_34fad1c2 end,\n    [2] = function(_34fad1c2) return not _34fad1c2 end,\n    [3] = function(_34fad1c2) return #_34fad1c2 end,\n    [4] = function(_34fad1c2) if NAT then return NAT[7](_34fad1c2) end return bnot(_34fad1c2) end,\n  }\n  local function _dead(_f36da3bf)\n    if _f36da3bf == nil then return _f36da3bf end\n    local _32c47afa = _5f04e5c4(_f36da3bf, _d6d93788)\n    if _32c47afa ~= _32c47afa then return _32c47afa end\n    return _32c47afa + 0\n  end\n  -- 함수 원형을 처음 쓸 때 한 번만 푼다: 명령 블롭, 상수, 업밸류 기술자\n  local function _13a201ec(sl, n)\n    local _f36da3bf = (n * 2654435761 + sl) % 8388608\n    return (_f36da3bf * _f36da3bf + _d6d93788) % 8388608\n  end\n  -- Fletcher 류 체크섬 (mod 65521). _27466b48 = {_34fad1c2, _09d8e5e5}, 값은 0 이상 2^24 미만 정수\n  local function _21eede5f(_27466b48, _f36da3bf)\n    local _34fad1c2 = (_27466b48[1] + _f36da3bf) % 65521\n    _27466b48[1] = _34fad1c2\n    _27466b48[2] = (_27466b48[2] + _34fad1c2) % 65521\n  end\n  -- 실행 환경 감시: 전역 getfenv 교체, 디버그 훅 설치를 잡는다. _faabedf4 와 같은 주기로 돈다.\n  local _a74a1491 = rawget(_19e9872f, \"getfenv\")\n  local function _9cada147() error(\"VM: integrity\", 0) end\n  local function _0f5a9c15()\n    if rawget(_19e9872f, \"getfenv\") ~= _a74a1491 then _9cada147() end\n    local _10e185fc = rawget(_19e9872f, \"debug\")\n    if _10e185fc and _10e185fc.gethook and _10e185fc.gethook() ~= nil then _9cada147() end\n  end\n  -- 시작 때 한 번: 디버거로 한 줄씩 밟으면 시간이 크게 늘어난다 (임계값은 정상 실행의 수백 배)\n  local function _aa0b6bba()\n    if not os or not os.clock then return end\n    local _6cfff21f, _b7c02558 = os.clock(), 0\n    for _c5ca279f = 1, 20000 do _b7c02558 = _b7c02558 + _c5ca279f end\n    if os.clock() - _6cfff21f > 1.5 then _9cada147() end\n  end\n  -- 상수: 복호화 전 암호문 상태로 로드 때 한 번 검사한다\n  local function _5a0a8196(_a61ac96e)\n    local _1a767486, _27466b48 = _a61ac96e.k, { 1, 0 }\n    for _c5ca279f = 1, _a61ac96e.nk do\n      local _d03fcce1 = _1a767486[_c5ca279f]\n      if type(_d03fcce1) == \"table\" then\n        _21eede5f(_27466b48, 4); _21eede5f(_27466b48, _d03fcce1.ek); _21eede5f(_27466b48, _d03fcce1.ln); _21eede5f(_27466b48, _d03fcce1.t == \"n\" and 1 or 0)\n        local _4a0454af = _d03fcce1.es\n        for _7eb07bec = 1, #_4a0454af do _21eede5f(_27466b48, string.byte(_4a0454af, _7eb07bec)) end\n      elseif _d03fcce1 == nil then\n        _21eede5f(_27466b48, 1)\n      else\n        _21eede5f(_27466b48, 2); _21eede5f(_27466b48, _d03fcce1 and 1 or 0)\n      end\n    end\n    if _27466b48[2] * 65521 + _27466b48[1] ~= _5f04e5c4(_a61ac96e.hk, _d6d93788) then error(\"VM: integrity\", 0) end\n  end\n  -- 명령과 업밸류: 디코드된 평문을 호출마다 다시 검사한다 (메모리 패치 감지)\n  local function _faabedf4(_a61ac96e)\n    _0f5a9c15()\n    local _4a621435, _a0cdfd22 = _a61ac96e.c, _a61ac96e.u\n    local _3b809aae, _278ee826 = 1, 0\n    local _c0469dc3, _6c3934c8, _6a9cfc37, _1029ed11 = _a61ac96e.np, _a61ac96e.va and 1 or 0, _a61ac96e.nu, _a61ac96e.nk\n    _3b809aae = (_3b809aae + _c0469dc3) % 65521; _278ee826 = (_278ee826 + _3b809aae) % 65521\n    _3b809aae = (_3b809aae + _6c3934c8) % 65521; _278ee826 = (_278ee826 + _3b809aae) % 65521\n    _3b809aae = (_3b809aae + _6a9cfc37) % 65521; _278ee826 = (_278ee826 + _3b809aae) % 65521\n    _3b809aae = (_3b809aae + _1029ed11) % 65521; _278ee826 = (_278ee826 + _3b809aae) % 65521\n    for _c5ca279f = 1, #_4a621435 do _3b809aae = (_3b809aae + _4a621435[_c5ca279f]) % 65521; _278ee826 = (_278ee826 + _3b809aae) % 65521 end\n    for _c5ca279f = 1, _a61ac96e.nu * 2 do _3b809aae = (_3b809aae + _a0cdfd22[_c5ca279f]) % 65521; _278ee826 = (_278ee826 + _3b809aae) % 65521 end\n    if _278ee826 * 65521 + _3b809aae ~= _5f04e5c4(_a61ac96e.hc, _d6d93788) then error(\"VM: integrity\", 0) end\n  end\n  local function _db941e4e(_a61ac96e)\n    if not _a61ac96e.ready then\n      if type(_a61ac96e.c) == \"string\" then _a61ac96e.c = _0f3e5807(_a61ac96e.c, _a61ac96e.sl) end\n      for _c5ca279f = 1, _a61ac96e.nu * 2 do _a61ac96e.u[_c5ca279f] = _5f04e5c4(_a61ac96e.u[_c5ca279f], _13a201ec(_a61ac96e.sl, 1048576 + _c5ca279f)) end\n      _5a0a8196(_a61ac96e)\n      local _1a767486 = _a61ac96e.k\n      for _c5ca279f = 1, _a61ac96e.nk do\n        local _d03fcce1 = _1a767486[_c5ca279f]\n        if type(_d03fcce1) == \"table\" and _d03fcce1.ek then\n          local _4ace96cc = _ae3ab974(_d03fcce1.es, _d03fcce1.ek, _d03fcce1.ln)\n          if _d03fcce1.t == \"n\" then _1a767486[_c5ca279f] = tonumber(_4ace96cc) else _1a767486[_c5ca279f] = _4ace96cc end\n        end\n      end\n      -- 재검사 간격은 함수/빌드마다 다르다 (고정 상수가 없어야 패치 지점을 못 찾는다)\n      _a61ac96e.cs = _5f04e5c4(_a61ac96e.cs, _d6d93788)\n      _a61ac96e.ready = true\n    end\n    -- 로드 때는 항상 검사하고, 이후에는 함수마다 다른 간격(24~80회)으로 다시 검사한다\n    local n = _a61ac96e.cn + 1\n    _a61ac96e.cn = n\n    if n % _a61ac96e.cs == 1 then _faabedf4(_a61ac96e) end\n  end\n  local _0f38c319\n  _0f38c319 = function(_a61ac96e, _596cd8ed, E, SF, ...)\n    local ENV = E\n    _db941e4e(_a61ac96e)\n    local _4a621435 = _a61ac96e.c\n    local _4b026ee4 = _a61ac96e.pm\n    local _1a767486 = _a61ac96e.k\n    local _661ec7b3 = _e595edcc(...)\n    local _3fe2c1f0 = {}\n    for _c5ca279f = 1, _a61ac96e.np do _3fe2c1f0[_c5ca279f] = { _661ec7b3[_c5ca279f] } end\n    local _f698019c, _495b3ec6 = {}, 0\n    local _3a60807c\n    local _b90eb409 = 1\n    local function _f9ca5d41(_d03fcce1) _495b3ec6 = _495b3ec6 + 1; _f698019c[_495b3ec6] = _d03fcce1 end\n    local function _82f1e6a1() local _d03fcce1 = _f698019c[_495b3ec6]; _f698019c[_495b3ec6] = nil; _495b3ec6 = _495b3ec6 - 1; return _d03fcce1 end\n    while true do\n      local _d4de930b, _34fad1c2, _09d8e5e5 = _4b026ee4[_4a621435[_b90eb409]], _4a621435[_b90eb409 + 1], _4a621435[_b90eb409 + 2]\n      _b90eb409 = _b90eb409 + 3\n      if _d4de930b <= 102 then\nif _d4de930b <= 81 then\nif _d4de930b <= 34 then\nif _d4de930b <= 33 then\nif _d4de930b == 27 then\n        local _71ba68aa = _82f1e6a1()\n        if _71ba68aa ~= nil and _71ba68aa ~= false then _b90eb409 = 3 * _34fad1c2 + 1 end\nelseif _d4de930b == 29 then\n        local _c5ca279f, _c8c41fd3, _27466b48 = _3fe2c1f0[_34fad1c2][1], _3fe2c1f0[_34fad1c2 + 1][1], _3fe2c1f0[_34fad1c2 + 2][1]\n        if _27466b48 > 0 then _f9ca5d41(_c5ca279f <= _c8c41fd3) else _f9ca5d41(_c8c41fd3 <= _c5ca279f) end\nelseif _d4de930b == 33 then\n        local _175711ed = _82f1e6a1(); local _a9109abd = _f698019c[_495b3ec6]\n        for _7eb07bec = 1, _175711ed.n do _a9109abd[_34fad1c2 + _7eb07bec - 1] = _175711ed[_7eb07bec] end\nelseif _d4de930b == 16 then\n        local _d66f3acb, _4ace96cc, _09654e71 = _3fe2c1f0[_34fad1c2][1], _3fe2c1f0[_34fad1c2 + 1][1], _3fe2c1f0[_34fad1c2 + 2][1]\n        local _175711ed = _e595edcc(_d66f3acb(_4ace96cc, _09654e71))\n        _3fe2c1f0[_34fad1c2 + 3] = { _175711ed }\n        if _175711ed[1] ~= nil then _3fe2c1f0[_34fad1c2 + 2][1] = _175711ed[1]; _f9ca5d41(true) else _f9ca5d41(false) end\n        else\n        error(\"VM: bad opcode\")\n        end\n      else\nif _d4de930b == 34 then\n        _f9ca5d41(_3fe2c1f0[_34fad1c2][1][_09d8e5e5])\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      else\nif _d4de930b <= 56 then\nif _d4de930b <= 37 then\nif _d4de930b == 37 then\n        local _d03fcce1 = _82f1e6a1(); _f698019c[_495b3ec6][_34fad1c2] = _d03fcce1\n        else\n        error(\"VM: bad opcode\")\n        end\n      else\nif _d4de930b == 48 then\n        _f9ca5d41(_3fe2c1f0[_34fad1c2][1])\nelseif _d4de930b == 56 then\n        local _d03fcce1 = _82f1e6a1(); local _57daf2b2 = _82f1e6a1(); _f698019c[_495b3ec6][_57daf2b2] = _d03fcce1\nelseif _d4de930b == 51 then\n        _82f1e6a1()\nelseif _d4de930b == 45 then\n        _3fe2c1f0[_34fad1c2][1] = _82f1e6a1()\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      else\nif _d4de930b == 77 then\n        local _10599c6d = _82f1e6a1(); local _a9109abd = _f698019c[_495b3ec6]\n        for _7eb07bec = 1, _10599c6d.n do _a9109abd.n = _a9109abd.n + 1; _a9109abd[_a9109abd.n] = _10599c6d[_7eb07bec] end\nelseif _d4de930b == 81 then\n        local _175711ed = _82f1e6a1(); local _d66f3acb = _82f1e6a1()\n        -- Lua 5.1: getfenv/setfenv 의 레벨 1 은 \"이 함수\" 이므로 실행 중인 클로저(SF)를 가리킨다\n        if _d66f3acb == getfenv and (_175711ed.n == 0 or _175711ed[1] == 1) then _f9ca5d41(_e595edcc(getfenv(SF)))\n        elseif _d66f3acb == setfenv and _175711ed[1] == 1 and type(_175711ed[2]) == \"table\" then\n          setfenv(SF, _175711ed[2]); ENV = _175711ed[2]; _f9ca5d41(_e595edcc(SF))\n        else\n          _f9ca5d41(_e595edcc(_d66f3acb(unpack(_175711ed, 1, _175711ed.n))))\n        end\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      end\n      else\nif _d4de930b <= 89 then\nif _d4de930b == 89 then\n        _3fe2c1f0[_34fad1c2] = { _82f1e6a1() }\n        else\n        error(\"VM: bad opcode\")\n        end\n      else\nif _d4de930b == 92 then\n        _f9ca5d41({})\nelseif _d4de930b == 102 then\n        _f9ca5d41(_661ec7b3[1])\nelseif _d4de930b == 101 then\n        local _71ba68aa = _3fe2c1f0[_34fad1c2]\n        local _d03fcce1 = _71ba68aa and _71ba68aa[1]\n        if _71ba68aa then _71ba68aa[1] = nil end\n        if _d03fcce1 ~= nil and _d03fcce1 ~= false then\n          local mt = getmetatable(_d03fcce1)\n          local cm = mt and mt.__close\n          if cm then cm(_d03fcce1, nil) end\n        end\nelseif _d4de930b == 94 then\n        local _71ba68aa = _3fe2c1f0[_34fad1c2]\n        local _d03fcce1 = _71ba68aa and _71ba68aa[1]\n        if _d03fcce1 ~= nil and _d03fcce1 ~= false then\n          local mt = getmetatable(_d03fcce1)\n          if not (mt and mt.__close) then error(\"variable got a non-closable value\") end\n        end\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      end\n      else\nif _d4de930b <= 186 then\nif _d4de930b <= 165 then\nif _d4de930b <= 120 then\nif _d4de930b == 120 then\n        \nelseif _d4de930b == 114 then\n        _f9ca5d41(_596cd8ed[_34fad1c2][1])\n        else\n        error(\"VM: bad opcode\")\n        end\n      else\nif _d4de930b <= 131 then\nif _d4de930b == 131 then\n        local _d03fcce1 = _82f1e6a1(); local _a9109abd = _f698019c[_495b3ec6]\n        _a9109abd.n = _a9109abd.n + 1; _a9109abd[_a9109abd.n] = _d03fcce1\n        else\n        error(\"VM: bad opcode\")\n        end\n      else\nif _d4de930b == 153 then\n        local _175711ed = _82f1e6a1(); _f9ca5d41(_175711ed[1])\nelseif _d4de930b == 161 then\n        local _c33694bb, _bd7d4415, _4c7a00b9 = tonumber(_3fe2c1f0[_34fad1c2][1]), tonumber(_3fe2c1f0[_34fad1c2 + 1][1]), tonumber(_3fe2c1f0[_34fad1c2 + 2][1])\n        if not _c33694bb then error(\"'for' initial value must be a number\") end\n        if not _bd7d4415 then error(\"'for' limit must be a number\") end\n        if not _4c7a00b9 then error(\"'for' step must be a number\") end\n        _3fe2c1f0[_34fad1c2][1], _3fe2c1f0[_34fad1c2 + 1][1], _3fe2c1f0[_34fad1c2 + 2][1] = _c33694bb, _bd7d4415, _4c7a00b9\nelseif _d4de930b == 165 then\n        local _175711ed = _82f1e6a1()\n        for _7eb07bec = 1, _34fad1c2 do _f9ca5d41(_175711ed[_7eb07bec]) end\nelseif _d4de930b == 155 then\n        local _e7bce034 = _2cff6bda[_34fad1c2]\n        _db941e4e(_e7bce034)\n        local _3e333e0e = {}\n        for _c5ca279f = 1, _e7bce034.nu do\n          local _0dd0a345 = _e7bce034.u[2 * _c5ca279f - 1]\n          local _f4b4aa7c = _e7bce034.u[2 * _c5ca279f]\n          if _0dd0a345 == 1 then _3e333e0e[_c5ca279f] = _3fe2c1f0[_f4b4aa7c] else _3e333e0e[_c5ca279f] = _596cd8ed[_f4b4aa7c] end\n        end\n        local FN\n        FN = function(...) return _0f38c319(_e7bce034, _3e333e0e, getfenv(FN), FN, ...) end\n        setfenv(FN, ENV)\n        _f9ca5d41(FN)\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      end\n      else\nif _d4de930b == 186 then\n        _f9ca5d41(_661ec7b3)\nelseif _d4de930b == 185 then\n        _f9ca5d41(_e3de4954[_34fad1c2](_82f1e6a1()))\nelseif _d4de930b == 167 then\n        local _71ba68aa = _82f1e6a1()\n        if _71ba68aa == nil or _71ba68aa == false then _b90eb409 = 3 * _34fad1c2 + 1 end\nelseif _d4de930b == 175 then\n        local _57daf2b2 = _82f1e6a1(); local _a9109abd = _82f1e6a1(); _f9ca5d41(_a9109abd[_57daf2b2])\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      else\nif _d4de930b <= 234 then\nif _d4de930b <= 223 then\nif _d4de930b == 223 then\n        _b90eb409 = 3 * _34fad1c2 + 1\nelseif _d4de930b == 219 then\n        _f9ca5d41(ENV[_1a767486[_34fad1c2]])\nelseif _d4de930b == 212 then\n        ENV[_1a767486[_34fad1c2]] = _82f1e6a1()\nelseif _d4de930b == 198 then\n        local _d03fcce1 = _82f1e6a1(); local _57daf2b2 = _82f1e6a1(); local _a9109abd = _82f1e6a1(); _a9109abd[_57daf2b2] = _d03fcce1\n        else\n        error(\"VM: bad opcode\")\n        end\n      else\nif _d4de930b == 232 then\n        _f9ca5d41(_1a767486[_34fad1c2])\nelseif _d4de930b == 233 then\n        _3fe2c1f0[_34fad1c2][1] = _3fe2c1f0[_34fad1c2][1] + _3fe2c1f0[_34fad1c2 + 2][1]\nelseif _d4de930b == 229 then\n        local _002b4177 = _82f1e6a1(); _f9ca5d41(_002b4177[_1a767486[_34fad1c2]]); _f9ca5d41({ n = 1, _002b4177 })\nelseif _d4de930b == 234 then\n        _f9ca5d41({ n = 0 })\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      else\nif _d4de930b == 240 then\n        _f9ca5d41(_f698019c[_495b3ec6])\nelseif _d4de930b == 249 then\n        local _32c47afa = _82f1e6a1(); local _f36da3bf = _82f1e6a1(); _f9ca5d41(_4735e893[_34fad1c2](_f36da3bf, _32c47afa))\nelseif _d4de930b == 244 then\n        _3a60807c = _82f1e6a1(); break\nelseif _d4de930b == 236 then\n        _596cd8ed[_34fad1c2][1] = _82f1e6a1()\n        else\n        error(\"VM: bad opcode\")\n        end\n      end\n      end\n      end\n    end\n    return unpack(_3a60807c, 1, _3a60807c.n)\n  end\n  local W\n  local _2c2646a4 = false\n  W = function(...)\n    if not _2c2646a4 then _2c2646a4 = true; _aa0b6bba() end\n    return _0f38c319(_2cff6bda[1], {}, getfenv(W), W, ...)\n  end\n  return W\nend)({\n  (function() return { c = \"KgLXkSYIR+yMQysExVHQpUtOV7zAanXGiwNf78gLY/TLtHUeyA0EYOvelsAM84sMsuAGeS/MxCoHJW4e/8jb2CKJFIFWn/yHZeHLckVbLtmbZ53CnopJ6DkWhCzfdRIGylmQB9eOlryf61cEiahcX1FIMQ4GQtJZ5/7e5r5XD8XE6PGevS7f2Sod1jWYC8uFPQmGQg+aiHiCSVmdXQLMpc7N1VMDaS6LCt6HBPYXSKVaFJgQ3BKaA0UXq/qHyxhLPR5C5BcN\", k = { { es = \"qTbSUArfCsNA\", ek = 140, ln = 8 }, { es = \"DyFC\", ek = 231, ln = 3 }, { es = \"0hL6eQU8\", ek = 66, ln = 6, t = \"n\" }, { es = \"/rIUwbLVQE6UYAAA\", ek = 157, ln = 10 }, { es = \"OLXvvXBA\", ek = 248, ln = 5, t = \"n\" }, { es = \"hxa3EQL7\", ek = 83, ln = 6, t = \"n\" }, { es = \"d2MfmCNB\", ek = 174, ln = 6, t = \"n\" }, { es = \"4MWqZngt\", ek = 9, ln = 6, t = \"n\" } }, nk = 8, sl = 1172899, u = {  }, nu = 0, np = 0, va = true, hc = 2084507072, hk = 3383425335, cs = 3781288, cn = 0, pm = { 181, 130, 153, 101, 180, 243, 217, 192, 204, 44, 98, 148, 74, 80, 160, 131, 229, 196, 154, 91, 100, 50, 227, 75, 152, 241, 187, 165, 59, 249, 49, 146, 10, 113, 237, 162, 144, 86, 97, 96, 30, 197, 218, 81, 208, 125, 15, 32, 116, 56, 254, 190, 36, 216, 108, 223, 94, 211, 176, 203, 57, 90, 137, 37, 210, 230, 151, 40, 83, 209, 178, 157, 172, 115, 21, 55, 171, 132, 76, 251, 173, 68, 84, 88, 169, 79, 28, 13, 61, 212, 53, 99, 4, 17, 111, 182, 183, 105, 138, 158, 114, 206, 201, 2, 236, 150, 47, 1, 24, 226, 234, 149, 156, 38, 65, 67, 78, 8, 177, 139, 140, 73, 5, 70, 179, 133, 106, 3, 185, 112, 124, 224, 159, 194, 16, 60, 252, 246, 27, 184, 214, 19, 141, 22, 233, 39, 221, 147, 122, 69, 107, 145, 42, 142, 174, 231, 155, 87, 189, 18, 202, 48, 220, 143, 12, 23, 20, 235, 128, 198, 245, 66, 117, 110, 85, 186, 215, 129, 242, 170, 163, 121, 126, 232, 103, 89, 225, 205, 248, 200, 188, 41, 167, 92, 104, 71, 34, 199, 118, 238, 168, 52, 45, 166, 95, 102, 119, 134, 120, 191, 35, 62, 161, 219, 175, 250, 123, 247, 213, 207, 51, 82, 244, 31, 93, 239, 33, 25, 29, 77, 43, 240, 14, 222, 58, 64, 253, 193, 9, 109, 164, 135, 136, 195, 26, 127, 228, 11, 54, 46, 7, 63, 6, 72 } } end)(),\n  (function() return { c = \"IHnEvJkHkqxdaRcHu+jE+R+Usr2YIQHQi1wary0Yy6ZKE6JPShaHn6ITpvISDImEvnkKH7tDGwXQ/dfQNl4D/RvKv2EFqJrSoeuTH4NIRbBQMWRLdM+Z4E9bpUaRNFXaFofWtrIG2jPJi4nfi3dJa80GAQXXX7Ybz7QLs0UDnkjW3F/drkiLZUCdOf3WatFW\", k = { { es = \"9f6TCAAA\", ek = 139, ln = 4 }, { es = \"XG1D9uXGkuHA\", ek = 230, ln = 8 }, { es = \"nc+oOFho4VwuFBAA\", ek = 65, ln = 10 }, { es = \"zz5QuDAA\", ek = 156, ln = 4 }, { es = \"GDnvirhT\", ek = 247, ln = 6, t = \"n\" }, { es = \"hVK2D4L4\", ek = 82, ln = 6, t = \"n\" }, { es = \"aCcdnaNA\", ek = 173, ln = 5, t = \"n\" }, { es = \"5M2pfvAu\", ek = 8, ln = 6, t = \"n\" } }, nk = 8, sl = 4994722, u = {  }, nu = 0, np = 2, va = true, hc = 1683833233, hk = 934439191, cs = 3781326, cn = 0, pm = { 72, 175, 46, 236, 7, 201, 125, 154, 216, 59, 152, 20, 227, 78, 103, 155, 121, 235, 24, 141, 164, 225, 244, 165, 178, 137, 208, 143, 130, 220, 32, 81, 11, 38, 101, 4, 13, 229, 223, 118, 191, 84, 151, 57, 67, 50, 54, 241, 144, 218, 112, 115, 192, 215, 33, 15, 240, 224, 158, 193, 61, 80, 108, 203, 95, 135, 88, 28, 65, 56, 106, 228, 105, 132, 111, 212, 23, 172, 12, 62, 102, 214, 176, 206, 60, 9, 40, 27, 52, 30, 231, 93, 123, 21, 160, 247, 162, 44, 253, 114, 117, 199, 149, 197, 3, 89, 243, 156, 75, 200, 29, 180, 226, 71, 55, 22, 251, 249, 85, 142, 119, 127, 222, 94, 74, 99, 51, 146, 63, 41, 66, 131, 246, 166, 48, 91, 250, 96, 169, 174, 120, 8, 39, 76, 209, 205, 239, 252, 17, 157, 47, 161, 5, 90, 124, 145, 68, 113, 230, 10, 82, 139, 219, 19, 234, 184, 14, 140, 237, 182, 183, 198, 73, 238, 189, 194, 190, 202, 16, 181, 167, 133, 36, 186, 104, 64, 147, 35, 185, 109, 204, 163, 110, 34, 207, 87, 248, 100, 254, 26, 188, 242, 177, 79, 138, 134, 45, 18, 31, 211, 196, 179, 107, 171, 213, 173, 245, 168, 148, 77, 1, 233, 153, 170, 98, 49, 221, 136, 159, 116, 70, 37, 232, 129, 150, 210, 53, 97, 92, 6, 86, 122, 42, 217, 2, 187, 83, 58, 25, 126, 43, 195, 69, 128 } } end)(),\n  (function() return { c = \"PKOeG6LHjqgDniOTT0XWxb4MEuyW0MNMmz0GU6ZBEpkAcWaL4lvJ5Ffb/skA44FZ4uGFOJVEipCXslMdRIrW5elD2SBEpEnXqNue7bRZ0SJHN0cIu/RdtDRFOcxA200QyCECUWRWtngVI3oN1CaV/5hAGmNXyCUBkJ4ehEuPhKAUN5xLfNyW\", k = { { es = \"iB5xO471\", ek = 90, ln = 6, t = \"n\" }, { es = \"QLZKzDIW/vIA\", ek = 181, ln = 8 }, { es = \"iNSyBCAA\", ek = 16, ln = 4 }, { es = \"cVoM71qw\", ek = 107, ln = 6, t = \"n\" }, { es = \"wXyadu8f\", ek = 198, ln = 6, t = \"n\" }, { es = \"Qwlh9cGl\", ek = 33, ln = 6, t = \"n\" } }, nk = 6, sl = 4091761, u = {  }, nu = 0, np = 0, va = false, hc = 2432710679, hk = 3670013800, cs = 3781360, cn = 0, pm = { 76, 153, 11, 126, 199, 113, 99, 55, 139, 227, 112, 16, 108, 208, 155, 250, 182, 52, 252, 159, 103, 238, 220, 201, 167, 48, 35, 94, 79, 9, 225, 81, 97, 26, 146, 63, 100, 248, 144, 130, 75, 18, 115, 194, 254, 82, 33, 64, 19, 109, 160, 186, 150, 211, 14, 114, 161, 23, 53, 42, 171, 80, 175, 135, 197, 47, 222, 54, 234, 40, 72, 116, 3, 44, 176, 88, 101, 110, 39, 232, 67, 56, 111, 57, 1, 31, 166, 122, 102, 85, 13, 107, 198, 131, 202, 41, 5, 236, 93, 183, 152, 192, 145, 170, 156, 189, 219, 77, 206, 210, 127, 217, 179, 200, 218, 239, 95, 205, 86, 207, 196, 184, 228, 4, 213, 20, 129, 6, 89, 224, 38, 120, 245, 209, 165, 132, 138, 25, 162, 12, 28, 251, 221, 180, 117, 105, 66, 141, 204, 83, 62, 193, 169, 157, 128, 177, 149, 78, 65, 181, 140, 43, 214, 61, 164, 125, 106, 7, 91, 92, 253, 32, 8, 133, 36, 185, 172, 143, 158, 84, 188, 216, 68, 230, 123, 242, 142, 190, 241, 148, 121, 244, 215, 233, 223, 70, 74, 10, 37, 124, 17, 247, 178, 195, 58, 22, 87, 163, 147, 118, 49, 21, 191, 15, 2, 212, 226, 96, 136, 73, 50, 45, 24, 168, 71, 203, 246, 231, 235, 34, 137, 60, 229, 154, 187, 29, 69, 237, 174, 173, 240, 249, 98, 51, 59, 30, 151, 104, 46, 90, 134, 119, 243, 27 } } end)(),\n  (function() return { c = \"M/FM1fIFcwYRwZJRx6WEMWzKtcvEFLHSFk0S7H9Gw0mOuWbJRpwXOhiZpEoOzEKXNKNTRAbClgJFGtUbtizEz1uBjfOMaW3dNOSRT0hXX7XVcPtGF1aLaphDCbDPvU/NDLSALc/FyYOfkHoLxciLef5epLkFjUrfviTNnlGOlKaC2fKKNeOFj5uTw5CRJrVWz/fI1t3PRuQfuMKCBdgYqWKCosQfA22PUmrT4O+KaHrVBWxTM2PFcQQKE3bCm5HOhsQNiKtf4GmFCt6eyalL\", k = { { es = \"RvxS3fyX\", ek = 227, ln = 6, t = \"n\" }, { es = \"HF+tPFBvxlAt\", ek = 62, ln = 9 }, { es = \"y74XQIacbAAA\", ek = 153, ln = 7 }, { es = \"FbgusjBA\", ek = 244, ln = 5, t = \"n\" }, { es = \"7p61AIr4\", ek = 79, ln = 6, t = \"n\" }, { es = \"SWce/2OB\", ek = 170, ln = 6, t = \"n\" }, { es = \"3w3oe3Qv\", ek = 5, ln = 6, t = \"n\" }, { es = \"YpZww1K0\", ek = 96, ln = 6, t = \"n\" }, { es = \"KyDavy9c\", ek = 187, ln = 6, t = \"n\" } }, nk = 9, sl = 1017594, u = {  }, nu = 0, np = 2, va = false, hc = 842241942, hk = 1436854665, cs = 3781343, cn = 0, pm = { 78, 150, 108, 22, 185, 170, 160, 175, 179, 60, 101, 173, 75, 169, 73, 164, 198, 166, 47, 41, 154, 87, 35, 132, 59, 193, 243, 213, 174, 140, 121, 171, 230, 251, 66, 64, 65, 32, 29, 98, 124, 92, 7, 111, 200, 144, 168, 205, 254, 96, 91, 81, 178, 246, 147, 93, 8, 39, 212, 28, 229, 215, 214, 40, 223, 151, 31, 194, 172, 36, 138, 50, 46, 137, 67, 186, 241, 210, 238, 136, 77, 219, 83, 16, 56, 71, 104, 34, 119, 187, 114, 51, 57, 62, 82, 72, 177, 4, 152, 131, 225, 209, 122, 17, 5, 11, 58, 221, 125, 197, 37, 201, 191, 127, 89, 231, 182, 218, 24, 70, 153, 20, 21, 167, 115, 15, 44, 42, 68, 12, 139, 117, 181, 142, 155, 27, 159, 74, 14, 247, 195, 148, 94, 1, 69, 55, 48, 30, 252, 240, 228, 6, 120, 146, 2, 237, 227, 176, 222, 54, 95, 224, 156, 202, 236, 43, 188, 100, 3, 113, 248, 220, 135, 239, 13, 143, 216, 107, 130, 9, 26, 19, 10, 126, 23, 52, 129, 158, 245, 163, 192, 61, 234, 217, 199, 134, 53, 84, 183, 38, 118, 196, 110, 253, 25, 105, 208, 90, 206, 249, 235, 49, 106, 157, 226, 204, 133, 86, 161, 207, 45, 162, 79, 145, 76, 165, 102, 33, 88, 141, 103, 211, 232, 244, 128, 116, 189, 233, 109, 203, 18, 123, 112, 97, 250, 99, 242, 180, 85, 80, 190, 184, 63, 149 } } end)(),\n  (function() return { c = \"9Y5ZUbnZ1MBFxCrf67vVuVKFEQ/HHMTedE4HaY6EzpeVMwMZv/bQsNLbNXHZ6ajKm5gPHUoHrzQT8TZSpvuESAkKd26DKlbQ/SdQUH/DN1tKiY8EYgsSVjmTLjBI0n8P5nELWjsZh1VOAcXEbd0bq21dwMtbwHyOEvSfFJEJ1uSGlH9WrB6aeyTShS7Q5LIJK0TeQ+ESLjXKs+KW7keVqE/HVf/NRThHaMNUE0ZUfwGIaiAPtPaJAKnR/G2PGfvbiTNQ+OJBtQaJO4cBgbAX8zAAZ1fc29KM/wWP06CGN67P+yUN/AgQXF3IvaCEXe7ENESDnODVG5SaKe0StMyeoRhT0g8bP1BEBdiJ8+vGbMiGPF9RQvAZ8BlTfppBiI7C9csXMPIcs/FEC6KO3L1MdjkCoCuLtFWIrVQYaZmb7LfSkFicvnFasYJLNFaPGpKHrBeDmuQM/qrFNJCQyYXUXktD2wtMj0ofRm9FSNyfIb4M\", k = { { es = \"Sxpz4x60\", ek = 101, ln = 6, t = \"n\" }, { es = \"ynzYT2cd\", ek = 192, ln = 6, t = \"n\" }, { es = \"/xh1\", ek = 27, ln = 3 }, { es = \"Bk7bqgNhm4dn\", ek = 118, ln = 9 }, { es = \"j/yUNKDY\", ek = 209, ln = 6, t = \"n\" }, { es = \"YMk+iUlg\", ek = 44, ln = 6, t = \"n\" }, { es = \"xS+KY1YO\", ek = 135, ln = 6, t = \"n\" }, { es = \"W3RTzPiX\", ek = 226, ln = 6, t = \"n\" }, { es = \"LAL5Qc09\", ek = 61, ln = 6, t = \"n\" }, { es = \"vCNHPtPA\", ek = 152, ln = 5, t = \"n\" }, { es = \"FnAslTRQ\", ek = 243, ln = 6, t = \"n\" }, { es = \"8lK1EML5\", ek = 78, ln = 6, t = \"n\" }, { es = \"YGMD+2eG\", ek = 169, ln = 6, t = \"n\" }, { es = \"2sXrQDws\", ek = 4, ln = 6, t = \"n\" } }, nk = 14, sl = 5426044, u = {  }, nu = 0, np = 1, va = true, hc = 1862527499, hk = 3467158479, cs = 3781285, cn = 0, pm = { 175, 167, 127, 117, 80, 105, 75, 181, 57, 90, 33, 72, 83, 7, 55, 69, 163, 138, 3, 183, 220, 133, 32, 25, 45, 28, 50, 230, 144, 178, 30, 111, 93, 236, 189, 100, 246, 46, 195, 180, 190, 245, 20, 142, 172, 74, 19, 168, 49, 225, 88, 109, 207, 235, 248, 253, 186, 177, 247, 238, 12, 196, 122, 53, 92, 101, 204, 108, 47, 54, 187, 6, 164, 38, 170, 149, 169, 157, 192, 58, 131, 217, 146, 213, 140, 71, 252, 165, 73, 154, 119, 44, 13, 31, 197, 89, 137, 199, 126, 26, 150, 95, 141, 226, 166, 5, 99, 124, 135, 115, 77, 123, 179, 4, 148, 61, 234, 103, 39, 200, 22, 227, 155, 201, 18, 128, 159, 134, 8, 125, 218, 152, 130, 97, 214, 219, 237, 76, 21, 37, 188, 35, 112, 174, 34, 113, 223, 64, 222, 182, 110, 78, 66, 24, 249, 211, 60, 14, 52, 48, 136, 86, 254, 2, 1, 198, 147, 65, 215, 23, 102, 116, 243, 36, 161, 29, 40, 173, 239, 118, 9, 151, 233, 43, 158, 156, 87, 106, 162, 224, 240, 184, 251, 11, 229, 120, 121, 51, 94, 203, 202, 210, 59, 143, 241, 15, 82, 62, 70, 171, 85, 56, 244, 160, 67, 98, 104, 139, 209, 107, 242, 176, 96, 129, 206, 212, 84, 185, 153, 42, 216, 16, 194, 191, 145, 79, 231, 208, 114, 205, 68, 250, 10, 41, 91, 193, 17, 232, 132, 63, 221, 81, 228, 27 } } end)(),\n  (function() return { c = \"vHFRTsUJvF3U0F2TSzRGWOBM99MFWg5RSUxRnyJFbEJGNkuRqyvAAOuUemDJmM1Q/sHMNclaw3jc8L3DtohRiG7Bc+fGIUbJt1yfKPrJq5uGjOTXEgTbZ9oSX1ZdWEnbUXINSwFS3GkKpsNWb8XVq4+Hd+5NKhRHAfyMGesfxuSXvjtOVHDJ4xyW4I+XgUfMYcdUMx1PC/ie0trA2sRWihLfdYhbWOYLyTaOwF9EJX8OBgPM1q+cKvOByGqYkImDQu+BoLrTFmzYG9cR6mRdH9mcaBFM760KbKbJOu+boIRc2Y/PnuOXtTpRPlkfbW8ADFoVSrvdXNYZpEMI7mgKZzRAlpXJLS4FoEnCe+8WBi5QfH+ZCbdX3rYIy2jCrLuZz5dA1+DO9v7f\", k = { { es = \"ZwU9rQVh\", ek = 46, ln = 6, t = \"n\" }, { es = \"lHaeMM9d\", ek = 137, ln = 6 }, { es = \"cfRT9jiX\", ek = 228, ln = 6, t = \"n\" }, { es = \"KoL7REU8\", ek = 63, ln = 6, t = \"n\" }, { es = \"rOdBGh/F\", ek = 154, ln = 6, t = \"n\" }, { es = \"MrwugjhT\", ek = 245, ln = 6, t = \"n\" }, { es = \"h160AU74\", ek = 80, ln = 6, t = \"n\" }, { es = \"eSMc4muB\", ek = 171, ln = 6, t = \"n\" }, { es = \"1EGqZjgv\", ek = 6, ln = 6, t = \"n\" }, { es = \"SlZx0Rq3\", ek = 97, ln = 6, t = \"n\" }, { es = \"ICzaRicd\", ek = 188, ln = 6, t = \"n\" } }, nk = 11, sl = 5869125, u = {  }, nu = 0, np = 1, va = false, hc = 1207246967, hk = 569547357, cs = 3781292, cn = 0, pm = { 95, 56, 222, 182, 231, 163, 36, 229, 1, 181, 172, 156, 59, 246, 159, 45, 126, 71, 113, 83, 15, 230, 189, 14, 217, 198, 115, 187, 158, 108, 94, 209, 49, 251, 60, 104, 24, 5, 12, 119, 144, 245, 77, 239, 82, 145, 248, 125, 211, 154, 10, 180, 69, 73, 90, 175, 177, 162, 111, 225, 105, 44, 161, 219, 157, 4, 214, 9, 123, 202, 99, 43, 52, 120, 221, 220, 192, 20, 16, 188, 191, 250, 166, 149, 240, 233, 86, 207, 93, 91, 27, 135, 232, 48, 110, 121, 131, 31, 58, 200, 208, 117, 122, 97, 169, 146, 23, 137, 223, 118, 133, 178, 190, 78, 81, 194, 237, 35, 11, 116, 75, 242, 84, 92, 186, 57, 102, 18, 3, 29, 212, 197, 112, 88, 243, 215, 127, 252, 201, 206, 254, 107, 101, 85, 139, 55, 76, 249, 152, 164, 151, 203, 70, 37, 185, 2, 33, 128, 132, 140, 253, 236, 228, 129, 17, 28, 216, 204, 65, 155, 114, 34, 46, 196, 160, 234, 8, 26, 13, 167, 109, 238, 25, 136, 62, 227, 68, 218, 153, 106, 38, 30, 130, 74, 80, 124, 89, 96, 147, 179, 39, 100, 199, 171, 244, 54, 50, 150, 138, 53, 174, 184, 183, 22, 63, 72, 21, 193, 235, 41, 67, 40, 51, 148, 79, 47, 141, 32, 195, 87, 213, 173, 226, 170, 42, 103, 165, 143, 168, 205, 6, 64, 176, 98, 7, 142, 210, 66, 19, 134, 247, 61, 241, 224 } } end)()\n})\nreturn __vm56a42e62(...)\n";
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
  async fetch(request, rawEnv) {
    const env = { ...rawEnv, DB: withAutoSchema(rawEnv.DB) };
    await ensureMigrated(rawEnv.DB);
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
    orphanKeys.push(...files.map((f) => f.object_key), ...allBundleKeys(script.object_key), script.raw_object_key);
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
  // 수동 차단은 영구 차단이다. 이미 자동 차단(72시간)된 IP 면 만료 시각을 지워 영구로 바꾼다 (이전엔 무시돼 72시간 뒤 풀렸다)
  await env.DB.prepare(
    `INSERT INTO banned_ips (ip, reason, expires_at, auto_ban) VALUES (?, ?, NULL, 0)
     ON CONFLICT(ip) DO UPDATE SET reason = CASE WHEN excluded.reason <> '' THEN excluded.reason ELSE banned_ips.reason END, expires_at = NULL, auto_ban = 0`
  ).bind(ip, reason).run();
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
  const row = await env.DB.prepare(`SELECT id, slug, name, object_key, sha256, mode, obfuscated, created_by FROM hosted_scripts WHERE ${kind === 'id' ? 'id' : 'slug'} = ?`).bind(value).first();
  if (isBrowserRequest(request)) {
    if (!row) return scriptPage(request, null);
    return deniedPage();
  }
  if (!row) return new Response('Script not found', { status: 404, headers: TEXT_HEADERS });
  if (row.obfuscated !== 1) return new Response('Script protection pending. Save the script again.', { status: 503, headers: TEXT_HEADERS });
  if (row.mode === 'key') {
    await audit(env, request, null, 'script.raw.stub', row.id, 'ok');
    const loader = await env.BUCKET.get(bundleKeys(row.object_key).loader);
    if (!loader) return new Response('Script protection pending. Save the script again.', { status: 503, headers: TEXT_HEADERS });
    return new Response(loader.body, { headers: { ...TEXT_HEADERS, 'content-disposition': contentDisposition(row.slug) } });
  }
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return new Response('Script content missing', { status: 404, headers: TEXT_HEADERS });
  await audit(env, request, null, 'script.raw', row.id, 'ok');
  return new Response(object.body, { headers: { ...TEXT_HEADERS, 'content-disposition': contentDisposition(row.slug), 'x-script-sha256': row.sha256 } });
}

const DELIVERY_CHUNK_COUNT = 6;
const DELIVERY_SESSION_SECONDS = 120;

// 조각 전송 순서 (0..5 의 무작위 순열). 세션마다 새로 뽑는다.
function shuffledOrder() {
  const order = Array.from({ length: DELIVERY_CHUNK_COUNT }, (_, i) => i);
  const rnd = new Uint32Array(DELIVERY_CHUNK_COUNT);
  crypto.getRandomValues(rnd);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
function parseOrder(value) {
  try {
    const order = JSON.parse(value);
    if (Array.isArray(order) && order.length === DELIVERY_CHUNK_COUNT && new Set(order).size === DELIVERY_CHUNK_COUNT) return order;
  } catch {}
  return Array.from({ length: DELIVERY_CHUNK_COUNT }, (_, i) => i);
}
// Fletcher 류 체크섬 (mod 65521, 바이트 단위). 로더의 fletcher 와 같은 식이다.
function fletcher(value) {
  let a = 1;
  let b = 0;
  for (const x of new TextEncoder().encode(value)) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65521 + a;
}


async function startKeyDelivery(request, env, body) {
  if (!body || typeof body.slug !== 'string' || typeof body.key !== 'string' || body.key.length > 256) return fail(400, 'slug and key are required.');
  const slug = normalizeSlug(body.slug);
  const key = body.key.trim();
  const script = await env.DB.prepare('SELECT * FROM hosted_scripts WHERE slug = ?').bind(slug).first();
  if (!script || script.mode !== 'key' || script.status === 'DRAFT') return fail(404, 'Script not found.');
  if (script.obfuscated !== 1) return fail(503, 'Script protection pending. Save the script again.');
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
  if (keyType !== 'decoy') {
    // 같은 스크립트·같은 키로 토큰을 다시 요청하면, 직전 세션(완료된 것 포함)이 유효 시간 안에 있는 동안 차단한다.
    const recent = await env.DB.prepare(
      `SELECT id FROM script_delivery_sessions WHERE script_id = ? AND key_hash = ? AND created_at >= ? LIMIT 1`
    ).bind(script.id, keyHash, new Date(Date.now() - DELIVERY_SESSION_SECONDS * 1000).toISOString()).first();
    if (recent) {
      await recordSecurityEvent(env, request, 'script.delivery.duplicate_token_request', 'blocked', script.id);
      return fail(429, 'This script was just requested. Wait and try again.');
    }
  }
  const token = newSecret('tds_', 48);
  const expiresAt = new Date(Date.now() + DELIVERY_SESSION_SECONDS * 1000).toISOString();
  const sessionId = randomHex(16);
  const order = shuffledOrder();
  await env.DB.prepare(
    `INSERT INTO script_delivery_sessions (id, token_hash, script_id, key_type, key_id, key_hash, hwid, initial_ip, next_chunk, expires_at, decoy, chunk_order)
     VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`
  ).bind(sessionId, await sha256Hex(token), script.id, keyType, keyId || null, keyHash, hwid || null, request.headers.get('cf-connecting-ip') || null, expiresAt, keyType === 'decoy' ? 1 : 0, JSON.stringify(order)).run();
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
  if (!body || typeof body.token !== 'string' || body.token.length > 256 || !Number.isInteger(body.seq)) return fail(400, 'token and seq are required.');
  const tokenHash = await sha256Hex(body.token);
  const session = await env.DB.prepare('SELECT * FROM script_delivery_sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!session) return fail(403, 'Delivery session is invalid.');
  const now = new Date().toISOString();
  if (session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
    await recordSecurityEvent(env, request, 'script.delivery.expired_or_revoked', 'denied', session.script_id);
    return fail(403, 'Delivery session expired. Request a new loader.');
  }
  const revokeWith = async (event) => {
    await env.DB.prepare('UPDATE script_delivery_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, session.id).run();
    await recordSecurityEvent(env, request, event, 'blocked', session.script_id);
  };
  if (body.seq < 0 || body.seq >= DELIVERY_CHUNK_COUNT || body.seq !== session.next_chunk) {
    await revokeWith('script.delivery.replay_or_order_violation');
    return fail(409, 'Chunk order is invalid. Request a new loader.');
  }
  if (!(await validateDeliverySession(env, session))) {
    await revokeWith('script.delivery.key_revoked');
    return fail(403, 'License is no longer active.');
  }
  const index = parseOrder(session.chunk_order)[body.seq];
  let piece;
  if (session.decoy) {
    // 가짜 응답: 로드해도 아무 함수도 합치지 않는 같은 모양의 조각.
    // 난독화를 끈 스크립트는 평문 가짜 조각을 줘야 같은 형식이라 구분이 안 된다.
    const row = await env.DB.prepare('SELECT vm_obfuscate FROM hosted_scripts WHERE id = ?').bind(session.script_id).first();
    const chunk = row?.vm_obfuscate === 0 ? plainDecoyPart(index) : DECOY_OBF;
    piece = { chunk, cf: fletcher(chunk) };
  } else {
    const script = await env.DB.prepare('SELECT object_key, served_sha256 FROM hosted_scripts WHERE id = ?').bind(session.script_id).first();
    if (!script?.object_key) return fail(404, 'Script content missing.');
    const keys = bundleKeys(script.object_key);
    const manifestObj = await env.BUCKET.get(keys.manifest);
    if (!manifestObj) return fail(503, 'Script protection pending. Save the script again.');
    let manifest = null;
    try { manifest = JSON.parse(await manifestObj.text()); } catch { manifest = null; }
    if (!manifest || !script.served_sha256 || manifest.full_sha !== script.served_sha256 || !manifest.parts?.[index]) {
      await revokeWith('script.delivery.integrity_failure');
      return fail(500, 'Protected script integrity check failed.');
    }
    // 조각마다 저장 때 기록한 sha256과 대조한다 (전송 중 변조 감지)
    const partObj = await env.BUCKET.get(keys.parts[index]);
    const chunk = partObj ? await partObj.text() : null;
    if (chunk === null || await sha256Hex(chunk) !== manifest.parts[index].sha) {
      await revokeWith('script.delivery.integrity_failure');
      return fail(500, 'Protected script integrity check failed.');
    }
    piece = { chunk, cf: manifest.parts[index].cf };
  }
  const updated = await env.DB.prepare(
    `UPDATE script_delivery_sessions
     SET next_chunk = next_chunk + 1, revoked_at = CASE WHEN next_chunk = ? THEN ? ELSE revoked_at END
     WHERE id = ? AND next_chunk = ? AND revoked_at IS NULL AND expires_at > ?`
  ).bind(DELIVERY_CHUNK_COUNT - 1, now, session.id, body.seq, now).run();
  if (!updated.meta || updated.meta.changes !== 1) {
    await env.DB.prepare('UPDATE script_delivery_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, session.id).run();
    await recordSecurityEvent(env, request, 'script.delivery.replay_or_race', 'blocked', session.script_id);
    return fail(409, 'Chunk was already consumed. Request a new loader.');
  }
  await recordSecurityEvent(env, request, 'script.delivery.chunk_sent', 'ok', `${session.script_id}:${body.seq}`);
  return json({ ok: true, index, total: DELIVERY_CHUNK_COUNT, chunk: piece.chunk, cf: piece.cf });
}

export { putDelivery, bundleKeys, scriptObjectKeys };

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
    secure: boolInt(body.secure_loader, current?.secure_loader ?? 1),
    vm: boolInt(body.vm_obfuscate, current?.vm_obfuscate ?? 1)
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
    return obfuscate(code, { antiTamper: false });
  } catch (error) {
    throw new HttpError(422, `난독화 실패: ${error.message}`);
  }
}
// 입력이 클수록 가짜 코드 밀도를 낮춘다. Worker CPU 시간 제한 안에서 저장이 끝나도록 하는 예산이다 (100KB 기준 밀도 6은 약 12초).
const densityFor = (bytes) => (bytes <= 64 * 1024 ? 6 : bytes <= 160 * 1024 ? 4 : 3);
// vm=false 면 VM 없이 원문을 같은 조각 구조로만 묶는다 (정책: 스크립트별 선택)
async function obfuscateLuaBundle(env, code, vm = true) {
  if (!vm) return plainBundle(code);
  try {
    return obfuscateBundle(code, { density: densityFor(byteLength(code)) });
  } catch (error) {
    throw new HttpError(422, `난독화 실패: ${error.message}`);
  }
}
// 원문은 raw_object_key 에 있다. 0013 이전 스크립트는 raw 가 object_key 에 그대로 있다.
async function readRawCode(env, row) {
  const object = await env.BUCKET.get(row.raw_object_key || row.object_key);
  return object ? object.text() : null;
}

async function putRaw(env, { scriptId, rawKey, rawCode, objectKey, digest }) {
  await env.BUCKET.put(rawKey, rawCode, {
    ...OBJECT_META,
    customMetadata: { scriptId, sha256: digest, role: 'raw', pair: objectKey },
  });
}

async function putObfuscated(env, { scriptId, rawKey, objectKey, served, bundle, digest, servedDigest, slug, origin }) {
  await env.BUCKET.put(objectKey, served, {
    ...OBJECT_META,
    customMetadata: { scriptId, sha256: digest, servedSha256: servedDigest, role: 'obfuscated', obfuscated: '1', pair: rawKey },
  });
  await putDelivery(env, { objectKey, bundle, servedDigest, slug, origin });
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
  const { objectKey, rawKey } = await scriptObjectKeys(env, auth.user.id, id);
  const digest = await sha256Hex(body.code);

  await putRaw(env, { scriptId: id, rawKey, rawCode: body.code, objectKey, digest });

  let served;
  let servedDigest;
  let bundle;
  try {
    bundle = await obfuscateLuaBundle(env, body.code, opts.vm === 1);
    served = bundle.code;
    if (byteLength(served) > maxBytes(env)) throw new HttpError(413, `Obfuscated script exceeds ${maxBytes(env)} bytes.`);
    servedDigest = await bundleDigest(bundle);
    await audit(env, request, auth, 'script.obfuscate', id, 'ok');
  } catch (error) {
    await audit(env, request, auth, 'script.obfuscate', id, 'failed');
    await purgeObjects(env, [rawKey]);
    if (error instanceof HttpError) return fail(error.status, error.message);
    throw error;
  }

  try {
    await putObfuscated(env, { scriptId: id, rawKey, objectKey, served, bundle, digest, servedDigest, slug, origin: new URL(request.url).origin });
  } catch (error) {
    await purgeObjects(env, [rawKey, ...allBundleKeys(objectKey)]);
    if (error instanceof HttpError) return fail(error.status, error.message);
    throw error;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO hosted_scripts (id, slug, name, object_key, raw_object_key, obfuscated, vm_obfuscate, byte_size, sha256, served_sha256, mode, key_policy, hwid_lock, silent, heartbeat, lightweight, secure_loader, project_id, status, version, created_by)
       VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE','v0.0.0.1',?)`
    ).bind(id, slug, name, objectKey, rawKey, opts.vm, size, digest, servedDigest, mode, policy, opts.hwid, opts.silent, opts.heartbeat, opts.lightweight, opts.secure, projectId, auth.user.id).run();
  } catch (error) {
    // 번들 조각·매니페스트·엔진·로더도 putObfuscated 에서 이미 썼으므로 함께 지운다 (이전엔 빠져서 R2에 고아 객체가 남았다)
    await purgeObjects(env, [...allBundleKeys(objectKey), rawKey]);
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
    || opts.lightweight !== current.lightweight || opts.secure !== current.secure_loader || opts.vm !== current.vm_obfuscate
    || digest !== current.sha256;
  // 코드가 바뀌거나 VM 난독화 설정이 바뀌면 저장된 원문으로 번들을 다시 만든다 (설정만 바꿔도 적용되도록)
  const rebuild = newCode !== null || opts.vm !== current.vm_obfuscate;
  const oldObjectKey = current.object_key;
  const oldRawKey = current.raw_object_key;
  let objectKey = oldObjectKey;
  let rawKey = oldRawKey;
  let obfuscated = current.obfuscated;
  if (rebuild) {
    const source = newCode ?? await readRawCode(env, current);
    if (source === null) return fail(404, 'Script content missing.');
    const suffix = randomHex(6);
    ({ objectKey, rawKey } = await scriptObjectKeys(env, current.created_by, id, suffix));
    obfuscated = 1;

    await putRaw(env, { scriptId: id, rawKey, rawCode: source, objectKey, digest });

    let served;
    let bundle;
    try {
      bundle = await obfuscateLuaBundle(env, source, opts.vm === 1);
      served = bundle.code;
      if (byteLength(served) > maxBytes(env)) throw new HttpError(413, `Obfuscated script exceeds ${maxBytes(env)} bytes.`);
      servedDigest = await bundleDigest(bundle);
      await audit(env, request, auth, 'script.obfuscate', id, 'ok');
    } catch (error) {
      await audit(env, request, auth, 'script.obfuscate', id, 'failed');
      await purgeObjects(env, [rawKey]);
      if (error instanceof HttpError) return fail(error.status, error.message);
      throw error;
    }

    try {
      await putObfuscated(env, { scriptId: id, rawKey, objectKey, served, bundle, digest, servedDigest, slug, origin: new URL(request.url).origin });
    } catch (error) {
      await purgeObjects(env, [rawKey, ...allBundleKeys(objectKey)]);
      if (error instanceof HttpError) return fail(error.status, error.message);
      throw error;
    }
  }
  const version = changed ? bumpVersion(current.version) : current.version;
  const status = changed || current.status !== 'ACTIVE' ? 'ACTIVE' : current.status;
  try {
    await env.DB.prepare(
      `UPDATE hosted_scripts SET object_key = ?, raw_object_key = ?, obfuscated = ?, vm_obfuscate = ?, slug = ?, name = ?, byte_size = ?, sha256 = ?, served_sha256 = ?, mode = ?, key_policy = ?, hwid_lock = ?, silent = ?, heartbeat = ?, lightweight = ?, secure_loader = ?, status = ?, version = ?, updated_at = ${NOW_SQL} WHERE id = ?`
    ).bind(objectKey, rawKey, obfuscated, opts.vm, slug, name, size, digest, servedDigest, mode, policy, opts.hwid, opts.silent, opts.heartbeat, opts.lightweight, opts.secure, status, version, id).run();
  } catch (error) {
    if (objectKey !== oldObjectKey) await purgeObjects(env, [...allBundleKeys(objectKey), rawKey]);
    throw error;
  }
  if (objectKey !== oldObjectKey) await purgeObjects(env, [...allBundleKeys(oldObjectKey), oldRawKey].filter(Boolean));
  // 코드는 그대로인데 URL 이름만 바뀌면 로더 안의 slug 만 갱신한다
  if (!rebuild && slug !== current.slug) await putLoader(env, objectKey, slug, new URL(request.url).origin);
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
  await purgeObjects(env, [...files.map((f) => f.object_key), ...allBundleKeys(current.object_key), current.raw_object_key].filter(Boolean));
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
