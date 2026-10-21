// R2 경로 규칙: scripts/<유저>/obfuscated|raw/<id>.lua
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptObjectKeys, bundleKeys } from '../src/worker.js';

const envWith = (username) => ({
  DB: { prepare: () => ({ bind() { return this; }, async first() { return username === undefined ? null : { username }; } }) },
});

test('원문은 유저 폴더의 raw, 난독화본은 obfuscated 폴더에 들어간다', async () => {
  const k = await scriptObjectKeys(envWith('jinhyuk'), 'user-1', 'abc123');
  assert.equal(k.objectKey, 'scripts/jinhyuk/obfuscated/abc123.lua');
  assert.equal(k.rawKey, 'scripts/jinhyuk/raw/abc123.lua');
});

test('수정 때는 버전 접미사를 붙인다', async () => {
  const k = await scriptObjectKeys(envWith('jinhyuk'), 'user-1', 'abc123', 'f00dfa');
  assert.equal(k.objectKey, 'scripts/jinhyuk/obfuscated/abc123-f00dfa.lua');
  assert.equal(k.rawKey, 'scripts/jinhyuk/raw/abc123-f00dfa.lua');
});

test('유저 이름이 경로에 못 쓰이면 유저 id 를 쓴다', async () => {
  const k = await scriptObjectKeys(envWith('bad/name'), 'user-9', 'x1');
  assert.equal(k.objectKey, 'scripts/user-9/obfuscated/x1.lua');
});

test('번들 조각과 엔진/로더도 같은 유저 폴더 안에 생긴다', () => {
  const b = bundleKeys('scripts/jinhyuk/obfuscated/abc123.lua');
  assert.equal(b.parts[0], 'scripts/jinhyuk/obfuscated/abc123.part1.lua');
  assert.equal(b.engine, 'scripts/jinhyuk/obfuscated/abc123.engine.lua');
  assert.equal(b.loader, 'scripts/jinhyuk/obfuscated/abc123.loader.lua');
});
