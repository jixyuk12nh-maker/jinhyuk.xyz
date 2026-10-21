// D1 래퍼: 쿼리가 "no such table: X" 로 실패하고 X 가 현재 스키마에 있으면, 그 테이블과 인덱스를 만든 뒤 한 번 다시 실행한다.
// 마이그레이션을 빠뜨린 채 배포해도 필요한 테이블이 자동으로 생긴다. 이미 있는 테이블은 건드리지 않는다 (IF NOT EXISTS).
import { SCHEMA } from './schema.js';

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
