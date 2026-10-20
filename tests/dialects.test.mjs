// 방언 테스트: 자동 선택, 방언 밖 문법 거부, 5.2/5.3 실행 결과 비교, Luau 기대 출력 비교.
// 실행기는 lua5.4, lua5.3, lua, texlua 순으로 찾는다. 없으면 실행 비교 테스트만 건너뛴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate, obfuscateDetailed } from '../src/obfuscator.js';
import { RUNNERS, runFile as runFileWith } from './runners.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SKIP = !RUNNERS.lua53 && 'Lua 5.3 계열 실행기가 없음';
const LUAU_SKIP = !RUNNERS.luau && 'Luau 실행기가 없음 (LUAU_BIN 으로 지정 가능)';
const dir = mkdtempSync(join(tmpdir(), 'dialect-'));

function runFile(file) {
  const r = runFileWith(RUNNERS.lua53 ?? { bin: 'lua' }, file);
  return r.ok ? r.out : 'ERR ' + r.out;
}

// ── 1) 자동 선택 ──
test('auto: 방언을 5.1 → 5.2 → 5.3 → luau 순으로 고른다', () => {
  assert.equal(obfuscateDetailed('local goto = 1 print(goto)').dialect, '5.1');
  assert.equal(obfuscateDetailed('for i = 1, 2 do if i == 1 then goto c end ::c:: end').dialect, '5.2');
  assert.equal(obfuscateDetailed('print(7 // 2, 5 & 3)').dialect, '5.3');
  assert.equal(obfuscateDetailed('local n = 0 n += 1').dialect, 'luau');
  assert.equal(obfuscateDetailed('local x: number = 1 print(x)').dialect, 'luau');
  assert.equal(obfuscateDetailed('print(`a{1}b`)').dialect, 'luau');
});

// ── 2) 명시 방언은 다른 방언 문법을 거부한다 ──
test('명시 방언: 방언 밖 문법은 거부한다', () => {
  assert.throws(() => obfuscate('goto x ::x::', { dialect: '5.1' }));
  assert.throws(() => obfuscate('print(7 // 2)', { dialect: '5.2' }));
  assert.throws(() => obfuscate('n += 1', { dialect: '5.3' }));
  assert.throws(() => obfuscate('print(`a`)', { dialect: '5.3' }));
  assert.throws(() => obfuscate('print(1)', { dialect: 'nope' }), /알 수 없는 방언/);
});

test('명시 방언 5.2/5.3/luau는 해당 문법을 받는다', () => {
  assert.doesNotThrow(() => obfuscate('goto x ::x::', { dialect: '5.2' }));
  assert.doesNotThrow(() => obfuscate('print(7 // 2, 1 << 3)', { dialect: '5.3' }));
  assert.doesNotThrow(() => obfuscate('local n = 0 n += 2 print(0b11, 1_000)', { dialect: 'luau' }));
});

test('continue 는 반복문 밖에서 거부한다 (luau)', () => {
  assert.throws(() => obfuscate('continue', { dialect: 'luau' }), /continue/);
});

test('라벨: 없는 라벨로 goto 하면 거부, 중복 라벨도 거부', () => {
  assert.throws(() => obfuscate('goto nowhere', { dialect: '5.2' }), /no visible label/);
  assert.throws(() => obfuscate('::a:: ::a::', { dialect: '5.2' }), /already defined/);
});

// ── 3) 5.2/5.3 실행 결과: 원본과 난독화본이 같아야 한다 ──
const NATIVE_CASES = [
  ['goto52', 'goto52.lua'],
  ['int53', `print(7 // 2, -7 // 2, 7.5 // 2, 5 & 3, 5 | 3, 5 ~ 3, ~0, 1 << 4, 256 >> 4, -1 >> 60, -1 << 1, ~5, 2^3 // 1)
print(1 << 40, 1 << 64, 3 & -1, 0xFF00 & 0x0FF0, 0xF0 | 0x0F, -1 & 0xFFFF)
print(1 + 2 << 1, 1 | 2 & 3, 2 ^ 2 // 1, "3" // 2, 5 ~ 1 == 4, 1 << 2 + 1)`],
];
for (const [name, body] of NATIVE_CASES) {
  test(`5.2/5.3 실행 비교: ${name}`, { skip: SKIP }, () => {
    const src = body.endsWith('.lua') ? readFileSync(join(here, 'dialects', body), 'utf8') : body;
    const o = join(dir, name + '.lua');
    const b = join(dir, name + '.obf.lua');
    writeFileSync(o, src);
    writeFileSync(b, obfuscate(src, { dialect: '5.3', density: 3 }));
    assert.equal(runFile(b), runFile(o));
  });
}

