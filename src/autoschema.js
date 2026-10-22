// D1 래퍼: 쿼리가 "no such table: X" 로 실패하고 X 가 현재 스키마에 있으면, 그 테이블과 인덱스를 만든 뒤 한 번 다시 실행한다.
// 마이그레이션을 빠뜨린 채 배포해도 필요한 테이블이 자동으로 생긴다. 이미 있는 테이블은 건드리지 않는다 (IF NOT EXISTS).
import { SCHEMA } from './schema.js';
import { MIGRATIONS } from './migrations.js';

const MISSING = /no such table:\s*([A-Za-z0-9_]+)/;

export function withAutoSchema(db) {
  const created = new Set();
  const ensure = async (name) => {
    if (!SCHEMA[name] || created.has(name)) return false;
    for (const sql of SCHEMA[name]) await db.prepare(sql).run();
    created.add(name);
    return true;
  };
  const statement = (sql, args) => {
    const attempt = (method) => {
      const stmt = db.prepare(sql);
      return stmt.bind(...args)[method]();
    };
    const exec = async (method) => {
      try {
        return await attempt(method);
      } catch (error) {
        const m = MISSING.exec(String(error?.message || error));
        if (!m || !(await ensure(m[1]))) throw error;
        return attempt(method);
      }
    };
    return {
      bind: (...more) => statement(sql, more),
      first: () => exec('first'),
      run: () => exec('run'),
      all: () => exec('all'),
    };
  };
  return {
    prepare: (sql) => statement(sql, []),
    exec: (sql) => db.exec(sql),
  };
}

// 번들에 들어 있는 마이그레이션을 아직 안 적용된 것만 순서대로 적용한다.
// 기록은 wrangler 가 쓰는 d1_migrations 표에 남으므로 `wrangler d1 migrations apply` 와 충돌하지 않는다.
// 이미 컬럼/테이블이 있는 DB(중복 오류)는 그 마이그레이션을 적용된 것으로 기록하고 넘어간다.
const DUPLICATE = /duplicate column|already exists/i;
export async function applyMigrations(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)').run();
  const rows = await db.prepare('SELECT name FROM d1_migrations').all();
  const done = new Set((rows?.results || []).map((r) => r.name));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    try {
      await db.exec(m.sql);
    } catch (error) {
      if (!DUPLICATE.test(String(error?.message || error))) throw error;
    }
    await db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(m.name).run();
    applied.push(m.name);
  }
  return applied;
}
let migrated = null;
// 아이솔레이트당 한 번만 돈다. 실패하면 다음 요청에서 다시 시도한다.
export function ensureMigrated(db) {
  if (!migrated) {
    migrated = typeof db?.exec === 'function'
      ? applyMigrations(db).catch((error) => { console.error('Migration failed:', error); migrated = null; return []; })
      : Promise.resolve([]);
  }
  return migrated;
}
