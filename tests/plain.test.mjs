// 난독화 끄기(plainBundle) 테스트: 원문 바이트를 6조각으로 나눠 로더 프로토콜대로 합치면 원래 출력과 같아야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainBundle, plainDecoyPart } from '../src/obfuscator.js';
import { RUNNERS, runFile as runFileWith } from './runners.mjs';

const SKIP = !RUNNERS.lua53 && 'Lua 5.3 계열 실행기가 없음';
const dir = mkdtempSync(join(tmpdir(), 'plain-'));

// 따옴표, 역슬래시, 제어 문자, UTF-8(한글) 을 모두 담은 원문. 조각 경계가 UTF-8 글자 한가운데에 걸리도록 길게 쓴다.
const SRC = `local s = "따옴표\\" 역슬래시\\\\ 탭\\t 한글 테스트"
local n = 0
for i = 1, 10 do n = n + i end
print(n, #s > 0, "\\0x")
print([==[긴 문자열 ]] 안에 ]=] 도 ok]==])
`;
// 원문 자체를 실행한 결과를 기준으로 쓴다 (\\0 은 NUL 바이트)
const NATIVE = join(dir, 'native.lua');
writeFileSync(NATIVE, SRC);

// 조각을 주어진 순서로 로드하고 엔진에 넘기는 로더 흉내
function harness(b, order, name) {
  const lines = ['local PR = {}'];
  b.parts.forEach((p, i) => writeFileSync(join(dir, `${name}-part${i}.lua`), p));
  writeFileSync(join(dir, `${name}-engine.lua`), b.engine);
  for (const i of order) {
    lines.push(`for k, v in pairs(assert(loadfile("${join(dir, `${name}-part${i}.lua`)}"))()) do PR[k] = v end`);
  }
  lines.push(`assert(loadfile("${join(dir, `${name}-engine.lua`)}"))()(PR)()`);
  const file = join(dir, `${name}-run-${order.join('')}.lua`);
  writeFileSync(file, lines.join('\n'));
  return file;
}

test('평문 묶음은 6조각과 엔진을 만들고 원문을 그대로 담는다', () => {
  const b = plainBundle(SRC);
  assert.equal(b.parts.length, 6);
  assert.equal(b.code, SRC);
  assert.ok(b.engine.startsWith('return function(PR)'));
});

test('평문 조각은 ASCII 만 쓴다 (sha256/fletcher 계산이 바이트 단위와 같다)', () => {
  const b = plainBundle(SRC);
  for (const p of b.parts) assert.match(p, /^[\x00-\x7f]*$/);
});

test('조각을 무작위 순서로 합쳐도 출력이 원문과 같다 (Lua 5.3 실행기가 있을 때만)', { skip: SKIP }, () => {
  const b = plainBundle(SRC);
  for (const order of [[0, 1, 2, 3, 4, 5], [5, 2, 0, 4, 1, 3]]) {
    const r = runFileWith(RUNNERS.lua53, harness(b, order, 'ok'));
    assert.equal(r.ok, true, r.out);
    assert.equal(r.out, runFileWith(RUNNERS.lua53, NATIVE).out);
  }
});

test('가짜 응답 조각을 합치면 실행해도 아무 일도 없다 (Lua 5.3 실행기가 있을 때만)', { skip: SKIP }, () => {
  const lines = ['local PR = {}'];
  for (let i = 0; i < 6; i++) {
    const f = join(dir, `decoy-${i}.lua`);
    writeFileSync(f, plainDecoyPart(i));
    lines.push(`for k, v in pairs(assert(loadfile("${f}"))()) do PR[k] = v end`);
  }
  lines.push(`local t = {} for i = 1, 6 do t[i] = PR[i] end assert(loadstring or load)(table.concat(t))()`);
  const file = join(dir, 'decoy-run.lua');
  writeFileSync(file, lines.join('\n'));
  const r = runFileWith(RUNNERS.lua53, file);
  assert.equal(r.ok, true, r.out);
  assert.equal(r.out, '');
});