// ── 4) Luau 기대 출력: 손으로 계산한 결과와 같아야 한다 (Luau 실행기 없이 5.3 계열로 검사) ──
test('Luau 전체 문법 샘플: 기대 출력과 같다', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'luau-full.lua'), 'utf8');
  const expected = readFileSync(join(here, 'dialects', 'luau-full.expected'), 'utf8');
  const b = join(dir, 'luau.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: 'luau', density: 3 }));
  assert.equal(runFile(b), expected);
});

test('5.2/5.3 goto 샘플: 기대 출력과 같다', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'goto52.lua'), 'utf8');
  const expected = readFileSync(join(here, 'dialects', 'goto52.expected'), 'utf8');
  const b = join(dir, 'goto.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: '5.2', density: 3 }));
  assert.equal(runFile(b), expected);
});

// ── 5) 추가 문법: _ENV, goto 범위 검사, Luau 제네릭 호출/타입 팩/앞쪽 | ──
test('5.2 _ENV: 지역 _ENV 가 전역 이름을 가로챈다 (네이티브와 같음)', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'env52.lua'), 'utf8');
  const o = join(dir, 'env.lua');
  const b = join(dir, 'env.obf.lua');
  writeFileSync(o, src);
  writeFileSync(b, obfuscate(src, { dialect: '5.2', density: 3 }));
  assert.equal(runFile(b), runFile(o));
});

test('5.2 _ENV: 전역 _ENV 대입은 거부하지 않는다', () => {
  assert.doesNotThrow(() => obfuscate('_ENV = {}', { dialect: '5.2' }));
});

test('5.1 에서는 _ENV 가 그냥 이름이다 (거부하지 않는다)', () => {
  assert.doesNotThrow(() => obfuscate('local _ENV = {} print(x)', { dialect: '5.1' }));
});

test('5.2 goto: 지역 변수 scope 안으로 뛰면 거부, 블록 끝 라벨은 허용', () => {
  assert.throws(() => obfuscate('goto l local a = 1 ::l:: print(a)', { dialect: '5.2' }), /jumps into the scope/);
  assert.doesNotThrow(() => obfuscate('do goto l local a = 1 ::l:: end print("ok")', { dialect: '5.2' }));
  assert.doesNotThrow(() => obfuscate('goto l local a = 1 ::l::', { dialect: '5.2' }));
});

test('Luau 제네릭 호출, 타입 팩, 앞쪽 | 유니온: 기대 출력과 같다', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'luau_gen.lua'), 'utf8');
  const expected = readFileSync(join(here, 'dialects', 'luau_gen.expected'), 'utf8');
  const b = join(dir, 'gen.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: 'luau', density: 3 }));
  assert.equal(runFile(b), expected);
});

test('5.3 정수 연산: 내장 실행기 경로와 순수 Lua 경로 모두 원본과 같다 (2^53 이내 결과)', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'pure_paths.lua'), 'utf8');
  const native = runFile(join(here, 'dialects', 'pure_paths.lua'));
  const b = join(dir, 'pure-native.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: '5.3', density: 3 }));
  assert.equal(runFile(b), native);
  // 순수 경로 강제: math.type / load 가 없는 것처럼 실행. 마지막 줄(2^53 초과 결과)만 근사라 다르다.
  const p = join(dir, 'pure-forced.obf.lua');
  writeFileSync(p, 'math.type = nil; load = nil; loadstring = nil\n' + obfuscate(src, { dialect: '5.3', density: 3 }));
  assert.deepEqual(runFile(p).split('\n').slice(0, 2), native.split('\n').slice(0, 2));
});

// ── 6) 남은 항목: 전역 _ENV 대입, tostring 가림 방지, 제네릭 함수 타입, goto 오류의 지역 이름 ──
test('5.2 전역 _ENV 대입: 이후 전역 접근이 새 테이블을 거친다 (네이티브와 같음)', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'env_assign.lua'), 'utf8');
  const b = join(dir, 'envassign.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: '5.2', density: 3 }));
  assert.equal(runFile(b), readFileSync(join(here, 'dialects', 'env_assign.expected'), 'utf8'));
});

test('Luau: 지역 tostring 이 가려도 보간 문자열은 전역 tostring 을 쓴다, 제네릭 함수 타입 허용', { skip: SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'luau_extra.lua'), 'utf8');
  const b = join(dir, 'extra.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: 'luau', density: 3 }));
  assert.equal(runFile(b), readFileSync(join(here, 'dialects', 'luau_extra.expected'), 'utf8'));
});

test('5.2 goto 오류 메시지에 지역 이름이 들어간다', () => {
  assert.throws(() => obfuscate('goto l local a = 1 ::l:: print(a)', { dialect: '5.2' }), /local 'a'/);
});

