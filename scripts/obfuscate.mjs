import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { obfuscateDetailed } from '../src/obfuscator.js';

const USAGE = `사용법:
  node scripts/obfuscate.mjs <입력.lua> [-o <출력.lua>]   파일 하나를 난독화 (기본 출력: <입력>.obf.lua)
  node scripts/obfuscate.mjs <입력 폴더> -o <출력 폴더>   폴더 안의 .lua 전부를 난독화
  node scripts/obfuscate.mjs <입력.lua> --check            파일을 쓰지 않고 구문과 구간만 확인

옵션:
  -o, --out <경로>   출력 파일 또는 폴더
  --check            출력 없이 VM/원문 구간 수만 보고
  -h, --help         도움말`;

function parseArgs(argv) {
  const opts = { input: null, out: null, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--check') opts.check = true;
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`);
    else if (opts.input === null) opts.input = a;
    else throw new Error(`입력은 하나만 지정할 수 있습니다: ${a}`);
  }
  return opts;
}

function listLuaFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listLuaFiles(full));
    else if (extname(name) === '.lua' && !name.endsWith('.obf.lua')) out.push(full);
  }
  return out.sort();
}

function obfuscateFile(inPath, outPath, check) {
  const src = readFileSync(inPath, 'utf8');
  const { code, vm, raw } = obfuscateDetailed(src);
  const summary = `${inPath} → VM 구간 ${vm}개, 원문 구간 ${raw}개`;
  if (!check) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, code, 'utf8');
    console.log(`${summary}  (${outPath})`);
  } else {
    console.log(summary);
  }
  return { vm, raw };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }
  const input = resolve(opts.input);
  const isDir = statSync(input).isDirectory();

  if (isDir) {
    if (!opts.check && !opts.out) throw new Error('폴더 입력에는 -o <출력 폴더>가 필요합니다.');
    const files = listLuaFiles(input);
    if (files.length === 0) throw new Error('.lua 파일이 없습니다.');
    let failed = 0;
    for (const file of files) {
      const rel = file.slice(input.length + 1);
      try {
        obfuscateFile(file, opts.check ? file : join(resolve(opts.out), rel), opts.check);
      } catch (e) {
        failed++;
        console.error(`실패: ${file}: ${e.message}`);
      }
    }
    if (failed) process.exit(1);
    return;
  }

  const outPath = opts.check
    ? input
    : opts.out
      ? resolve(opts.out)
      : join(dirname(input), basename(input, '.lua') + '.obf.lua');
  obfuscateFile(input, outPath, opts.check);
}

try {
  main();
} catch (e) {
  console.error(`오류: ${e.message}`);
  process.exit(1);
}
