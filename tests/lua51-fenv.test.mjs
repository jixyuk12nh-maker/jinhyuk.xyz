// Lua 5.1 getfenv/setfenv 레벨 1 의미 테스트. 기대 출력은 실제 Lua 5.1 실행 결과 (tests/dialects/fenv51.expected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate } from '../src/obfuscator.js';

const here = dirname(fileURLToPath(import.meta.url));
const LUA = ['lua5.1', 'lua51'].find((b) => !spawnSync(b, ['-v']).error);

test('setfenv(1, env) 와 getfenv() 가 Lua 5.1 과 같다 (lua5.1 실행기가 있을 때만)', { skip: !LUA && 'lua 5.1 실행기가 없음' }, () => {
  const src = readFileSync(join(here, 'dialects', 'fenv51.lua'), 'utf8');
  const expected = readFileSync(join(here, 'dialects', 'fenv51.expected'), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'fenv51-'));
  const file = join(dir, 'fenv51.lua');
  writeFileSync(file, obfuscate(src, { dialect: '5.1' }));
  assert.equal(execFileSync(LUA, [file], { encoding: 'utf8' }), expected);
});
