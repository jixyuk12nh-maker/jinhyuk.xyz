// 혼합 방언 테스트: Luau 문법과 5.3 정수 연산이 한 파일에 섞인 원문을 VM으로 감싸는지 확인한다.
// 실행 비교는 Lua 5.3 계열 실행기가 있을 때만 한다. 기준은 같은 로직을 5.3 문법으로 쓴 참조 코드다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscate, obfuscateDetailed, validateLua51 } from '../src/obfuscator.js';
import { RUNNERS, runFile as runFileWith } from './runners.mjs';

const SKIP = !RUNNERS.lua53 && 'Lua 5.3 계열 실행기가 없음';
const dir = mkdtempSync(join(tmpdir(), 'mixed-'));

function runSource(code, name) {
  const file = join(dir, name + '.lua');
  writeFileSync(file, code);
  const r = runFileWith(RUNNERS.lua53 ?? { bin: 'lua' }, file);
  return r.ok ? r.out : 'ERR ' + r.out;
}

// 원문은 Luau(+=)와 5.3(//, 0x7_D 등)이 섞여 어느 한 방언로도 통과하지 못한다.
const MIXED_SRC = `local n = 0
n += 5
local h = 0x7_D
print(n // 2, h, 0b101 + 1_000, n & 3, 7 ~ 2)
local out = {}
for i = 1, 6 do
  if i % 2 == 0 then continue end
  out[#out + 1] = i // 2
end
print(table.concat(out, ","))
`;

// 같은 로직을 5.3 문법으로 쓴 참조. 출력이 같아야 한다.
const REF_SRC = `local n = 0
n = n + 5
local h = 0x7D
print(n // 2, h, 0x5 + 1000, n & 3, 7 ~ 2)
local out = {}
for i = 1, 6 do
  if i % 2 == 0 then goto skip end
  out[#out + 1] = i // 2
  ::skip::
end
print(table.concat(out, ","))
`;

test('auto: 어느 한 방언으로도 안 되는 혼합 원문은 mixed 로 VM 감싼다', () => {
  const r = obfuscateDetailed(MIXED_SRC);
  assert.equal(r.dialect, 'mixed');
  assert.equal(r.vm, 1);
  assert.equal(r.raw, 0);
});

test('mixed 출력은 Lua 5.1 문법이다', () => {
  assert.equal(validateLua51(obfuscate(MIXED_SRC)), null);
});

test('기존 방언으로 통과하던 코드는 여전히 앞선 방언을 고른다', () => {
  assert.equal(obfuscateDetailed('local x = 1 print(x)').dialect, '5.1');
  assert.equal(obfuscateDetailed('print(7 // 2)').dialect, '5.3');
  assert.equal(obfuscateDetailed('local n = 0 n += 1').dialect, 'luau');
});

test('mixed 명시 지정은 혼합 원문을 받고, 알 수 없는 방언은 여전히 거부한다', () => {
  assert.doesNotThrow(() => obfuscate(MIXED_SRC, { dialect: 'mixed' }));
  assert.throws(() => obfuscate('print(1)', { dialect: 'nope' }), /알 수 없는 방언/);
});

test('mixed 실행 결과가 5.3 참조 코드와 같다 (Lua 5.3 실행기가 있을 때만)', { skip: SKIP }, () => {
  const ref = runSource(REF_SRC, 'ref');
  const vm = runSource(obfuscate(MIXED_SRC), 'vm');
  assert.equal(vm, ref);
});
