// migrations/ 를 빈 SQLite 에 순서대로 적용해 현재 스키마를 뽑고, src/schema.js 를 만든다.
// 워커는 "no such table" 오류가 나면 여기 있는 DDL로 그 테이블을 자동으로 만든다.
// 사용법: npm run schema:build
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(':memory:');
const files = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name").all();
const indexes = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all();

const schema = {};
for (const t of tables) {
  const ddl = t.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
  schema[t.name] = [ddl, ...indexes.filter((i) => i.tbl_name === t.name).map((i) => i.sql.replace(/^CREATE (UNIQUE )?INDEX\s+/i, (m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `))];
}
const body = Object.entries(schema).map(([name, stmts]) => `  ${JSON.stringify(name)}: ${JSON.stringify(stmts)},`).join('\n');
const migrationList = files.map((name) => ({ name, sql: readFileSync(join(root, "migrations", name), "utf8") }));
writeFileSync(join(root, "src", "migrations.js"), "// 자동 생성 파일 (scripts/build-schema.mjs). 직접 고치지 마세요.\nexport const MIGRATIONS = " + JSON.stringify(migrationList, null, 1) + ";\n");
writeFileSync(join(root, 'src', 'schema.js'), `// 자동 생성 파일 (scripts/build-schema.mjs). 직접 고치지 마세요.\nexport const SCHEMA = {\n${body}\n};\n`);
console.log(`tables ${tables.length}, indexes ${indexes.length} -> src/schema.js`);
