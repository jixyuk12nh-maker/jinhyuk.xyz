// 변조 감지 테스트: 디버그 훅 설치, 전역 getfenv 교체, 명령 블롭 변조를 실행 전후에 잡는지 확인한다.
// Lua 5.3 계열 실행기(texlua 등)가 있을 때만 실행한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscate } from '../src/obfuscator.js';
import { RUNNERS, runFile as runFileWith } from './runners.mjs';

const SKIP = !RUNNERS.lua53 && 'Lua 5.3 계열 실행기가 없음';
const dir = mkdtempSync(join(tmpdir(), 'tamper-'));
const SAMPLE = 'local t = {} for i = 1, 5 do t[i] = i * i end print(table.concat(t, ","))';

function run(code, name) {
  const file = join(dir, name + '.lua');
  writeFileSync(file, code);
  return runFileWith(RUNNERS.lua53 ?? { bin: 'lua' }, file);
}

test('정상 실행은 통과한다', { skip: SKIP }, () => {
  const r = run(obfuscate(SAMPLE), 'clean');
  assert.equal(r.ok, true);
  assert.match(r.out, /1,4,9,16,25/);
});

test('디버그 훅이 설치돼 있으면 실행을 막는다', { skip: SKIP }, () => {
  const r = run('debug.sethook(function() end, "", 1000000)\n' + obfuscate(SAMPLE), 'hook');
  assert.equal(r.ok, false);
  assert.match(r.out, /VM: integrity/);
});

test('실행 중 전역 getfenv 를 바꾸면 다음 검사에서 막는다', { skip: SKIP }, () => {
  // 검사는 함수 호출 간격(24~80회)마다 돈다. 교체 뒤 호출을 충분히 해서 검사에 걸리게 한다.
  const code = 'local function f(x) return x end\n'
    + 'for i = 1, 300 do if i == 100 then getfenv = function() return _G end end f(i) end\n'
    + 'print("done")';
  const r = run(obfuscate(code), 'fenv');
  assert.equal(r.ok, false);
  assert.match(r.out, /VM: integrity/);
});

test('명령 블롭 한 글자를 바꾸면 실행 전에 막힌다 (연쇄 암호화)', { skip: SKIP }, () => {
  const out = obfuscate(SAMPLE);
  // 블롭 문자열 중 하나를 골라 같은 길이의 다른 base64 글자로 바꾼다
  const m = out.match(/c = "([A-Za-z0-9+\/]{64,})"/);
  assert.ok(m, '블롭을 찾지 못함');
  const blob = m[1];
  const mid = Math.floor(blob.length / 2) & ~3;
  const swapped = blob[mid] === 'A' ? 'B' : 'A';
  const bad = out.replace(blob, blob.slice(0, mid) + swapped + blob.slice(mid + 1));
  const r = run(bad, 'blob');
  assert.equal(r.ok, false);
  assert.match(r.out, /VM: integrity/);
});

test('함수(proto)마다 명령 번호 순열이 다르다', () => {
  const out = obfuscate('local function a() return 1 end local function b() return 2 end local function c() return 3 end print(a() + b() + c())');
  const tables = [...out.matchAll(/pm = \{ ([0-9, ]+) \}/g)].map((m) => m[1]);
  assert.ok(tables.length >= 4, '프로토 표가 충분히 나오지 않음');
  assert.equal(new Set(tables).size, tables.length);
});
