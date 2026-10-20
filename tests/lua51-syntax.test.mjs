// Lua 5.1 문법 적합성 테스트. 원본과 난독화본을 같은 Lua 5.1 실행기로 돌려 결과를 비교한다.
// 실행기는 lua5.1 또는 lua51 명령을 찾는다. 없으면 건너뛴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscate } from '../src/obfuscator.js';
import { CASES } from './lua51-cases.mjs';
import { EDGE } from './lua51-edge.mjs';

const LUA = ['lua5.1', 'lua51'].find((b) => !spawnSync(b, ['-v']).error);
const SKIP = !LUA && 'lua 5.1 실행기가 없음';
const dir = mkdtempSync(join(tmpdir(), 'lua51-'));

// 결과 문자열: 실행 성공이면 OK + 출력, 실패면 ERR (메시지 본문은 비교하지 않는다)
function run(file) {
  try {
    return 'OK\n' + execFileSync(LUA, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  } catch (e) {
    return 'ERR\n' + String(e.stdout || '');
  }
}
// 위치 정보 접두사만 뺀다 (줄 번호는 난독화로 바뀐다)
const norm = (s) => s.replace(/^[^\n]*?:\d+: /gm, '');

test('Lua 5.1 문법/의미 케이스: 원본과 난독화본 출력이 같다', { skip: SKIP }, () => {
  const bad = [];
  for (const [name, code] of CASES) {
    const o = join(dir, name + '.lua');
    const b = join(dir, name + '.obf.lua');
    writeFileSync(o, code);
    writeFileSync(b, obfuscate(code));
    if (norm(run(o)) !== norm(run(b))) bad.push(name);
  }
  assert.deepEqual(bad, []);
});

test('Lua 5.1 문법 경계: 거부/허용 여부가 원본과 같다', { skip: SKIP }, () => {
  const bad = [];
  for (const [name, code] of EDGE) {
    const o = join(dir, 'e_' + name + '.lua');
    const b = join(dir, 'e_' + name + '.obf.lua');
    writeFileSync(o, code);
    // 난독화기가 컴파일 단계에서 거부하면 실행 결과는 ERR로 본다
    let rb;
    try { writeFileSync(b, obfuscate(code, { dialect: '5.1' })); rb = run(b); } catch { rb = 'ERR\n'; }
    const ro = run(o);
    if (ro.split('\n')[0] !== rb.split('\n')[0]) bad.push(name);
    if (ro !== rb) bad.push(name);
  }
  assert.deepEqual(bad, []);
});

test('선두 ; 와 연속 ;; 는 Lua 5.1처럼 거부한다 (컴파일 단계)', () => {
  assert.throws(() => obfuscate(';', { dialect: '5.1' }));
  assert.throws(() => obfuscate('local a = 1;; print(a)', { dialect: '5.1' }));
});
