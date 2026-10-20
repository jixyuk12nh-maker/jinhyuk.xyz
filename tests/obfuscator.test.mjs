import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscate, obfuscateDetailed } from '../src/obfuscator.js';

// Lua 5.3 계열에는 bit32가 없으므로 테스트 실행용 shim을 앞에 붙인다. Roblox(Luau)는 기본 제공한다.
const BIT32_SHIM = 'bit32 = {bxor=function(a,b) local r,p=0,1 while a>0 or b>0 do local x,y=a%2,b%2 if x~=y then r=r+p end a=a//2 b=b//2 p=p*2 end return r end}\n';

function findLua() {
  for (const bin of ['lua5.4', 'lua5.3', 'lua', 'texlua']) {
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    if (!r.error) return bin;
  }
  return null;
}
const LUA = findLua();

function runLua(file) {
  return execFileSync(LUA, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 원본과 난독화본을 실제로 실행해서 출력이 같은지 확인한다.
function assertSameOutput(src) {
  const dir = mkdtempSync(join(tmpdir(), 'obf-'));
  const orig = join(dir, 'orig.lua');
  const obf = join(dir, 'obf.lua');
  writeFileSync(orig, src);
  writeFileSync(obf, BIT32_SHIM + obfuscate(src));
  assert.equal(runLua(obf), runLua(orig));
}

const SAMPLE = `local a = 2 + 3 * 4
print(a, "hi", a == 14)
local i = 0
while i < 3 do print(i) i = i + 1 end
if a > 10 then print("big") else print("small") end
print("con" .. "cat", -a, not true)`;

const MIXED = `--[[ block
comment ]]
local a = 0x10 + 2
local b
print(a, b, 1e2, .5)
function greet(name)
  return "hi " .. name
end
print(greet("bob"))
print(#"abc", 5 % 3, 2 ^ 3, -2 ^ 2, not nil == true)
print(nil and 1, false or "x", 1 and 2, "esc\\65\\t|")
local t = { 1, 2, 3 }
print(t[2])
game_val = 7
print(game_val * 2)
print("tail")`;

test('지원되는 문법만 있으면 VM 구간 하나로 만든다', () => {
  const r = obfuscateDetailed(SAMPLE);
  assert.equal(r.vm, 1);
  assert.equal(r.raw, 0);
  assert.ok(!r.code.includes('print(a'), '원문 호출문이 그대로 남으면 안 된다');
});

test('지원하지 않는 문장은 원문 그대로 남기고 나머지는 VM으로 바꾼다', () => {
  const r = obfuscateDetailed(MIXED);
  assert.ok(r.raw >= 2);
  assert.ok(r.code.includes('function greet(name)'));
  assert.ok(r.code.includes('local t = { 1, 2, 3 }'));
});

test('원문 구간의 local을 VM이 전역으로 잘못 읽지 않는다', () => {
  const src = 'local t = {}\nprint(#t)';
  const r = obfuscateDetailed(src);
  assert.ok(r.raw >= 1, 'print(#t)는 원문으로 남아야 한다');
});

test('return이 블록 마지막이 아니면 원본과 같은 구문 오류로 막는다', () => {
  assert.throws(() => obfuscate('print(1)\nreturn 5\nprint(2)'), /return/);
});

test('닫히지 않은 문자열은 오류로 막는다', () => {
  assert.throws(() => obfuscate('print("abc'), /unfinished string/);
});

test('문자열 리터럴 안의 한글은 VM 구간에서 평문으로 나오지 않는다', () => {
  const out = obfuscate('print("안녕하세요")');
  assert.ok(!out.includes('안녕하세요'));
});

test('빌드마다 키와 이름이 달라진다', () => {
  assert.notEqual(obfuscate(SAMPLE), obfuscate(SAMPLE));
});

test('빈 입력도 오류 없이 처리한다', () => {
  assert.doesNotThrow(() => obfuscate(''));
});

test('실행 결과가 원본과 같다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput(SAMPLE);
  assertSameOutput(MIXED);
  assertSameOutput('local t = {}\nlocal function f(a) return a * 2 end\nprint(f(4), #t)');
  assertSameOutput('print(1 and nil, nil or false, 2 ^ 3 ^ 2, 1 .. 2 .. 3)');
});
