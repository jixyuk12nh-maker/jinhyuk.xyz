import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscate, obfuscateDetailed } from '../src/obfuscator.js';

const BIT32_SHIM = 'bit32 = {bxor=function(a,b) local r,p=0,1 while a>0 or b>0 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor(a/2) b=math.floor(b/2) p=p*2 end return r end}\n';

function findLua() {
  for (const bin of ['lua5.1', 'lua51', 'lua5.4', 'lua5.3', 'lua', 'texlua']) {
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    if (!r.error) return bin;
  }
  return null;
}
const LUA = findLua();
// 실행 결과 비교의 기준 방언: 5.1 실행기가 있으면 auto(5.1 경로, 상수 접기 포함), 없으면 5.3.
// 5.1 상수 접기는 5.1 의미(정수 부분형 없음)를 따르므로 5.3 실행기와는 부호 0·정수/실수 표기가 다르다.
const LUA_IS_51 = !!LUA && /Lua 5\.1\b/.test(spawnSync(LUA, ['-v'], { encoding: 'utf8' }).stderr + spawnSync(LUA, ['-v'], { encoding: 'utf8' }).stdout);
const REF_DIALECT = LUA_IS_51 ? 'auto' : '5.3';

function runLua(file) {
  return execFileSync(LUA, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function assertSameOutput(src) {
  const dir = mkdtempSync(join(tmpdir(), 'obf-'));
  const orig = join(dir, 'orig.lua');
  const obf = join(dir, 'obf.lua');
  writeFileSync(orig, src);
  writeFileSync(obf, BIT32_SHIM + obfuscate(src, { dialect: REF_DIALECT }));
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

test('모든 최상위 문장을 VM 구간 하나로 만들고 원문 구간을 남기지 않는다', () => {
  const r = obfuscateDetailed(MIXED);
  assert.equal(r.vm, 1);
  assert.equal(r.raw, 0);
  assert.ok(!r.code.includes('function greet(name)'), '함수 정의가 원문으로 남으면 안 된다');
  assert.ok(!r.code.includes('local t = { 1, 2, 3 }'), '테이블 생성이 원문으로 남으면 안 된다');
});

test('로컬 변수가 있는 원문도 원문 구간 없이 VM으로 바꾼다', () => {
  const r = obfuscateDetailed('local t = {}\nprint(#t)');
  assert.equal(r.raw, 0);
  assert.equal(r.vm, 1);
});

test('반복문 바깥의 break는 오류', () => {
  assert.throws(() => obfuscate('break'), /no loop to break/);
});

test('vararg가 아닌 함수에서 ...를 쓰면 오류', () => {
  assert.throws(() => obfuscate('local function f() return ... end'), /vararg/);
});

test('goto는 Lua 5.1에서 일반 식별자다', () => {
  assert.doesNotThrow(() => obfuscate('local goto = 1 print(goto)'));
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

test('마지막 인자로 온 함수 호출은 반환값을 모두 넘긴다', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput('print(pcall(error, "x"))');
  assertSameOutput('print(select(2, "a", "b", "c"))');
  assertSameOutput('print(1, pcall(error, "z"))');
  assertSameOutput('print((pcall(error, "y")))');
  assertSameOutput('print(pcall(print))');
  assertSameOutput('local t = 1 and pcall(error, "w")\nprint(t)');
});

const FULL_51 = String.raw`
local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end
print(fib(10))
local fns = {}
for i = 1, 3 do fns[i] = function() return i end end
print(fns[1](), fns[2](), fns[3]())
local function counter() local c = 0 return function() c = c + 1 return c end end
local c1, c2 = counter(), counter()
print(c1(), c1(), c2())
local function va(...) local a, b = ... return select("#", ...), a, b end
print(va(1, nil, 3))
print((va(7, 8)))
local obj = { v = 10 }
function obj:add(x) return self.v + x end
print(obj:add(5), obj.add(obj, 1))
print(("abc"):upper(), #"abc")
local x, y = 1, 2
x, y = y, x
print(x, y)
local n = 0
repeat local k = n n = n + 1 until k >= 3
print(n)
for i = 10, 1, -3 do io.write(i, " ") end print()
for _, v in ipairs({ "a", "b" }) do print(v) end
for i = 1, 10 do if i == 4 then break end io.write(i) end print()
print(1 and nil, nil or false, 1 .. 2 .. 3, -2 ^ 2, not nil == true)
print([[long
string]], "tab\tq\"", '\65\066')
--[==[ block
comment ]==]
print(#{ 1, 2, 3 }, { f = function() return 1, 2 end } ~= nil)
local t = { (function() return 1, 2, 3 end)() }
print(#t)
local u = { (function() return 1, 2, 3 end)(), 9 }
print(#u, u[2])
local g = 5
local function outer() local z = g + 1; return function() return function() return z * 2 end end end
print(outer()()())
local i = 0
while true do i = i + 1 if i > 5 then break end end
print(i)
local m = {}
m.a = {} m.a.b = function(...) return ... end
print(m.a.b(1, 2))
print(pcall(error, "x"))
print(select(2, "a", "b", "c"))
print(1, pcall(error, "z"))
local t2 = 1 and pcall(error, "w")
print(t2)
local r1, r2, r3 = (function() return 1 end)()
print(r1, r2, r3)
for k = 3, 1 do print("never") end
print(- - 3, not not nil)
`;

test('Lua 5.1 전체 문법 샘플의 실행 결과가 원본과 같다', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput(FULL_51);
});

test('변조 감지 옵션을 켜면 검사 블록이 VM 코드 앞에 원문으로 붙는다', () => {
  const plain = obfuscate(SAMPLE);
  const guarded = obfuscate(SAMPLE, { antiTamper: true });
  assert.ok(guarded.startsWith('-- discord.gg/syncrypt'));
  assert.ok(guarded.slice(guarded.indexOf('\nlocal __vm') + 1).startsWith('local __vm'));
  assert.ok(!plain.includes('discord.gg/syncrypt'));
  assert.ok(guarded.includes('n2 = n2 + 1'));
  assert.ok(!guarded.includes('n2 += 1'));
});

test('변조 감지 옵션을 켠 출력이 Lua 문법으로 읽힌다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'obf-guard-'));
  const file = join(dir, 'guarded.lua');
  const checker = join(dir, 'check.lua');
  writeFileSync(file, obfuscate(SAMPLE, { antiTamper: true }));
  writeFileSync(checker, 'local f, err = loadfile(arg[1])\nif not f then print(err) os.exit(1) end\n');
  const r = spawnSync(LUA, [checker, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('문자열 상수가 출력에 평문으로 남지 않는다', () => {
  const out = obfuscate('local s = "super_secret_token_42"\nprint(s)');
  assert.ok(!out.includes('super_secret_token_42'));
});

test('디스패치는 이진 트리로 나뉜다 (선형 elseif 한 줄 체인이 아님)', () => {
  const out = obfuscate(SAMPLE);
  assert.ok(/if \w+ <= \d+ then/.test(out));
});

test('같은 원문도 실행마다 명령 키가 달라 출력이 매번 다르다', () => {
  assert.notEqual(obfuscate(SAMPLE), obfuscate(SAMPLE));
});

test('nil과 숫자가 섞인 상수 테이블도 실행 결과가 같다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput('local a, b = nil, "x"\nlocal t = {1.5, nil, "y", b, a}\nprint(t[1], t[3], t[4], t[5], "z" .. b)');
});

test('긴 문자열의 CRLF는 LF로 바뀐다 (Lua 규칙)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput('local s = [[a\r\nb]] print(#s)');
});

test('다중 대입은 인덱스 대상의 키를 대입 전 값으로 평가한다', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput('local i = 1 local t = {} i, t[i] = i + 1, 20 print(i, t[1], t[2])');
});

test('숫자 상수 원문이 출력에 평문으로 남지 않는다', () => {
  const out = obfuscate('local x = 4815162342.5 print(x)');
  assert.ok(!out.includes('4815162342.5'));
});

test('가짜 NOP이 들어가도 점프 결과는 같다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assertSameOutput('local s = 0 for i = 1, 20 do if i % 3 == 0 then s = s + i elseif i % 5 == 0 then s = s - 1 else s = s + 1 end end print(s)');
});

test('죽은 블록과 가짜 NOP을 최대로 넣어도 실행 결과가 같다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  for (const density of [0, 1, 3]) {
    const dir = mkdtempSync(join(tmpdir(), 'obf-d-'));
    const orig = join(dir, 'orig.lua');
    const obf = join(dir, 'obf.lua');
    writeFileSync(orig, MIXED);
    writeFileSync(obf, BIT32_SHIM + obfuscate(MIXED, { density, dialect: REF_DIALECT }));
    assert.equal(runLua(obf), runLua(orig), `density ${density}`);
  }
});

test('런타임 내부 이름(exec, push, pop 등)이 출력에 남지 않는다', () => {
  const out = obfuscate(SAMPLE);
  for (const word of ['exec', 'push', 'pop', 'unblob', 'dispatch']) {
    assert.ok(!new RegExp('\\b' + word + '\\b').test(out), word);
  }
});

test('명령 블롭은 평문 숫자 배열이 아니다', () => {
  const out = obfuscate(SAMPLE);
  assert.ok(!/c = \{ ?\d+,/.test(out));
});

test('모든 바이트값(0~255)을 담은 문자열 상수가 그대로 복원된다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  const bytes = Array.from({ length: 256 }, (_, i) => `\\${i}`).join('');
  assertSameOutput(`local s = "${bytes}" print(#s, s:byte(1), s:byte(256), s:byte(128))`);
});

test('길이가 3의 배수가 아닌 상수도 정확히 복원된다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  for (const n of [1, 2, 4, 5, 7, 100, 101]) {
    assertSameOutput(`local s = "${'q'.repeat(n)}" print(#s, s)`);
  }
});