// ── 7) 실제 Luau 실행기가 있을 때: 원본 Luau 출력이 기대 출력과 같은지 확인 (기대 출력의 근거 검증)
for (const name of ['luau-full', 'luau_gen', 'luau_extra']) {
  test(`실제 Luau 원본 출력 = 기대 출력: ${name}`, { skip: LUAU_SKIP }, () => {
    const src = join(here, 'dialects', name + '.lua');
    const r = runFileWith(RUNNERS.luau, src);
    assert.equal(r.ok, true, r.out);
    assert.equal(r.out, readFileSync(join(here, 'dialects', name + '.expected'), 'utf8'));
  });
}

// ── 8) 실행기 환경 요구: 모든 출력은 Lua 5.1 문법(Luau 기반 실행기 포함)이어야 한다
import { validateLua51 } from '../src/obfuscator.js';
const FIXTURE_SRC = ['luau-full', 'luau_gen', 'luau_extra', 'goto52', 'env52', 'env_assign', 'pure_paths'];
for (const name of FIXTURE_SRC) {
  test(`출력은 Lua 5.1 문법이다 (안티 변조 포함): ${name}`, () => {
    const src = readFileSync(join(here, 'dialects', name + '.lua'), 'utf8');
    for (const antiTamper of [false, true]) {
      const out = obfuscate(src, { dialect: 'auto', density: 3, antiTamper });
      assert.equal(validateLua51(out), null);
    }
  });
}
test('출력 검증기는 5.2+ 문법과 16진 실수 토큰을 거부한다', () => {
  assert.notEqual(validateLua51('goto x ::x::'), null);
  assert.notEqual(validateLua51('print(7 // 2)'), null);
  assert.notEqual(validateLua51('print(0x1p4)'), null);
});
test('5.2 16진 실수는 10진으로 바뀌어 출력된다', { skip: SKIP }, () => {
  const out = obfuscate('print(0x1.8p3, 0x1p-2)', { dialect: '5.2', density: 0 });
  assert.equal(validateLua51(out), null);
  writeFileSync(join(dir, 'hexf.obf.lua'), out);
  assert.equal(runFile(join(dir, 'hexf.obf.lua')), '12\t0.25\n');
});
test('5.1 입력의 16진 실수 0x1p4 는 받아서 10진으로 낸다 (출력에는 16진 실수가 없다)', { skip: SKIP }, () => {
  const out = obfuscate('print(0x1p4)', { dialect: '5.1', density: 0 });
  assert.equal(validateLua51(out), null);
  writeFileSync(join(dir, 'hf51.obf.lua'), out);
  assert.equal(runFile(join(dir, 'hf51.obf.lua')), '16\n');
});

// ── 9) Lua 5.1 환경 모델: setfenv/getfenv 는 실제 5.1 실행기에서만 검증할 수 있다 (5.3에는 없음)
const LUA51_SKIP = !RUNNERS.lua51 && 'Lua 5.1 실행기가 없음 (LUA51_BIN 으로 지정 가능)';
test('Lua 5.1 setfenv/getfenv: 원본과 난독화본이 같고 기대 출력과 같다', { skip: LUA51_SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'setfenv51.lua'), 'utf8');
  const o = join(dir, 'sf.lua');
  const b = join(dir, 'sf.obf.lua');
  writeFileSync(o, src);
  writeFileSync(b, obfuscate(src, { dialect: '5.1', density: 3 }));
  const orig = runFileWith(RUNNERS.lua51, o);
  const vm = runFileWith(RUNNERS.lua51, b);
  assert.equal(orig.out, readFileSync(join(here, 'dialects', 'setfenv51.expected'), 'utf8'));
  assert.equal(vm.out, orig.out);
});
test('기본 환경(setfenv 안 씀)은 5.3에서도 원본과 같다', { skip: SKIP }, () => {
  const src = 'x = 1 print(x, _G.x) local function f() return y end y = 5 print(f())';
  const b = join(dir, 'defenv.obf.lua');
  writeFileSync(b, obfuscate(src, { dialect: '5.1', density: 3 }));
  assert.equal(runFile(b), '1\t1\n5\n');
});

// ── 10) 5.1 상수 접기와 부호 0: 실제 5.1 실행기 출력과 같아야 한다 (5.3 에서는 접지 않음)
test('5.1 상수 접기: -0 과 접힌 숫자가 실제 5.1 과 같다', { skip: LUA51_SKIP }, () => {
  const src = readFileSync(join(here, 'dialects', 'fold51.lua'), 'utf8');
  const o = join(dir, 'fold51.lua');
  const b = join(dir, 'fold51.obf.lua');
  writeFileSync(o, src);
  writeFileSync(b, obfuscate(src, { dialect: '5.1', density: 3 }));
  assert.equal(runFileWith(RUNNERS.lua51, b).out, readFileSync(join(here, 'dialects', 'fold51.expected'), 'utf8'));
});
