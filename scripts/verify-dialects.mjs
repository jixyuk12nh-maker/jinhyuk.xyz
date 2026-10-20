// 방언 검증 매트릭스. 실행기가 있는 만큼 돌리고 PASS/FAIL/SKIP을 출력한다.
//   node scripts/verify-dialects.mjs
// 실행기 지정: LUA51_BIN, LUA53_BIN, LUAU_BIN 환경변수
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate } from '../src/obfuscator.js';
import { RUNNERS, runFile } from '../tests/runners.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'dialects');
const dir = mkdtempSync(join(tmpdir(), 'verify-'));

// 픽스처: 파일 이름 → 방언, 실행기 종류
const FIXTURES = [
  ['goto52.lua', '5.2', ['lua53']],
  ['env52.lua', '5.2', ['lua53']],
  ['env_assign.lua', '5.2', ['lua53']],
  ['pure_paths.lua', '5.3', ['lua53']],
  ['luau-full.lua', 'luau', ['luau']],
  ['luau_gen.lua', 'luau', ['luau']],
  ['luau_extra.lua', 'luau', ['luau']],
  ['setfenv51.lua', '5.1', ['lua51']],
];

let fail = 0;
for (const [file, dialect, kinds] of FIXTURES) {
  const src = readFileSync(join(root, file), 'utf8');
  const expFile = join(root, basename(file, '.lua') + '.expected');
  let expected = null;
  try { expected = readFileSync(expFile, 'utf8'); } catch { /* 기대 출력 없음 */ }
  for (const kind of kinds) {
    const runner = RUNNERS[kind];
    if (!runner) { console.log(`SKIP  ${file} [${kind}] 실행기 없음`); continue; }
    const orig = join(dir, file);
    writeFileSync(orig, src);
    const obf = join(dir, file.replace(/\.lua$/, '.obf.lua'));
    writeFileSync(obf, obfuscate(src, { dialect, density: 3 }));
    const native = runFile(runner, orig);
    const vm = runFile(runner, obf);
    const checks = [];
    if (expected !== null) checks.push(['원본 출력=기대', native.out === expected]);
    checks.push(['VM 출력=원본', native.ok === vm.ok && native.out === vm.out]);
    const ok = checks.every(([, v]) => v);
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${file} [${kind} ${runner.bin}] ${checks.map(([n, v]) => `${n}:${v ? 'o' : 'x'}`).join(' ')}`);
  }
}
console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과 (실행기가 있는 항목 기준)');
process.exit(fail ? 1 : 0);