test('큰 상수 테이블(1500개)도 원본과 같고 출력 크기가 원본의 60배를 넘지 않는다', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  let src = 'local t = {}\n';
  for (let i = 0; i < 1500; i++) src += `t[${i + 1}] = "k${i}_${i * 7}"\n`;
  src += 'print(t[1], t[700], t[1500], #t)';
  assertSameOutput(src);
  assert.ok(obfuscate(src).length < src.length * 60);
});

// ───────── 무결성 검사 (런타임 chkk / chkcode) ─────────
function runLuaFailText(file) {
  try {
    runLua(file);
    return null;
  } catch (e) {
    return String(e.stderr || '') + String(e.stdout || '');
  }
}
function writeObfFile(code) {
  const dir = mkdtempSync(join(tmpdir(), 'obf-'));
  const file = join(dir, 'obf.lua');
  writeFileSync(file, BIT32_SHIM + code);
  return file;
}

test('명령 블롭의 한 글자를 바꾸면 실행 전에 무결성 오류가 난다', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  const code = obfuscate(SAMPLE);
  const m = code.match(/c = "([A-Za-z0-9+\/]+)"/);
  assert.ok(m, '블롭을 찾지 못함');
  const first = m[1][0];
  const swapped = (first === 'A' ? 'B' : 'A') + m[1].slice(1);
  const tampered = code.replace(m[0], `c = "${swapped}"`);
  const err = runLuaFailText(writeObfFile(tampered));
  assert.ok(err && err.includes('VM: integrity'), err);
});

test('암호화된 문자열 상수의 한 글자를 바꾸면 무결성 오류가 난다', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  const code = obfuscate(SAMPLE);
  const m = code.match(/es = "([A-Za-z0-9+\/]+)"/);
  assert.ok(m, '암호화 상수를 찾지 못함');
  const swapped = (m[1][0] === 'A' ? 'B' : 'A') + m[1].slice(1);
  const err = runLuaFailText(writeObfFile(code.replace(m[0], `es = "${swapped}"`)));
  assert.ok(err && err.includes('VM: integrity'), err);
});

test('변조하지 않은 출력은 무결성 검사를 통과한다 (Lua 실행기가 있을 때만)', { skip: !LUA && 'lua 실행기가 없음' }, () => {
  assert.equal(runLuaFailText(writeObfFile(obfuscate(SAMPLE))), null);
  assert.equal(runLuaFailText(writeObfFile(obfuscate(MIXED))), null);
});
