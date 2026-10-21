// 전송 프로토콜 시뮬레이션: 가짜 D1/R2 위에서 worker.js의 실제 핸들러를 돌린다.
// 로더(Lua)는 실행하지 않고, 같은 검사 규칙을 JS로 옮겨 확인한다 (checkLoader).
import { obfuscateBundle } from '../src/obfuscator.js';
import worker, { putDelivery } from '../src/worker.js';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
export const sample = 'local t = {} for i = 1, 5 do t[i] = i * i end print(table.concat(t, ","))';
export const bundle = obfuscateBundle(sample, {});
const bundleDigest = (b) => sha(b.engine + '\u0000' + b.parts.join('\u0000'));

export async function makeEnv({ obfuscated = 1 } = {}) {
  const db = {
    scripts: [{ id: 's1', slug: 'demo', name: 'demo', mode: 'key', status: 'ACTIVE', project_id: null, hwid_lock: 0, obfuscated, object_key: 'scripts/s1.lua', served_sha256: bundleDigest(bundle), raw_object_key: null, sha256: sha(sample) }],
    keys: [{ id: 'k1', user_id: 'u1', key_hash: sha('GOODKEY'), status: 'active', expires_at: null, hwid: null, script_id: 's1' }],
    users: [{ id: 'u1', status: 'active' }],
    sessions: [], security: [], audit: [], banned: [],
  };
  const bucket = {};
  const prepare = (sql) => ({
    bind(...args) { this._a = args; return this; },
    async first() { return run(sql, this._a ?? [], 'first'); },
    async run() { return run(sql, this._a ?? [], 'run'); },
    async all() { return { results: [] }; },
  });
  const run = (rawSql, a) => {
    const sql = rawSql.replace(/\s+/g, ' ');
    const has = (s) => sql.includes(s);
    const now = Date.now();
    if (has('FROM banned_ips')) return null;
    if (has('SELECT * FROM hosted_scripts WHERE slug')) return db.scripts.find((r) => r.slug === a[0]) ?? null;
    if (has('SELECT id, slug, name, object_key, sha256, mode, obfuscated')) return db.scripts.find((r) => r.slug === a[0]) ?? null;
    if (has('FROM license_users')) return null;
    if (has('SELECT sk.key_hash, sk.status')) {
      const k = db.keys.find((r) => r.id === a[0]);
      const u = k && db.users.find((x) => x.id === k.user_id);
      return k ? { key_hash: k.key_hash, status: k.status, expires_at: null, hwid: null, user_status: u.status } : null;
    }
    if (has('FROM script_keys sk JOIN api_users')) {
      const k = db.keys.find((r) => r.key_hash === a[0] && r.script_id === a[1]);
      if (!k) return null;
      const u = db.users.find((x) => x.id === k.user_id);
      return { ...k, user_status: u.status };
    }
    if (has('SELECT COUNT(*) AS n FROM api_audit_logs')) return { n: db.audit.filter((r) => r.ip === a[0] && r.action === 'script.key_run' && r.status === 'denied' && r.target === a[1]).length };
    if (has('SELECT id FROM script_delivery_sessions WHERE script_id')) {
      const hit = db.sessions.find((r) => r.script_id === a[0] && r.key_hash === a[1] && r.created_at >= a[2]);
      return hit ? { id: hit.id } : null;
    }
    if (has('INSERT INTO script_delivery_sessions')) {
      db.sessions.push({ id: a[0], token_hash: a[1], script_id: a[2], key_type: a[3], key_id: a[4], key_hash: a[5], hwid: a[6], initial_ip: a[7], expires_at: a[8], decoy: a[9], chunk_order: a[10], next_chunk: 0, revoked_at: null, created_at: new Date(now).toISOString() });
      return { meta: { changes: 1 } };
    }
    if (has('DELETE FROM script_delivery_sessions')) return { meta: { changes: 0 } };
    if (has('INSERT INTO security_events')) { db.security.push({ action: a[1], status: a[2], target: a[3] }); return { meta: { changes: 1 } }; }
    if (has('INSERT INTO api_audit_logs')) { db.audit.push({ action: a[2], target: a[3], status: a[4], ip: a[5] }); return { meta: { changes: 1 } }; }
    if (has('UPDATE script_keys SET last_used_at') || has('UPDATE script_keys SET hwid') || has('UPDATE license_users')) return { meta: { changes: 1 } };
    if (has('SELECT * FROM script_delivery_sessions WHERE token_hash')) return db.sessions.find((r) => r.token_hash === a[0]) ?? null;
    if (has('SELECT project_id, hwid_lock, status FROM hosted_scripts')) return db.scripts.find((r) => r.id === a[0]) ?? null;
    if (has('SELECT vm_obfuscate FROM hosted_scripts')) return db.scripts.find((r) => r.id === a[0]) ?? null;
    if (has('SELECT object_key, served_sha256 FROM hosted_scripts')) return db.scripts.find((r) => r.id === a[0]) ?? null;
    if (has('UPDATE hosted_scripts SET served_sha256')) {
      const r = db.scripts.find((x) => x.id === a[1]);
      if (r && r.served_sha256 == null) { r.served_sha256 = a[0]; return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (has('UPDATE script_delivery_sessions SET next_chunk')) {
      const [last, t, id, seq, nowIso] = a;
      const r = db.sessions.find((x) => x.id === id);
      if (r && r.next_chunk === seq && r.revoked_at == null && Date.parse(r.expires_at) > Date.parse(nowIso)) {
        r.next_chunk += 1;
        if (seq === last) r.revoked_at = t;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (has('UPDATE script_delivery_sessions SET revoked_at')) {
      const r = db.sessions.find((x) => x.id === a[1]);
      if (r && r.revoked_at == null) r.revoked_at = a[0];
      return { meta: { changes: 1 } };
    }
    throw new Error('unhandled SQL: ' + sql.slice(0, 120));
  };
  const BUCKET = {
    put: async (k, v) => { bucket[k] = String(v); },
    get: async (k) => (bucket[k] == null ? null : { text: async () => bucket[k], body: bucket[k] }),
    delete: async (k) => { delete bucket[k]; },
  };
  const env = { DB: { prepare }, BUCKET, _db: db, _bucket: bucket, _bundle: bundle };
  // 저장 시 만드는 번들(조각 6, 엔진, 매니페스트, 로더)을 실제 저장 함수로 만든다
  await putDelivery(env, { objectKey: 'scripts/s1.lua', bundle, servedDigest: bundleDigest(bundle), slug: 'demo', origin: 'https://jinhyuk.xyz' });
  return env;
}

const req = (path, body, headers = {}) => new Request('https://jinhyuk.xyz' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers }, body: JSON.stringify(body),
});

export async function startSession(env, key = 'GOODKEY') {
  const r = await worker.fetch(req('/api/key-session', { slug: 'demo', key, hwid: 'h1' }), env);
  return { status: r.status, body: await r.json() };
}
export async function getChunk(env, token, seq) {
  const r = await worker.fetch(req('/api/key-chunk', { token, seq }), env);
  return { status: r.status, body: await r.json() };
}

// 로더 규칙을 JS로 재현: 6개를 받으면서 조각마다 cf 확인, 같은 번호 두 번 받으면 실패.
export async function checkLoader(env, key = 'GOODKEY') {
  const s = await startSession(env, key);
  if (s.status !== 200) return { ok: false, stage: 'session', status: s.status, error: s.body.error };
  const parts = [];
  const arrival = [];
  for (let seq = 0; seq < 6; seq++) {
    const c = await getChunk(env, s.body.token, seq);
    if (c.status !== 200) return { ok: false, stage: 'chunk', status: c.status, error: c.body.error, arrival };
    const part = c.body;
    if (!(part.total === 6 && part.index >= 0 && part.index <= 5) || parts[part.index] !== undefined) return { ok: false, stage: 'order', arrival };
    if (fletcherJs(part.chunk) !== part.cf) return { ok: false, stage: 'chunk_tamper', arrival };
    parts[part.index] = part.chunk;
    arrival.push(part.index);
  }
  return { ok: true, parts, arrival, token: s.body.token };
}

export function fletcherJs(value) {
  let a = 1, b = 0;
  for (const x of Buffer.from(value, 'utf8')) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return b * 65521 + a;
}
