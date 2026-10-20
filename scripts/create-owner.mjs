import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const username = process.argv[2];
if (!username || !/^[A-Za-z0-9_.-]{2,40}$/.test(username)) {
  console.error('사용법: npm run owner:create -- <사용자이름>');
  process.exit(1);
}

const userId = randomBytes(12).toString('hex');
const keyId = randomBytes(12).toString('hex');
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const randomAlnum = (length) => {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += ALNUM[b % ALNUM.length];
    }
  }
  return out;
};
const key = 'tmk_' + randomAlnum(52);
const hash = createHash('sha256').update(key).digest('hex');

const sql = [
  `INSERT OR IGNORE INTO api_users (id, username, role, status, created_by) VALUES ('${userId}', '${username}', 'owner', 'active', '${userId}');`,
  `UPDATE api_users SET role = 'owner', status = 'active' WHERE username = '${username}';`,
  `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_by) SELECT '${keyId}', id, '${hash}', '${key.slice(0, 12)}', id FROM api_users WHERE username = '${username}';`
].join('\n') + '\n';

const file = join(tmpdir(), `owner-${keyId}.sql`);
writeFileSync(file, sql);
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'tm-db', '--remote', '--file', file], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
} finally {
  unlinkSync(file);
}

console.log(`\n소유자 계정 "${username}"을(를) D1에 만들었습니다.`);
console.log(`API 키 (한 번만 표시됩니다. 안전한 곳에 보관하세요):\n${key}`);
