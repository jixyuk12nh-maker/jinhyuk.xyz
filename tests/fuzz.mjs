// 무작위 Lua 프로그램을 만들어 원본과 난독화본의 실행 결과를 비교한다.
// 사용법: node tests/fuzz.mjs [개수=200] [시작 시드=1]   (Lua 실행기가 없으면 건너뜀)
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGen } from './gen-lua.mjs';
import { obfuscate } from '../src/obfuscator.js';

const LUA = ['lua5.1', 'lua51', 'lua5.4', 'lua5.3', 'lua', 'texlua'].find((b) => !spawnSync(b, ['-v']).error);
if (!LUA) { console.log('lua 실행기가 없어 건너뜀'); process.exit(0); }

const N = Number(process.argv[2] || 200);
const START = Number(process.argv[3] || 1);
const dir = mkdtempSync(join(tmpdir(), 'fuzz-'));
const run = (f) => {
  try { return execFileSync(LUA, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }); }
  catch (e) { return String(e.stdout || '') + '\nERR'; }
};
// 에러 메시지의 위치와 변수명은 난독화로 바뀌므로 비교에서 뺀다
const norm = (x) => x.replace(/^[^\n]*?:\d+: [^\n]*/gm, (m) => m.replace(/^[^:]*:\d+: /, '').replace(/ \(.*?\)$/, ''));

let mismatches = 0;
for (let seed = START; seed < START + N; seed++) {
  const src = makeGen((seed * 2654435761) >>> 0);
  const o = join(dir, 'o.lua');
  const b = join(dir, 'b.lua');
  writeFileSync(o, src);
  writeFileSync(b, obfuscate(src));
  if (norm(run(o)) !== norm(run(b))) {
    mismatches++;
    console.log('불일치 시드', seed);
  }
}
console.log(`실행 ${N}개, 불일치 ${mismatches}개`);
process.exit(mismatches ? 1 : 0);
