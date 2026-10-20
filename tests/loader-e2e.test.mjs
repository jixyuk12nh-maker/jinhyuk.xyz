// 로더 end-to-end: 저장된 로더(난독화됨)를 Lua 5.3 실행기에서 돌린다. HTTP 응답은 실제 서버 핸들러가 만든 값을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeEnv, startSession, getChunk } from './delivery-sim.mjs';
import { RUNNERS, runFile as runFileWith } from './runners.mjs';

const SKIP = !RUNNERS.lua53 && 'Lua 5.3 계열 실행기가 없음';
const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
const quote = (t) => {
  let o = '"';
  for (const b of Buffer.from(t, 'utf8')) o += b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : '\\' + String(b).padStart(3, '0');
  return o + '"';
};

async function build(tamperSeq = -1) {
  const env = await makeEnv();
  const s = await startSession(env);
  let lua = 'local R = {}\n';
  for (let seq = 0; seq < 6; seq++) {
    const c = await getChunk(env, s.body.token, seq);
    const chunk = seq === tamperSeq ? c.body.chunk.slice(0, -1) + 'Q' : c.body.chunk;
    lua += `R[${seq}] = { ok = true, index = ${c.body.index}, total = 6, chunk = ${quote(chunk)}, cf = ${c.body.cf} }\n`;
  }
  lua += 'return R\n';
  const resp = join(dir, `resp-${tamperSeq}.lua`);
  writeFileSync(resp, lua);
  const shim = `local R = dofile(${quote(resp)})
request = function(o)
  if o.Url:find("/api/key%-session$") then return { StatusCode = 200, Body = "S" } end
  return { StatusCode = 200, Body = "C" .. tonumber(o.Body:match('"seq":(%d+)')) }
end
local H = {
  JSONEncode = function(_, t) if t.seq then return '{"seq":' .. t.seq .. '}' end return '{}' end,
  JSONDecode = function(_, s) if s == "S" then return { ok = true, token = "t" } end return R[tonumber(s:match("^C(%d+)$"))] end,
  GetClientId = function() return "h" end,
}
game = { GetService = function() return H end }
script_key = "GOODKEY"
`;
  const file = join(dir, `loader-${tamperSeq}.lua`);
  writeFileSync(file, shim + env._bucket['scripts/s1.loader.lua']);
  return file;
}

test('저장된 로더가 조각을 받아 합치고 엔진으로 실행하면 원래 출력이 나온다 (Lua 5.3 실행기가 있을 때만)', { skip: SKIP }, async () => {
  const r = runFileWith(RUNNERS.lua53, await build());
  assert.equal(r.ok, true, r.out);
  assert.equal(r.out.trim(), '1,4,9,16,25');
});

test('전송 중 조각이 바뀌면 로더가 실행 전에 막는다 (Lua 5.3 실행기가 있을 때만)', { skip: SKIP }, async () => {
  const r = runFileWith(RUNNERS.lua53, await build(3));
  assert.equal(r.ok, false);
  assert.match(r.out, /변조가 감지됐습니다/);
});
