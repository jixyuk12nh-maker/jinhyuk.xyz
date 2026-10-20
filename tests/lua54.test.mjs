// Lua 5.4 문법 테스트: <const>, <close>, 그리고 그 밖의 컴파일 오류.
// <close> 의 실행 결과는 실제 5.4 의미로 손으로 계산한 기대 출력(tests/dialects/close54.expected)과 비교한다.
// 난독화본은 순수 Lua 5.1 이라 lua5.1 실행기가 있으면 그 위에서 돌려 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate, obfuscateDetailed } from '../src/obfuscator.js';

const here = dirname(fileURLToPath(import.meta.url));
const LUA = ['lua5.1', 'lua51'].find((b) => !spawnSync(b, ['-v']).error);
const dir = mkdtempSync(join(tmpdir(), 'lua54-'));

test('5.4 속성이 있는 코드는 5.4 방언으로 고른다', () => {
  assert.equal(obfuscateDetailed('local x <const> = 1 print(x)').dialect, '5.4');
  assert.equal(obfuscateDetailed('local x <close> = nil print(x)').dialect, '5.4');
});

test('5.3 과 Luau 는 속성 문법을 거부한다', () => {
  assert.throws(() => obfuscate('local x <const> = 1', { dialect: '5.3' }));
  assert.throws(() => obfuscate('local x <const> = 1', { dialect: 'luau' }));
});

test('const 에 대입하면 컴파일 오류 (바깥 함수의 상수도 포함)', () => {
  assert.throws(() => obfuscate('local x <const> = 1 x = 2', { dialect: '5.4' }), /const variable 'x'/);
  assert.throws(() => obfuscate('local x <const> = 1 local function f() x = 3 end', { dialect: '5.4' }), /const variable 'x'/);
});

test('같은 이름을 다시 선언하면 그 뒤로는 대입할 수 있다', () => {
  assert.doesNotThrow(() => obfuscate('local x <const> = 1 do local x = 2 x = 3 end', { dialect: '5.4' }));
  assert.doesNotThrow(() => obfuscate('local x <const> = 1 local x = 5 x = 6', { dialect: '5.4' }));
});

test('알 수 없는 속성과 to-be-closed 중복은 거부한다', () => {
  assert.throws(() => obfuscate('local x <foo> = 1', { dialect: '5.4' }), /unknown attribute 'foo'/);
  assert.throws(() => obfuscate('local a <close>, b <close> = nil, nil', { dialect: '5.4' }), /multiple to-be-closed/);
});

test('<close> 실행 결과가 Lua 5.4 기대 출력과 같다 (lua5.1 실행기가 있을 때만)', { skip: !LUA && 'lua 5.1 실행기가 없음' }, () => {
  const src = readFileSync(join(here, 'dialects', 'close54.lua'), 'utf8');
  const expected = readFileSync(join(here, 'dialects', 'close54.expected'), 'utf8');
  const file = join(dir, 'close54.lua');
  writeFileSync(file, obfuscate(src, { dialect: '5.4' }));
  const out = execFileSync(LUA, [file], { encoding: 'utf8' });
  assert.equal(out, expected);
});

test('닫을 수 없는 값을 <close> 하면 실행 시 오류 (lua5.1 실행기가 있을 때만)', { skip: !LUA && 'lua 5.1 실행기가 없음' }, () => {
  const file = join(dir, 'nonclose.lua');
  writeFileSync(file, obfuscate('local q <close> = 42', { dialect: '5.4' }));
  const r = spawnSync(LUA, [file], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /non-closable/);
});
