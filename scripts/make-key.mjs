import { randomBytes, createHash } from 'node:crypto';

const [userId, username, role = 'user'] = process.argv.slice(2);
const usage = () => {
  console.error('Usage: node scripts/make-key.mjs <user_id> [username] [owner|admin|user]');
  process.exit(1);
};
if (!userId || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) usage();
if (username !== undefined && !/^[A-Za-z0-9_.-]{2,40}$/.test(username)) usage();
if (!['owner', 'admin', 'user'].includes(role)) usage();

const key = 'tmk_' + randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(key).digest('hex');
const keyId = randomBytes(12).toString('hex');

console.error(`API key (shown once, store it safely): ${key}`);
if (username) {
  console.log(`INSERT OR IGNORE INTO api_users (id, username, role, status, created_by) VALUES ('${userId}', '${username}', '${role}', 'active', '${userId}');`);
}
console.log(`INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_by) VALUES ('${keyId}', '${userId}', '${hash}', '${key.slice(0, 12)}', '${userId}');`);
