// 실행기 찾기. 환경변수가 있으면 그것을 먼저 쓰고, 없으면 PATH에서 후보 이름을 찾는다.
//   LUA51_BIN=/path/lua5.1   LUA53_BIN=/path/lua5.3   LUAU_BIN=/path/luau
import { spawnSync } from 'node:child_process';

const CANDIDATES = {
  lua51: ['lua5.1', 'lua51'],
  lua53: ['lua5.3', 'texlua'],
  luau: ['luau', 'lune'],
};
const ENV = { lua51: 'LUA51_BIN', lua53: 'LUA53_BIN', luau: 'LUAU_BIN' };

// 실행기 하나를 찾아 { kind, bin } 을 돌려준다. 없으면 null.
export function findRunner(kind) {
  const explicit = process.env[ENV[kind]];
  const names = explicit ? [explicit] : CANDIDATES[kind];
  for (const bin of names) {
    const r = spawnSync(bin, kind === 'luau' ? ['--version'] : ['-v'], { encoding: 'utf8' });
    if (!r.error) return { kind, bin };
  }
  return null;
}

// 파일 하나를 실행해 { ok, out } 을 돌려준다. 실패해도 예외를 던지지 않는다.
export function runFile(runner, file) {
  const r = spawnSync(runner.bin, [file], { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.status !== 0) return { ok: false, out: String(r.stdout || '') + String(r.stderr || '') };
  return { ok: true, out: r.stdout };
}

export const RUNNERS = Object.fromEntries(Object.keys(CANDIDATES).map((k) => [k, findRunner(k)]));
