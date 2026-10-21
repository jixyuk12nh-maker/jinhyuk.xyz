// 번들 실행 테스트: 조각 6개를 무작위 순서로 로드하고 엔진에 넘겨 실행하면 원래 출력과 같은지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscate, obfuscateBundle } from '../src/obfuscator.js';
import { RUNNERS, runFile as runFileWith } from './runners.mjs';

const SKIP = !RUNNERS.lua53 && 'Lua 5.3 계열 실행기가 없음';
const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
const SRC = `local t = {} local function sq(x) return x * x end
local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end
for i = 1, 6 do t[#t+1] = sq(i) + fib(i) end
print(table.concat(t, ","), select('#', 1, 2, 3), ("x"):rep(3))`;
const EXPECT = '2,5,11,19,30,44\t3\txxx';

// 조각을 무작위 순서로 "로드"하고 합친 뒤 엔진을 실행하는 로더 흉내 (Lua 5.3에서 load 사용)
function harness(b, order) {
  const lines = [
    'local function rd(p) local f = assert(io.open(p, "rb")) local s = f:read("a") f:close() return s end',
    'local PR = {}',
  ];
  b.parts.forEach((p, i) => { writeFileSync(join(dir, `part${i}.lua`), p); });
  writeFileSync(join(dir, 'engine.lua'), b.engine);
  for (const i of order) {
    lines.push(`for k, v in pairs(assert(load(rd("${join(dir, `part${i}.lua`)}")))()) do PR[k] = v end`);
  }
  lines.push(`assert(load(rd("${join(dir, 'engine.lua')}")))()(PR)()`);
  const file = join(dir, `run-${order.join('')}.lua`);
  writeFileSync(file, lines.join('\n'));
  return file;
}

test('번들 구성 요소가 6조각과 엔진으로 나뉜다', () => {
  const b = obfuscateBundle(SRC, {});
  assert.equal(b.parts.length, 6);
  assert.ok(b.engine.startsWith('return function('));
});

test('조각을 무작위 순서로 로드해도 출력이 원래 프로그램과 같다 (Lua 5.3 실행기가 있을 때만)', { skip: SKIP }, () => {
  const b = obfuscateBundle(SRC, {});
  for (const order of [[0, 1, 2, 3, 4, 5], [5, 2, 0, 4, 1, 3]]) {
    const r = runFileWith(RUNNERS.lua53, harness(b, order));
    assert.equal(r.ok, true, r.out);
    assert.equal(r.out.trim(), EXPECT);
  }
});

test('번들 코드(code)는 기존 단일 출력과 같은 실행 결과를 낸다', { skip: SKIP }, () => {
  const file = join(dir, 'single.lua');
  writeFileSync(file, obfuscate(SRC, {}));
  const r = runFileWith(RUNNERS.lua53, file);
  assert.equal(r.out.trim(), EXPECT);
});
