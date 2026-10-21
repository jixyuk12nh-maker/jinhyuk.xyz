// 전송 프로토콜 테스트 (가짜 D1/R2 위에서 worker.js 핸들러를 실행). 로더 검사는 delivery-sim.mjs 참고.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startSession, getChunk, checkLoader, bundle } from './delivery-sim.mjs';
import worker from '../src/worker.js';

const old = (env) => { for (const s of env._db.sessions) s.created_at = '2000-01-01T00:00:00.000Z'; };

test('저장 때 조각 6개, 엔진, 매니페스트, 로더가 만들어진다', async () => {
  const env = await makeEnv();
  for (let i = 0; i < 6; i++) assert.ok(env._bucket[`scripts/s1.part${i + 1}.lua`] !== undefined);
  assert.ok(env._bucket['scripts/s1.engine.lua'] !== undefined);
  assert.ok(env._bucket['scripts/s1.manifest.json'] !== undefined);
  assert.ok(env._bucket['scripts/s1.loader.lua'] !== undefined);
});

test('6조각이 모두 도착하고, 각 조각은 저장된 조각과 같다', async () => {
  const env = await makeEnv();
  const r = await checkLoader(env);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.parts, bundle.parts);
});

test('같은 스크립트·키로 다시 요청하면 차단한다 (유효 시간 안)', async () => {
  const env = await makeEnv();
  assert.ok((await checkLoader(env)).ok);
  assert.equal((await startSession(env)).status, 429);
});

test('토큰을 다 쓴 뒤 같은 토큰으로 조각을 더 받을 수 없다', async () => {
  const env = await makeEnv();
  const r = await checkLoader(env);
  assert.equal((await getChunk(env, r.token, 0)).status, 403);
});

test('조각 도착 순서가 세션마다 달라진다 (무작위 전송)', async () => {
  const env = await makeEnv();
  const orders = new Set();
  for (let i = 0; i < 6; i++) {
    old(env);
    const r = await checkLoader(env);
    assert.ok(r.ok);
    orders.add(r.arrival.join(','));
  }
  assert.ok(orders.size > 1);
});

test('순서를 어긴 요청(재전송)은 세션을 끊는다', async () => {
  const env = await makeEnv();
  old(env);
  const s = await startSession(env);
  assert.equal((await getChunk(env, s.body.token, 0)).status, 200);
  assert.equal((await getChunk(env, s.body.token, 0)).status, 409);
  assert.equal((await getChunk(env, s.body.token, 1)).status, 403);
});

test('R2에 저장된 조각을 바꾸면 전송이 막힌다', async () => {
  const env = await makeEnv();
  env._bucket['scripts/s1.part2.lua'] = env._bucket['scripts/s1.part2.lua'].slice(0, -1) + 'Z';
  const r = await checkLoader(env);
  assert.equal(r.ok, false);
});

test('잘못된 키 누적 후 가짜 응답은 모든 조각이 같은 가짜 조각이다', async () => {
  const env = await makeEnv();
  for (let i = 0; i < 6; i++) await startSession(env, 'BAD' + i);
  old(env);
  const d = await checkLoader(env, 'BAD9');
  assert.ok(d.ok, JSON.stringify(d));
  assert.equal(new Set(d.parts).size, 1);
  assert.ok(!bundle.parts.includes(d.parts[0]));
});

test('미보호 스크립트는 세션도 조각도 내보내지 않는다', async () => {
  const env = await makeEnv({ obfuscated: 0 });
  assert.equal((await startSession(env)).status, 503);
});

test('키리스/로더 주소 본문은 평문 로더를 포함하지 않는다', async () => {
  const env = await makeEnv();
  const r = await worker.fetch(new Request('https://jinhyuk.xyz/demo', { headers: { 'cf-connecting-ip': '1.2.3.4', accept: '*/*' } }), env);
  const body = await r.text();
  assert.equal(r.status, 200);
  assert.ok(!body.includes('request_fn'));
  assert.ok(!body.includes('fletcher'));
});
