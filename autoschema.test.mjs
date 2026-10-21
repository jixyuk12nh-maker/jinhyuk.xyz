// 자동 테이블 생성 테스트: 없는 테이블에 쓰면 현재 스키마의 DDL로 만들고 한 번 재시도해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAutoSchema } from '../src/autoschema.js';
import { SCHEMA } from '../src/schema.js';

// 테이블 목록을 기억하는 가짜 D1. 없는 테이블을 쓰면 실제 D1과 같은 메시지로 실패한다.
function fakeDb() {
  const tables = new Set();
  const log = [];
  const db = {
    tables, log,
    prepare(sql) {
      log.push(sql.split('\n')[0].slice(0, 60));
      const created = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
      const names = [...sql.matchAll(/\b(security_events|banned_ips|nonexistent_table)\b/g)].map((m) => m[1]);
      const stmt = {
        bind() { return stmt; },
        async run() {
          if (created) { tables.add(created[1]); return { meta: { changes: 0 } }; }
          for (const n of names) if (!tables.has(n)) throw new Error(`D1_ERROR: no such table: ${n}: SQLITE_ERROR`);
          return { meta: { changes: 1 } };
        },
        async first() { await stmt.run(); return { n: 1 }; },
        async all() { await stmt.run(); return { results: [] }; },
      };
      return stmt;
    },
    async exec() {},
  };
  return db;
}

test('스키마에 security_events 와 banned_ips 가 있고, 삭제된 key_run_failures 는 없다', () => {
  assert.ok(SCHEMA.security_events && SCHEMA.banned_ips);
  assert.equal(SCHEMA.key_run_failures, undefined);
  assert.ok(SCHEMA.security_events[0].startsWith('CREATE TABLE IF NOT EXISTS security_events'));
});

test('없는 테이블에 쓰면 자동으로 만들고 재시도해서 성공한다', async () => {
  const raw = fakeDb();
  const db = withAutoSchema(raw);
  const r = await db.prepare('INSERT INTO security_events (ip, action) VALUES (?,?)').bind('1.2.3.4', 'x').run();
  assert.equal(r.meta.changes, 1);
  assert.ok(raw.tables.has('security_events'));
});

test('이미 있는 테이블은 다시 만들지 않는다', async () => {
  const raw = fakeDb();
  const db = withAutoSchema(raw);
  await db.prepare('SELECT 1 FROM security_events').first();
  await db.prepare('SELECT 1 FROM security_events').first();
  const creates = raw.log.filter((s) => s.startsWith('CREATE TABLE IF NOT EXISTS security_events')).length;
  assert.equal(creates, 1);
});

test('스키마에 없는 테이블 오류는 그대로 던진다', async () => {
  const db = withAutoSchema(fakeDb());
  await assert.rejects(() => db.prepare('SELECT * FROM nonexistent_table').first(), /no such table: nonexistent_table/);
});
