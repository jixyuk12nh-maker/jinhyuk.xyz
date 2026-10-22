
import { ANTI_TAMPER_SRC } from './antitamper.js';
const randInt = (min, max) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % (max - min));
};
const randHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const utf8ToLatin1 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

// Lua isspace 와 같은 공백 문자 (JS 의 \\s 는 더 넓어서 쓰지 않는다)
const LUA_SPACE = ' \t\r\n\f\v';

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
  'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
const BLOCK_END = new Set(['end', 'else', 'elseif', 'until', 'eof']);
const BINPREC = new Map([['or', 1], ['and', 2], ['<', 3], ['<=', 3], ['>', 3], ['>=', 3], ['==', 3], ['~=', 3],
  ['..', 4], ['+', 5], ['-', 5], ['*', 6], ['/', 6], ['%', 6], ['^', 8]]);
const RIGHT_ASSOC = new Set(['^', '..']);
const UNARY_PREC = 7;
// 5.1/5.2 전용: 숫자 상수 접기와 값 기준 상수 표. 정수 부분형이 없는 방언에서만 참이다 (5.3/Luau 는 끈다).
let CLASSIC_NUM = true;
// 런타임의 BIN / UN 표와 번호가 맞아야 한다.
const BIN_ID = new Map([['+', 1], ['-', 2], ['*', 3], ['/', 4], ['..', 5], ['==', 6], ['~=', 7],
  ['<', 8], ['<=', 9], ['>', 10], ['>=', 11], ['%', 12], ['^', 13]]);
const UN_ID = new Map([['-', 1], ['not', 2], ['#', 3]]);

const DIALECTS = {
  '5.1': { name: '5.1', goto: false, bitops: false, luau: false, esc: false, zesc: false, uesc: false, hexf: false },
  '5.2': { name: '5.2', goto: true, bitops: false, luau: false, esc: true, zesc: true, uesc: false, hexf: true },
  '5.3': { name: '5.3', goto: true, bitops: true, luau: false, esc: true, zesc: true, uesc: true, hexf: true },
  '5.4': { name: '5.4', goto: true, bitops: true, luau: false, esc: true, zesc: true, uesc: true, hexf: true, attribs: true },
  luau: { name: 'luau', goto: false, bitops: false, luau: true, esc: true, zesc: false, uesc: true, hexf: false },
  // 어느 한 방언으로도 통과하지 못했을 때만 쓰인다 (auto의 마지막 단계).
  mixed: { name: 'mixed', goto: true, bitops: true, luau: true, esc: true, zesc: false, uesc: true, hexf: true, attribs: true },
};
const KW_GOTO = new Set([...KEYWORDS, 'goto']);
const KW_LUAU = new Set([...KEYWORDS, 'continue']);
const KW_MIXED = new Set([...KEYWORDS, 'goto', 'continue']);
const BINPREC53 = new Map([['or', 1], ['and', 2], ['<', 3], ['<=', 3], ['>', 3], ['>=', 3], ['==', 3], ['~=', 3],
  ['|', 4], ['~', 5], ['&', 6], ['<<', 7], ['>>', 7], ['..', 8], ['+', 9], ['-', 9],
  ['*', 10], ['/', 10], ['//', 10], ['%', 10], ['^', 13]]);
const UNARY_PREC53 = 11;
const BIN_ID53 = new Map([['//', 14], ['&', 15], ['|', 16], ['~', 17], ['<<', 18], ['>>', 19]]);
const UN_ID53 = new Map([['~', 4]]);
const COMPOUND = new Map([['+=', '+'], ['-=', '-'], ['*=', '*'], ['/=', '/'], ['%=', '%'], ['^=', '^'], ['..=', '..']]);
function utf8Bytes(cp) {
  if (cp < 0x80) return String.fromCharCode(cp);
  const bytes = [];
  let limit = 0x3f;
  let rest = cp;
  while (rest > limit) {
    bytes.unshift(0x80 | (rest & 0x3f));
    rest = Math.floor(rest / 64);
    limit >>= 1;
  }
  bytes.unshift(((~limit << 1) & 0xff) | rest);
  return String.fromCharCode(...bytes);
}

function longBracket(src, i) {
  if (src[i] !== '[') return null;
  let j = i + 1;
  let lvl = 0;
  while (src[j] === '=') { lvl++; j++; }
  return src[j] === '[' ? { lvl, start: j + 1 } : null;
}

function readLong(src, start, lvl) {
  const close = ']' + '='.repeat(lvl) + ']';
  const end = src.indexOf(close, start);
  if (end < 0) throw new Error('unfinished long string or comment');
  let content = src.slice(start, end);
  const first = /^(\r\n|\n\r|\r|\n)/.exec(content);
  if (first) content = content.slice(first[0].length);
  content = content.replace(/\r\n|\n\r|\r/g, '\n');
  return { content, next: end + close.length };
}

function readEscape(src, j, dl) {
  const c = src[j + 1];
  if (c === undefined) throw new Error('unfinished string');
  const simple = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  if (Object.prototype.hasOwnProperty.call(simple, c)) return { ch: simple[c], next: j + 2 };
  if (dl.esc && c === 'x') {
    const h = src.slice(j + 2, j + 4);
    if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new Error('hexadecimal digit expected');
    return { ch: String.fromCharCode(parseInt(h, 16)), next: j + 4 };
  }
  if (dl.zesc && c === 'z') {
    let k = j + 2;
    while (k < src.length && LUA_SPACE.includes(src[k])) k++;
    return { ch: '', next: k };
  }
  if (dl.uesc && c === 'u') {
    const m = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(j + 2, j + 2 + 12));
    if (!m) throw new Error("missing '{' in \\u{xxxx}");
    const cp = parseInt(m[1], 16);
    if (cp >= 0x80000000) throw new Error('UTF-8 value too large');
    return { ch: utf8Bytes(cp), next: j + 2 + m[0].length };
  }
  if (c === '\n' || c === '\r') {
    const other = c === '\n' ? '\r' : '\n';
    return { ch: '\n', next: src[j + 2] === other ? j + 3 : j + 2 };
  }
  if (c >= '0' && c <= '9') {
    let k = j + 1;
    let digits = '';
    while (k < src.length && digits.length < 3 && src[k] >= '0' && src[k] <= '9') digits += src[k++];
    const code = Number(digits);
    if (code > 255) throw new Error('escape sequence too large');
    return { ch: String.fromCharCode(code), next: k };
  }
  return { ch: c, next: j + 2 };
}

// 5.1 숫자: 10진 실수와 16진 정수만. 16진 실수(0x1p4)는 C strtod 확장이라 Luau와 맞추기 위해 거부한다.
const isLuaNumeral = (t) => /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t) || /^0[xX][0-9a-fA-F]+$/.test(t);

function hexFloatValue(text) {
  const m = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/.exec(text);
  let v = 0;
  for (const c of m[1]) v = v * 16 + parseInt(c, 16);
  let scale = 1 / 16;
  for (const c of (m[2] || '')) { v += parseInt(c, 16) * scale; scale /= 16; }
  return v * 2 ** (m[3] ? Number(m[3]) : 0);
}

const isNumeral53 = (t) => /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)
  || /^0[xX]([0-9a-fA-F]+(\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+)([pP][+-]?\d+)?$/.test(t);

function tokenize(src, dl = DIALECTS['5.1']) {
  const kwSet = dl.goto && dl.luau ? KW_MIXED : dl.goto ? KW_GOTO : (dl.luau ? KW_LUAU : KEYWORDS);
  const twoOps = ['==', '~=', '<=', '>=', '..'];
  if (dl.bitops) twoOps.push('//', '<<', '>>');
  if (dl.goto) twoOps.push('::');
  if (dl.luau) twoOps.push('->', '+=', '-=', '*=', '/=', '%=', '^=', '::');
  const toks = [];
  const n = src.length;
  let i = 0;
  let lineNo = 1;
  let linePos = 0;
  const lineAt = (pos) => {
    while (linePos < pos) { if (src[linePos] === '\n') lineNo++; linePos++; }
    return lineNo;
  };
  const push = (tok, s, e) => { tok.s = s; tok.e = e; tok.line = lineAt(s); toks.push(tok); };

  while (i < n) {
    const c = src[i];
    if (LUA_SPACE.includes(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      const lb = longBracket(src, i + 2);
      if (lb) { i = readLong(src, lb.start, lb.lvl).next; continue; }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      if (dl.luau) {
        let j = i;
        if (/^0[bB]/.test(src.slice(i, i + 2))) { j = i + 2; while (j < n && /[01_]/.test(src[j])) j++; }
        else if (/^0[xX]/.test(src.slice(i, i + 2))) { j = i + 2; while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++; }
        else {
          while (j < n && /[0-9_.]/.test(src[j])) j++;
          if (src[j] === 'e' || src[j] === 'E') {
            j++;
            if (src[j] === '+' || src[j] === '-') j++;
            while (j < n && /[0-9_]/.test(src[j])) j++;
          }
        }
        const raw = src.slice(i, j);
        const clean = raw.replace(/_/g, '');
        let text;
        if (/^0[bB][01]+$/.test(clean)) text = String(parseInt(clean.slice(2), 2));
        else if (/^0[xX][0-9a-fA-F]+$/.test(clean) || /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(clean)) text = clean;
        else throw new Error(`line ${lineNo}: malformed number near '${raw}'`);
        push({ t: 'num', v: { num: text } }, i, j);
        i = j;
        continue;
      }
      let j = i + 1;
      const isHex = /^0[xX]/.test(src.slice(i, i + 2));
      if (dl.hexf || isHex) {
        const expo = isHex ? 'pP' : 'eE';
        while (j < n) {
          if (expo.includes(src[j]) && (src[j + 1] === '+' || src[j + 1] === '-')) { j += 2; continue; }
          if (/[0-9A-Za-z_.]/.test(src[j])) { j++; continue; }
          break;
        }
      } else {
        while (j < n && /[0-9.]/.test(src[j])) j++;
        if (src[j] === 'e' || src[j] === 'E') { j++; if (src[j] === '+' || src[j] === '-') j++; }
        while (j < n && /[0-9A-Za-z_]/.test(src[j])) j++;
      }
      const text = src.slice(i, j);
      if (!((dl.hexf || isHex) ? isNumeral53(text) : isLuaNumeral(text))) throw new Error(`line ${lineNo}: malformed number near '${text}'`);
      const isHexFloat = /^0[xX]/.test(text) && /[.pP]/.test(text);
      push({ t: 'num', v: { num: isHexFloat ? String(hexFloatValue(text)) : text } }, i, j);
      i = j;
      continue;
    }
    if (c === '[') {
      const lb = longBracket(src, i);
      if (lb) {
        const r = readLong(src, lb.start, lb.lvl);
        push({ t: 'str', v: r.content }, i, r.next);
        i = r.next;
        continue;
      }
    }
    if (c === '`' && dl.luau) {
      const parts = [];
      let buf = '';
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error(`line ${lineNo}: unfinished string`);
        const ch = src[j];
        if (ch === '`') { j++; break; }
        if (ch === '\\') { const r = readEscape(src, j, dl); buf += r.ch; j = r.next; continue; }
        if (ch === '{') {
          let d = 1;
          let k = j + 1;
          while (k < n && d > 0) {
            if (src[k] === '{') d++;
            else if (src[k] === '}') d--;
            k++;
          }
          if (d > 0) throw new Error(`line ${lineNo}: unfinished string`);
          parts.push({ s: buf }, { src: src.slice(j + 1, k - 1) });
          buf = '';
          j = k;
          continue;
        }
        buf += ch;
        j++;
      }
      parts.push({ s: buf });
      push({ t: 'istr', v: parts }, i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== c) {
        const ch = src[j];
        if (ch === '\n' || ch === '\r') throw new Error('unfinished string');
        if (ch === '\\') { const r = readEscape(src, j, dl); s += r.ch; j = r.next; } else { s += ch; j++; }
      }
      if (j >= n) throw new Error('unfinished string');
      push({ t: 'str', v: s }, i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      push(kwSet.has(w) ? { t: w } : { t: 'name', v: w }, i, j);
      i = j;
      continue;
    }
    if (src.slice(i, i + 3) === '...') { push({ t: '...' }, i, i + 3); i += 3; continue; }
    if (dl.luau && src.slice(i, i + 3) === '..=') { push({ t: '..=' }, i, i + 3); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (twoOps.includes(two)) { push({ t: two }, i, i + 2); i += 2; continue; }
    if (c.charCodeAt(0) >= 0x80) throw new Error(`line ${lineAt(i)}: 허용되지 않은 문자 (\\x${c.charCodeAt(0).toString(16)}): 식별자는 ASCII 문자만 쓸 수 있습니다`);
    push({ t: c }, i, i + 1);
    i++;
  }
  push({ t: 'eof' }, n, n);
  return toks;
}

// continue(Luau)와 goto 라벨에 쓰는 내부 이름. 사용자 식별자로는 나올 수 없는 문자를 쓴다.
const CONT = '\0continue';

const STAT_KW = new Set(['local', 'function', 'if', 'for', 'while', 'do', 'repeat', 'return', 'break', 'goto']);
// 블록/괄호 깊이 스택을 토큰 하나만큼 갱신한다. 짝이 맞지 않으면 false.
function blockStep(stack, t) {
  if (t === 'function' || t === 'if' || t === 'repeat') stack.push(t);
  else if (t === 'while' || t === 'for') stack.push('loop');
  else if (t === 'do') { if (stack[stack.length - 1] === 'loop') stack[stack.length - 1] = 'do'; else stack.push('do'); }
  else if (t === 'end' || t === 'until') { if (!stack.length) return false; stack.pop(); }
  else if (t === '(' || t === '[' || t === '{') stack.push('(');
  else if (t === ')' || t === ']' || t === '}') { if (!stack.length) return false; stack.pop(); }
  return true;
}
// 원문 구간을 로더에서 따로 실행해도 되는지 검사한다. 문제가 있으면 사유를 돌려준다.
function rawSegmentIssue(toks, from, to, declared) {
  const stack = [];
  let hasFunction = false;
  for (let q = from; q < to; q++) if (toks[q].t === 'function') hasFunction = true;
  for (let q = from; q < to; q++) {
    const t = toks[q].t;
    const top = stack.length === 0;
    if (t === 'local' && top) return '최상위 local 선언';
    if (t === 'return' && top) return '최상위 return';
    if (t === '...' && top && !hasFunction) return '최상위 ...';
    if (t === 'name' && declared.has(toks[q].v) && !(q > from && (toks[q - 1].t === '.' || toks[q - 1].t === ':'))) {
      return `지역 변수 '${toks[q].v}' 사용`;
    }
    if (!blockStep(stack, t)) return '블록 짝이 맞지 않음';
  }
  return null;
}

function parse(src, dl = DIALECTS['5.1'], segmented = false) {
  const toks = tokenize(src, dl);
  let p = 0;
  const varargs = [true];
  const cur = () => toks[p];
  const adv = () => toks[p++];
  const tokText = (tk) => (tk.t === 'eof' ? '<eof>'
    : tk.t === 'name' || tk.t === 'str' ? String(tk.v)
      : tk.t === 'num' ? tk.v.num : tk.t);
  const fail = (msg) => {
    const tk = cur();
    throw new Error(`line ${tk.line}: ${msg} near '${tokText(tk)}'`);
  };
  const expect = (t) => { if (cur().t !== t) fail(`'${t}' expected`); return adv(); };
  const expectName = () => { if (cur().t !== 'name') fail('<name> expected'); return adv().v; };

  function parseExprList() {
    const list = [parseExpr(0)];
    while (cur().t === ',') { adv(); list.push(parseExpr(0)); }
    return list;
  }

  function parseExpr(limit) {
    let left;
    const t = cur().t;
    if (t === 'not' || t === '-' || t === '#' || (dl.bitops && t === '~')) {
      adv();
      left = { k: 'un', op: t, e: parseExpr(dl.bitops ? UNARY_PREC53 : UNARY_PREC) };
    } else {
      left = parseSimple();
    }
    while (dl.luau && cur().t === '::') { adv(); skipType(); }
    const PREC = dl.bitops ? BINPREC53 : BINPREC;
    for (;;) {
      const op = cur().t;
      const pr = PREC.get(op);
      if (pr === undefined || pr <= limit) break;
      adv();
      const right = parseExpr(RIGHT_ASSOC.has(op) ? pr - 1 : pr);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }

  function parseSimple() {
    const tk = cur();
    switch (tk.t) {
      case 'num': adv(); return { k: 'num', text: tk.v.num };
      case 'str': adv(); return { k: 'str', v: tk.v };
      case 'istr': adv(); return interpExpr(tk.v);
      case 'nil': case 'true': case 'false': adv(); return { k: tk.t };
      case '...':
        if (!varargs[varargs.length - 1]) fail("cannot use '...' outside a vararg function");
        adv();
        return { k: 'vararg' };
      case '{': return parseTable();
      case 'function': adv(); return parseFuncBody(false);
      case 'if': if (dl.luau) return parseIfExpr(); return parseSuffixed();
      default: return parseSuffixed();
    }
  }

  function interpExpr(parts) {
    let node = null;
    const add = (e) => { node = node ? { k: 'bin', op: '..', a: node, b: e } : e; };
    for (const part of parts) {
      if (part.src !== undefined) {
        const sub = parse(`return (${part.src})`, dl).body[0].exps[0];
        add({ k: 'call', fn: { k: 'gname', name: 'tostring' }, args: [sub] });
      } else if (part.s !== '' || node === null) {
        add({ k: 'str', v: part.s });
      }
    }
    return node;
  }

  function parseFuncBody(isMethod) {
    skipGenerics();
    expect('(');
    const params = isMethod ? ['self'] : [];
    let isVararg = false;
    if (cur().t !== ')') {
      for (;;) {
        if (cur().t === '...') { adv(); isVararg = true; skipAnnot(); break; }
        params.push(expectName());
        skipAnnot();
        if (cur().t !== ',') break;
        adv();
      }
    }
    expect(')');
    skipAnnot();
    varargs.push(isVararg);
    const body = parseBlock();
    varargs.pop();
    expect('end');
    return { k: 'func', params, isVararg, body };
  }

  function parseTable() {
    expect('{');
    const items = [];
    while (cur().t !== '}') {
      if (cur().t === '[') {
        adv();
        const key = parseExpr(0);
        expect(']');
        expect('=');
        items.push({ type: 'kv', key, e: parseExpr(0) });
      } else if (cur().t === 'name' && toks[p + 1].t === '=') {
        const key = { k: 'str', v: adv().v };
        adv();
        items.push({ type: 'kv', key, e: parseExpr(0) });
      } else {
        items.push({ type: 'pos', e: parseExpr(0) });
      }
      if (cur().t === ',' || cur().t === ';') adv(); else break;
    }
    expect('}');
    return { k: 'table', items };
  }

  function parseArgs() {
    const tk = cur();
    if (tk.t === 'str') { adv(); return [{ k: 'str', v: tk.v }]; }
    if (tk.t === '{') return [parseTable()];
    expect('(');
    const args = [];
    if (cur().t !== ')') {
      args.push(parseExpr(0));
      while (cur().t === ',') { adv(); args.push(parseExpr(0)); }
    }
    expect(')');
    return args;
  }

  function parsePrimary() {
    const tk = cur();
    if (tk.t === 'name') { adv(); return { k: 'name', name: tk.v }; }
    if (tk.t === '(') { adv(); const e = parseExpr(0); expect(')'); return { k: 'paren', e }; }
    return fail('unexpected symbol');
  }

  function parseSuffixed() {
    let e = parsePrimary();
    for (;;) {
      const t = cur().t;
      if (t === '.') {
        adv();
        e = { k: 'index', obj: e, key: { k: 'str', v: expectName() } };
      } else if (t === '[') {
        adv();
        const key = parseExpr(0);
        expect(']');
        e = { k: 'index', obj: e, key };
      } else if (t === ':') {
        adv();
        const name = expectName();
        e = { k: 'method', obj: e, name, args: parseArgs() };
      } else if (dl.luau && t === '<' && toks[p + 1].t === '<') {
        skipBalanced('<', '>');
      } else if (t === '(' || t === 'str' || t === '{') {
        e = { k: 'call', fn: e, args: parseArgs() };
      } else {
        return e;
      }
    }
  }

  function parseBlock() {
    const stats = [];
    while (!BLOCK_END.has(cur().t)) {
      if (cur().t === 'return' || cur().t === 'break') {
        const kw = cur().t;
        if (kw === 'break') { adv(); stats.push({ k: 'break' }); } else stats.push(parseReturn());
        if (cur().t === ';') adv();
        if (!BLOCK_END.has(cur().t)) fail(`'${kw}' must be the last statement in a block`);
        break;
      }
      stats.push(parseStatement());
      if (cur().t === ';') adv();
    }
    return stats;
  }

  function parseReturn() {
    adv();
    let exps = [];
    if (!BLOCK_END.has(cur().t) && cur().t !== ';') exps = parseExprList();
    return { k: 'return', exps };
  }

  function parseIf() {
    adv();
    const clauses = [];
    const cond = parseExpr(0);
    expect('then');
    clauses.push({ cond, body: parseBlock() });
    let orelse = null;
    for (;;) {
      if (cur().t === 'elseif') {
        adv();
        const c = parseExpr(0);
        expect('then');
        clauses.push({ cond: c, body: parseBlock() });
      } else if (cur().t === 'else') {
        adv();
        orelse = parseBlock();
        expect('end');
        break;
      } else {
        expect('end');
        break;
      }
    }
    return { k: 'if', clauses, orelse };
  }

  function parseFor() {
    adv();
    const first = expectName();
    skipAnnot();
    if (cur().t === '=') {
      adv();
      const start = parseExpr(0);
      expect(',');
      const limit = parseExpr(0);
      let step = null;
      if (cur().t === ',') { adv(); step = parseExpr(0); }
      expect('do');
      const body = parseBlock();
      expect('end');
      return { k: 'fornum', name: first, start, limit, step, body };
    }
    const names = [first];
    while (cur().t === ',') { adv(); names.push(expectName()); skipAnnot(); }
    expect('in');
    const exps = parseExprList();
    expect('do');
    const body = parseBlock();
    expect('end');
    return { k: 'forin', names, exps, body };
  }

  function parseExprStat() {
    const e = parseSuffixed();
    if (dl.luau && COMPOUND.has(cur().t)) {
      const op = COMPOUND.get(adv().t);
      if (e.k !== 'name' && e.k !== 'index') fail('syntax error');
      return compoundAssign(e, op, parseExpr(0));
    }
    if (cur().t === '=' || cur().t === ',') {
      const targets = [e];
      while (cur().t === ',') { adv(); targets.push(parseSuffixed()); }
      expect('=');
      for (const t of targets) if (t.k !== 'name' && t.k !== 'index') fail('syntax error');
      return { k: 'assign', targets, exps: parseExprList() };
    }
    if (e.k !== 'call' && e.k !== 'method') fail('syntax error');
    return { k: 'callstat', e };
  }

  function compoundAssign(target, op, rhs) {
    if (target.k === 'name') return { k: 'assign', targets: [target], exps: [{ k: 'bin', op, a: target, b: rhs }] };
    const o = { k: 'name', name: '\0o' };
    const kk = { k: 'name', name: '\0k' };
    return { k: 'do', body: [
      { k: 'local', names: ['\0o', '\0k'], exps: [target.obj, target.key] },
      { k: 'assign', targets: [{ k: 'index', obj: o, key: kk }],
        exps: [{ k: 'bin', op, a: { k: 'index', obj: o, key: kk }, b: rhs }] },
    ] };
  }

  function parseIfExpr() {
    adv();
    const clauses = [];
    const cond = parseExpr(0);
    expect('then');
    clauses.push({ cond, e: parseExpr(0) });
    for (;;) {
      if (cur().t === 'elseif') {
        adv();
        const c = parseExpr(0);
        expect('then');
        clauses.push({ cond: c, e: parseExpr(0) });
      } else {
        expect('else');
        return { k: 'ifexpr', clauses, orelse: parseExpr(0) };
      }
    }
  }

  function skipBalanced(open, close) {
    let d = 0;
    do {
      const t = cur().t;
      if (t === 'eof') fail("'" + close + "' expected");
      if (t === open) d++; else if (t === close) d--;
      adv();
    } while (d > 0);
  }
  function skipSimpleType() {
    const tk = cur();
    if (dl.luau && tk.t === '<') { skipBalanced('<', '>'); skipSimpleType(); return; }
    if (tk.t === '(') {
      skipBalanced('(', ')');
      if (cur().t === '->') { adv(); skipType(); }
    } else if (tk.t === '{') {
      skipBalanced('{', '}');
    } else if (tk.t === 'str' || tk.t === 'nil' || tk.t === 'true' || tk.t === 'false') {
      adv();
    } else if (tk.t === 'name') {
      if (tk.v === 'typeof' && toks[p + 1].t === '(') { adv(); skipBalanced('(', ')'); return; }
      adv();
      while (cur().t === '.') { adv(); expectName(); }
      if (cur().t === '<') skipBalanced('<', '>');
    } else {
      fail('type expected');
    }
  }
  function skipType() {
    if (dl.luau && (cur().t === '|' || cur().t === '&')) adv();
    skipSimpleType();
    for (;;) {
      const t = cur().t;
      if (t === '?') { adv(); continue; }
      if (t === '|' || t === '&') { adv(); skipSimpleType(); continue; }
      if (t === '...') { adv(); continue; }
      return;
    }
  }
  function skipAnnot() {
    if (dl.luau && cur().t === ':') { adv(); skipType(); }
  }
  function skipGenerics() {
    if (dl.luau && cur().t === '<') skipBalanced('<', '>');
  }

  function parseStatement() {
    while (dl.luau && cur().t === '@') { adv(); if (cur().t === '[') skipBalanced('[', ']'); else expectName(); }
    const first = cur();
    if (first.t === 'goto' && dl.goto) { adv(); return { k: 'goto', name: expectName() }; }
    if (first.t === '::' && dl.goto) {
      adv();
      const name = expectName();
      expect('::');
      return { k: 'label', name };
    }
    if (first.t === 'continue' && dl.luau) { adv(); return { k: 'goto', name: CONT }; }
    if (dl.luau && cur().t === 'name' && cur().v === 'export' && toks[p + 1].t === 'name' && toks[p + 1].v === 'type') adv();
    if (dl.luau && cur().t === 'name' && cur().v === 'type' && toks[p + 1].t === 'name') {
      adv(); adv();
      skipGenerics();
      expect('=');
      skipType();
      return { k: 'do', body: [] };
    }
    switch (cur().t) {
      case 'if': return parseIf();
      case 'while': {
        adv();
        const cond = parseExpr(0);
        expect('do');
        const body = parseBlock();
        expect('end');
        return { k: 'while', cond, body };
      }
      case 'do': {
        adv();
        const body = parseBlock();
        expect('end');
        return { k: 'do', body };
      }
      case 'for': return parseFor();
      case 'repeat': {
        adv();
        const body = parseBlock();
        expect('until');
        return { k: 'repeat', body, cond: parseExpr(0) };
      }
      case 'function': {
        adv();
        let target = { k: 'name', name: expectName() };
        while (cur().t === '.') {
          adv();
          target = { k: 'index', obj: target, key: { k: 'str', v: expectName() } };
        }
        let isMethod = false;
        if (cur().t === ':') {
          adv();
          target = { k: 'index', obj: target, key: { k: 'str', v: expectName() } };
          isMethod = true;
        }
        return { k: 'assign', targets: [target], exps: [parseFuncBody(isMethod)] };
      }
      case 'local': {
        adv();
        if (cur().t === 'function') {
          adv();
          const name = expectName();
          return { k: 'localfunc', name, func: parseFuncBody(false) };
        }
        const names = [];
        const attribs = [];
        const one = () => {
          names.push(expectName());
          skipAnnot();
          let at = null;
          if (dl.attribs && cur().t === '<') {
            adv();
            at = expectName();
            if (at !== 'const' && at !== 'close') throw new Error(`line ${cur().line}: unknown attribute '${at}'`);
            // '>=' 토큰이면 '>' 뒤의 '=' 를 따로 떼어 대입으로 쓴다 (local x <const>= 1)
            if (cur().t === '>=') cur().t = '='; else expect('>');
          }
          attribs.push(at);
        };
        one();
        while (cur().t === ',') { adv(); one(); }
        if (attribs.filter((x) => x === 'close').length > 1) fail('multiple to-be-closed variables in local list');
        let exps = [];
        if (cur().t === '=') { adv(); exps = parseExprList(); }
        return { k: 'local', names, exps, attribs };
      }
      default:
        return parseExprStat();
    }
  }

  if (segmented) return parseSegments();
  const body = parseBlock();
  if (cur().t !== 'eof') fail("'<eof>' expected");
  return { k: 'func', params: [], isVararg: true, body };

  // 최상위 문장을 하나씩 파싱한다. 실패한 문장은 다음 최상위 문장 시작까지 원문 구간({k:'raw'})으로 둔다.
  function parseSegments() {
    const body = [];
    while (cur().t !== 'eof') {
      if (cur().t === 'return' || cur().t === 'break') {
        const kw = cur().t;
        if (kw === 'break') { adv(); body.push({ k: 'break' }); } else body.push(parseReturn());
        if (cur().t === ';') adv();
        if (cur().t !== 'eof') fail(`'${kw}' must be the last statement in a block`);
        break;
      }
      const start = p;
      const vlen = varargs.length;
      try {
        body.push(parseStatement());
        if (cur().t === ';') adv();
      } catch (err) {
        const end = rawEnd(start);
        if (end < 0) throw err;
        varargs.length = vlen;
        body.push({ k: 'raw', from: start, to: end, msg: err.message });
        p = end;
      }
    }
    return { k: 'func', params: [], isVararg: true, body };
  }

  // start 이후에서 블록 깊이가 0인 곳에 오는 다음 최상위 문장 시작 토큰 위치 (없으면 -1)
  function rawEnd(start) {
    const stack = [];
    for (let q = start; toks[q].t !== 'eof'; q++) {
      if (q > start && stack.length === 0 && statementStartAt(q)) return q;
      if (!blockStep(stack, toks[q].t)) return -1;
    }
    return -1;
  }

  function statementStartAt(q) {
    const t = toks[q].t;
    if (t === 'return' || t === 'break') return true;
    if (!(t === 'name' || STAT_KW.has(t) || t === '::' || t === '(')) return false;
    const savedP = p;
    const savedV = varargs.length;
    p = q;
    try {
      parseStatement();
      return true;
    } catch {
      return false;
    } finally {
      p = savedP;
      varargs.length = savedV;
    }
  }
}

// 숫자 식을 컴파일 시점에 계산한다. 0으로 나누기, NaN 결과는 접지 않는다 (Lua 5.1 constfolding 과 같음).
function foldNum(e) {
  if (!CLASSIC_NUM) return null;
  switch (e.k) {
    case 'num': return Number(e.text);
    case 'paren': return foldNum(e.e);
    case 'un': {
      if (e.op !== '-') return null;
      const v = foldNum(e.e);
      return v === null ? null : -v;
    }
    case 'bin': {
      if (!['+', '-', '*', '/', '%', '^'].includes(e.op)) return null;
      const a = foldNum(e.a);
      const b = foldNum(e.b);
      if (a === null || b === null) return null;
      let r;
      switch (e.op) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/': if (b === 0) return null; r = a / b; break;
        case '%': if (b === 0) return null; r = a - Math.floor(a / b) * b; break;
        default: r = a ** b;
      }
      if (Number.isNaN(r)) return null;
      return r;
    }
    default: return null;
  }
}
// 접은 값을 상수 표현으로 바꾼다 (Lua 표준 표기로 되돌릴 수 있게: -0, 무한대는 지수 표기)
function numText(v) {
  if (Object.is(v, -0)) return '-0';
  if (v === Infinity) return '1e309';
  if (v === -Infinity) return '-1e309';
  return String(v);
}

const isMulti = (e) => e.k === 'call' || e.k === 'method' || e.k === 'vararg';

const keyOf = (v) => {
  if (v === null) return 'nil';
  if (typeof v === 'object') return CLASSIC_NUM ? 'n:' + String(Number(v.num)) : 'n:' + v.num; // 5.1/5.2: String(-0) === '0' 이라 같은 값은 같은 상수
  return typeof v + ':' + String(v);
};

function emit(fs, op, a = 0, b = 0) {
  fs.code.push({ op, a, b });
  return fs.code.length - 1;
}
const here = (fs) => fs.code.length;
const patch = (fs, idx, target = here(fs)) => { fs.code[idx].a = target; };

function constIndex(fs, v) {
  const key = keyOf(v);
  let i = fs.constIdx.get(key);
  if (i === undefined) {
    fs.consts.push(v);
    i = fs.consts.length;
    fs.constIdx.set(key, i);
  }
  return i;
}
const emitK = (fs, v) => emit(fs, 'PUSHK', constIndex(fs, v));

const pushLoop = (fs) => { const l = []; l.depth = fs.scopes.length; fs.loops.push(l); };
function emitCloseFrom(fs, minIdx) {
  for (let i = fs.scopes.length - 1; i >= minIdx; i--) {
    const t = fs.scopes[i].tbc;
    if (t) for (let j = t.length - 1; j >= 0; j--) emit(fs, 'CLOSELOC', t[j].slot);
  }
}
function emitGotoClose(fs, e) {
  if (e.depth === undefined) return;
  const lb = e.depth - 1;
  emitCloseFrom(fs, lb + 1);
  const t = fs.scopes[lb] && fs.scopes[lb].tbc;
  if (e.pos >= 0 && t) for (let j = t.length - 1; j >= 0; j--) if (t[j].pos >= e.pos) emit(fs, 'CLOSELOC', t[j].slot);
}
function isConstName(fs, name) {
  for (let f = fs; f; f = f.parent) {
    for (let i = f.scopes.length - 1; i >= 0; i--) {
      if (f.scopes[i].has(name)) return !!(f.scopes[i].constNames && f.scopes[i].constNames.has(name));
    }
  }
  return false;
}
const openScope = (fs) => { const m = new Map(); m.base = fs.nact; fs.scopes.push(m); };
const closeScope = (fs) => { const m = fs.scopes.pop(); fs.nact = m.base; fs.lnames.length = m.base; };
const newSlots = (fs, n) => { const s = fs.nslots + 1; fs.nslots += n; return s; };
function declareLocal(fs, name) {
  const slot = newSlots(fs, 1);
  const top = fs.scopes[fs.scopes.length - 1];
  top.set(name, slot);
  if (top.constNames) top.constNames.delete(name);
  fs.nact++;
  fs.lnames.push(name);
  return slot;
}

let ENV_SPECIAL = false;
function envIsLocal(fs) { return ENV_SPECIAL && resolve(fs, '_ENV').kind !== 'global'; }
function globalGet(fs, name) {
  if (name === '_ENV' && ENV_SPECIAL) { emit(fs, 'GETG', constIndex(fs, '_G')); return; }
  if (envIsLocal(fs)) { cget(fs, '_ENV'); emitK(fs, name); emit(fs, 'INDEX'); return; }
  emit(fs, 'GETG', constIndex(fs, name));
}
function globalSet(fs, name) {
  if (name === '_ENV' && ENV_SPECIAL) throw new Error("assignment to global '_ENV' is not supported");
  if (envIsLocal(fs)) {
    const tmp = newSlots(fs, 1);
    emit(fs, 'NEWLOC', tmp);
    cget(fs, '_ENV'); emitK(fs, name); emit(fs, 'GETLOC', tmp); emit(fs, 'SETINDEX');
    return;
  }
  emit(fs, 'SETG', constIndex(fs, name));
}

function resolve(fs, name) {
  for (let i = fs.scopes.length - 1; i >= 0; i--) {
    const slot = fs.scopes[i].get(name);
    if (slot !== undefined) return { kind: 'local', slot };
  }
  const cached = fs.upvalMap.get(name);
  if (cached !== undefined) return { kind: 'up', idx: cached };
  if (!fs.parent) return { kind: 'global' };
  const r = resolve(fs.parent, name);
  if (r.kind === 'global') return r;
  fs.upvals.push(r.kind === 'local' ? { fromParent: 1, index: r.slot } : { fromParent: 0, index: r.idx });
  const idx = fs.upvals.length;
  fs.upvalMap.set(name, idx);
  return { kind: 'up', idx };
}

function cget(fs, name) {
  const r = resolve(fs, name);
  if (r.kind === 'local') emit(fs, 'GETLOC', r.slot);
  else if (r.kind === 'up') emit(fs, 'GETUP', r.idx);
  else globalGet(fs, name);
}

function cset(fs, name) {
  if (isConstName(fs, name)) throw new Error(`attempt to assign to const variable '${name}'`);
  const r = resolve(fs, name);
  if (r.kind === 'local') emit(fs, 'SETLOC', r.slot);
  else if (r.kind === 'up') emit(fs, 'SETUP', r.idx);
  else globalSet(fs, name);
}

function cexpr(fs, e) {
  switch (e.k) {
    case 'nil': emitK(fs, null); return;
    case 'true': emitK(fs, true); return;
    case 'false': emitK(fs, false); return;
    case 'num': emitK(fs, { num: e.text }); return;
    case 'str': emitK(fs, e.v); return;
    case 'vararg': emit(fs, 'VARARG'); return;
    case 'func': emit(fs, 'CLOSURE', buildProto(fs, e, fs.protos)); return;
    case 'table': ctable(fs, e); return;
    case 'name': cget(fs, e.name); return;
    case 'gname': emit(fs, 'GETG', constIndex(fs, e.name)); return;
    case 'index':
      cexpr(fs, e.obj);
      cexpr(fs, e.key);
      emit(fs, 'INDEX');
      return;
    case 'call': case 'method':
      ccallPack(fs, e);
      emit(fs, 'FIRST');
      return;
    case 'paren': cexpr(fs, e.e); return;
    case 'un': {
      const f = e.op === '-' ? foldNum(e) : null;
      if (f !== null) { emitK(fs, { num: numText(f) }); return; }
      cexpr(fs, e.e);
      emit(fs, 'UN', UN_ID.get(e.op) ?? UN_ID53.get(e.op));
      return;
    }
    case 'bin':
      if (e.op === 'and' || e.op === 'or') {
        cexpr(fs, e.a);
        emit(fs, 'DUP');
        const j = emit(fs, e.op === 'and' ? 'JMPF' : 'JMPT');
        emit(fs, 'POP');
        cexpr(fs, e.b);
        patch(fs, j);
        return;
      }
      {
        const f = foldNum(e);
        if (f !== null) { emitK(fs, { num: numText(f) }); return; }
      }
      cexpr(fs, e.a);
      cexpr(fs, e.b);
      emit(fs, 'BIN', BIN_ID.get(e.op) ?? BIN_ID53.get(e.op));
      return;
    case 'ifexpr': {
      const ends = [];
      for (const c of e.clauses) {
        cexpr(fs, c.cond);
        const jf = emit(fs, 'JMPF');
        cexpr(fs, c.e);
        ends.push(emit(fs, 'JMP'));
        patch(fs, jf);
      }
      cexpr(fs, e.orelse);
      for (const j of ends) patch(fs, j);
      return;
    }
    default:
      throw new Error('internal: unknown expression ' + e.k);
  }
}

function cmulti(fs, e) {
  if (e.k === 'vararg') emit(fs, 'VARPACK');
  else ccallPack(fs, e);
}

function cappend(fs, args) {
  args.forEach((a, i) => {
    if (i === args.length - 1 && isMulti(a)) {
      cmulti(fs, a);
      emit(fs, 'PAPPEND');
    } else {
      cexpr(fs, a);
      emit(fs, 'PPUSH');
    }
  });
}

function ccallPack(fs, e) {
  if (e.k === 'call') {
    cexpr(fs, e.fn);
    emit(fs, 'NEWPACK');
  } else {
    cexpr(fs, e.obj);
    emit(fs, 'SELF', constIndex(fs, e.name));
  }
  cappend(fs, e.args);
  emit(fs, 'CALLP');
}

function cadjust(fs, exps, n) {
  for (let i = 0; i < exps.length; i++) {
    const e = exps[i];
    if (i === exps.length - 1 && isMulti(e) && n > i) {
      cmulti(fs, e);
      emit(fs, 'ADJP', n - i);
      return;
    }
    cexpr(fs, e);
    if (i >= n) emit(fs, 'POP');
  }
  for (let j = exps.length; j < n; j++) emitK(fs, null);
}

function ctable(fs, e) {
  emit(fs, 'NEWTABLE');
  let idx = 1;
  e.items.forEach((it, i) => {
    if (it.type === 'kv') {
      cexpr(fs, it.key);
      cexpr(fs, it.e);
      emit(fs, 'SETFIELD');
    } else if (i === e.items.length - 1 && isMulti(it.e)) {
      cmulti(fs, it.e);
      emit(fs, 'SETPACK', idx);
    } else {
      cexpr(fs, it.e);
      emit(fs, 'SETIDX', idx);
      idx++;
    }
  });
}

function cblock(fs, stats) { openScope(fs); cstats(fs, stats); emitCloseFrom(fs, fs.scopes.length - 1); closeScope(fs); }
function pushLabels(fs, stats) {
  const m = new Map();
  stats.forEach((st, i) => {
    if (st.k !== 'label') return;
    if (m.has(st.name)) throw new Error(`label '${st.name}' already defined`);
    m.set(st.name, { pos: -1, pend: [], depth: fs.scopes.length, atEnd: stats.slice(i + 1).every((x) => x.k === 'label') });
  });
  fs.labels.push(m);
}
function findLabel(fs, name) {
  for (let i = fs.labels.length - 1; i >= 0; i--) {
    const e = fs.labels[i].get(name);
    if (e) return e;
  }
  return null;
}
function cstats(fs, stats) {
  pushLabels(fs, stats);
  for (const st of stats) cstat(fs, st);
  fs.labels.pop();
}
function pushContinue(fs) {
  const e = { pos: -1, pend: [] };
  fs.labels.push(new Map([[CONT, e]]));
  return e;
}
function popContinue(fs, e) {
  fs.labels.pop();
  e.pos = here(fs);
  for (const p of e.pend) patch(fs, p.j, e.pos);
  e.pend = [];
}

function clocal(fs, st) {
  const slots = st.names.map(() => newSlots(fs, 1));
  cadjust(fs, st.exps, st.names.length);
  const scope = fs.scopes[fs.scopes.length - 1];
  st.names.forEach((name, i) => scope.set(name, slots[i]));
  fs.nact += st.names.length;
  fs.lnames.push(...st.names);
  for (let i = slots.length - 1; i >= 0; i--) emit(fs, 'NEWLOC', slots[i]);
  st.names.forEach((name, i) => {
    const at = st.attribs ? st.attribs[i] : null;
    if (at === 'const') (scope.constNames || (scope.constNames = new Set())).add(name);
    else if (scope.constNames) scope.constNames.delete(name);
    if (at === 'close') {
      emit(fs, 'TBCCHK', slots[i]);
      (scope.tbc || (scope.tbc = [])).push({ slot: slots[i], pos: here(fs) });
    }
  });
}

function cassign(fs, st) {
  if (st.targets.length === 1 && st.exps.length === 1) {
    const t = st.targets[0];
    if (t.k === 'index') {
      cexpr(fs, t.obj);
      cexpr(fs, t.key);
      cexpr(fs, st.exps[0]);
      emit(fs, 'SETINDEX');
    } else {
      cexpr(fs, st.exps[0]);
      cset(fs, t.name);
    }
    return;
  }
  // 다중 대입: 인덱스 대상의 객체와 키를 먼저 평가해 슬롯에 두고, 우변을 모은 뒤 대입한다.
  // (예: i, t[i] = i + 1, 20 은 t[i]의 i를 대입 전 값으로 본다)
  const n = st.targets.length;
  const pre = st.targets.map((t) => {
    if (t.k !== 'index') return -1;
    const ob = newSlots(fs, 2);
    cexpr(fs, t.obj);
    emit(fs, 'NEWLOC', ob);
    cexpr(fs, t.key);
    emit(fs, 'NEWLOC', ob + 1);
    return ob;
  });
  cadjust(fs, st.exps, n);
  const base = newSlots(fs, n);
  for (let i = n - 1; i >= 0; i--) emit(fs, 'NEWLOC', base + i);
  st.targets.forEach((t, i) => {
    if (t.k === 'index') {
      emit(fs, 'GETLOC', pre[i]);
      emit(fs, 'GETLOC', pre[i] + 1);
      emit(fs, 'GETLOC', base + i);
      emit(fs, 'SETINDEX');
    } else {
      emit(fs, 'GETLOC', base + i);
      cset(fs, t.name);
    }
  });
}

function cstat(fs, st) {
  switch (st.k) {
    case 'local': clocal(fs, st); return;
    case 'localfunc': {
      // 재귀 호출이 가능하도록 함수 본문보다 먼저 이름을 묶는다
      const slot = newSlots(fs, 1);
      fs.scopes[fs.scopes.length - 1].set(st.name, slot);
      fs.nact++;
      fs.lnames.push(st.name);
      emitK(fs, null);
      emit(fs, 'NEWLOC', slot);
      emit(fs, 'CLOSURE', buildProto(fs, st.func, fs.protos));
      emit(fs, 'SETLOC', slot);
      return;
    }
    case 'assign': cassign(fs, st); return;
    case 'callstat': ccallPack(fs, st.e); emit(fs, 'POP'); return;
    case 'do': cblock(fs, st.body); return;
    case 'while': {
      const top = here(fs);
      cexpr(fs, st.cond);
      const jf = emit(fs, 'JMPF');
      pushLoop(fs);
      const cont = pushContinue(fs);
      cblock(fs, st.body);
      popContinue(fs, cont);
      emit(fs, 'JMP', top);
      patch(fs, jf);
      for (const j of fs.loops.pop()) patch(fs, j);
      return;
    }
    case 'repeat': {
      const top = here(fs);
      pushLoop(fs);
      const cont = pushContinue(fs);
      openScope(fs); // until 조건식이 본문의 지역 변수를 볼 수 있다
      cstats(fs, st.body);
      popContinue(fs, cont);
      cexpr(fs, st.cond);
      emitCloseFrom(fs, fs.scopes.length - 1);
      emit(fs, 'JMPF', top);
      closeScope(fs);
      for (const j of fs.loops.pop()) patch(fs, j);
      return;
    }
    case 'if': {
      const ends = [];
      st.clauses.forEach((c, i) => {
        cexpr(fs, c.cond);
        const jf = emit(fs, 'JMPF');
        cblock(fs, c.body);
        if (i < st.clauses.length - 1 || st.orelse) ends.push(emit(fs, 'JMP'));
        patch(fs, jf);
      });
      if (st.orelse) cblock(fs, st.orelse);
      for (const j of ends) patch(fs, j);
      return;
    }
    case 'fornum': {
      const base = newSlots(fs, 3);
      cexpr(fs, st.start); emit(fs, 'NEWLOC', base);
      cexpr(fs, st.limit); emit(fs, 'NEWLOC', base + 1);
      if (st.step) cexpr(fs, st.step); else emitK(fs, { num: '1' });
      emit(fs, 'NEWLOC', base + 2);
      emit(fs, 'FORPREP', base);
      const top = here(fs);
      emit(fs, 'FORTEST', base);
      const jf = emit(fs, 'JMPF');
      pushLoop(fs);
      const cont = pushContinue(fs);
      openScope(fs);
      const v = declareLocal(fs, st.name);
      emit(fs, 'GETLOC', base);
      emit(fs, 'NEWLOC', v);
      cstats(fs, st.body);
      emitCloseFrom(fs, fs.scopes.length - 1);
      closeScope(fs);
      popContinue(fs, cont);
      emit(fs, 'FORSTEP', base);
      emit(fs, 'JMP', top);
      patch(fs, jf);
      for (const j of fs.loops.pop()) patch(fs, j);
      return;
    }
    case 'forin': {
      const base = newSlots(fs, 4);
      cadjust(fs, st.exps, 3);
      emit(fs, 'NEWLOC', base + 2);
      emit(fs, 'NEWLOC', base + 1);
      emit(fs, 'NEWLOC', base);
      const top = here(fs);
      emit(fs, 'FORCALL', base);
      const jf = emit(fs, 'JMPF');
      pushLoop(fs);
      const cont = pushContinue(fs);
      openScope(fs);
      st.names.forEach((name, i) => {
        emit(fs, 'PKGET', base + 3, i + 1);
        emit(fs, 'NEWLOC', declareLocal(fs, name));
      });
      cstats(fs, st.body);
      emitCloseFrom(fs, fs.scopes.length - 1);
      closeScope(fs);
      popContinue(fs, cont);
      emit(fs, 'JMP', top);
      patch(fs, jf);
      for (const j of fs.loops.pop()) patch(fs, j);
      return;
    }
    case 'return':
      emit(fs, 'NEWPACK');
      cappend(fs, st.exps);
      emitCloseFrom(fs, 0);
      emit(fs, 'RETP');
      return;
    case 'break': {
      if (fs.loops.length === 0) throw new Error('no loop to break');
      emitCloseFrom(fs, fs.loops[fs.loops.length - 1].depth);
      fs.loops[fs.loops.length - 1].push(emit(fs, 'JMP'));
      return;
    }
    case 'goto': {
      const e = findLabel(fs, st.name);
      if (!e) throw new Error(st.name === CONT ? "'continue' must be inside a loop" : `no visible label '${st.name}' for goto`);
      emitGotoClose(fs, e);
      const j = emit(fs, 'JMP');
      if (e.pos >= 0) patch(fs, j, e.pos);
      else e.pend.push({ j, snap: fs.scopes.map((m) => m.base), nact: fs.nact });
      return;
    }
    case 'label': {
      const e = fs.labels[fs.labels.length - 1].get(st.name);
      const Lb = fs.scopes.length - 1;
      for (const p of e.pend) {
        if (!e.atEnd) {
          const proj = p.snap.length > Lb + 1 ? p.snap[Lb + 1] : p.nact;
          if (fs.nact > proj) throw new Error(`<goto ${st.name}> jumps into the scope of local '${fs.lnames[proj]}'`);
        }
        patch(fs, p.j, here(fs));
      }
      e.pos = here(fs);
      e.pend = [];
      return;
    }
    default:
      throw new Error('internal: unknown statement ' + st.k);
  }
}

function buildProto(parent, fn, protos) {
  const idx = protos.length;
  protos.push(null); // 중첩 함수가 먼저 등록되더라도 번호가 어긋나지 않게 자리를 먼저 잡는다
  const fs = {
    parent,
    protos,
    isVararg: fn.isVararg,
    np: fn.params.length,
    code: [],
    consts: [],
    constIdx: new Map(),
    scopes: [Object.assign(new Map(), { base: 0 })],
    nslots: 0,
    nact: 0,
    lnames: [],
    upvals: [],
    upvalMap: new Map(),
    loops: [],
    labels: [],
  };
  for (const name of fn.params) declareLocal(fs, name);
  cstats(fs, fn.body);
  emitCloseFrom(fs, 0);
  emit(fs, 'NEWPACK');
  emit(fs, 'RETP');
  protos[idx] = { code: fs.code, consts: fs.consts, upvals: fs.upvals, np: fs.np, isVararg: fs.isVararg };
  return idx + 1;
}

// AST 안에 이름 _ENV 대입이 있는지 본다 (지역 여부는 구분하지 않는 보수적 검사)
function assignsEnv(node) {
  if (node === null || typeof node !== 'object') return false;
  if (node.k === 'assign' && node.targets.some((t) => t.k === 'name' && t.name === '_ENV')) return true;
  return Object.values(node).some((v) => assignsEnv(v));
}
function compileProgram(src, dl = DIALECTS['5.1']) {
  ENV_SPECIAL = !!dl.goto;
  CLASSIC_NUM = !dl.bitops && !dl.luau;
  const protos = [];
  const root = parse(src, dl);
  if (ENV_SPECIAL && assignsEnv(root.body)) {
    root.body.unshift({ k: 'local', names: ['_ENV'], exps: [{ k: 'gname', name: '_G' }] });
  }
  buildProto(null, root, protos); // 루트는 0번 → 출력에서 PR[1]
  return protos;
}

const AUTO_ORDER = ['5.1', '5.2', '5.3', '5.4', 'luau', 'mixed'];
// 지원하지 않는 최상위 문장만 원문으로 두고 나머지는 VM으로 컴파일한다. 원문 문장은 loadstring으로 실행한다.
function compileSegmented(src, dl) {
  ENV_SPECIAL = !!dl.goto;
  CLASSIC_NUM = !dl.bitops && !dl.luau;
  const toks = tokenize(src, dl);
  const root = parse(src, dl, true);
  const declared = new Set();
  const body = [];
  const rawLines = [];
  for (const st of root.body) {
    if (st.k !== 'raw') {
      if (st.k === 'local') st.names.forEach((n) => declared.add(n));
      else if (st.k === 'localfunc') declared.add(st.name);
      body.push(st);
      continue;
    }
    const issue = rawSegmentIssue(toks, st.from, st.to, declared);
    if (issue) throw new Error(`${st.msg} (원문으로 남길 수 없음: ${issue})`);
    rawLines.push(toks[st.from].line);
    const text = src.slice(toks[st.from].s, toks[st.to].s);
    const loader = { k: 'bin', op: 'or', a: { k: 'gname', name: 'loadstring' }, b: { k: 'gname', name: 'load' } };
    const loaded = { k: 'call', fn: loader, args: [{ k: 'str', v: text }] };
    body.push({ k: 'callstat', e: { k: 'call', fn: { k: 'call', fn: { k: 'gname', name: 'assert' }, args: [loaded] }, args: [] } });
  }
  if (ENV_SPECIAL && assignsEnv(body)) body.unshift({ k: 'local', names: ['_ENV'], exps: [{ k: 'gname', name: '_G' }] });
  const protos = [];
  buildProto(null, { k: 'func', params: [], isVararg: true, body }, protos);
  return { protos, rawLines };
}

function compileAuto(src, dialect) {
  if (dialect !== 'auto') {
    const dl = DIALECTS[dialect];
    if (!dl) throw new Error(`알 수 없는 방언: ${dialect} (auto, 5.1, 5.2, 5.3, 5.4, luau, mixed 중 하나)`);
    return { protos: compileProgram(src, dl), dialect, rawLines: [] };
  }
  let last = null;
  for (const name of AUTO_ORDER) {
    try { return { protos: compileProgram(src, DIALECTS[name]), dialect: name, rawLines: [] }; } catch (e) { last = e; }
  }
  // 자동 선택에서만: 어느 방언으로도 안 되면 지원하지 않는 최상위 문장만 원문 구간으로 두고 다시 시도한다.
  let best = null;
  let reason = null;
  for (const name of AUTO_ORDER) {
    try {
      const r = compileSegmented(src, DIALECTS[name]);
      if (!best || r.rawLines.length < best.rawLines.length) best = { ...r, dialect: name };
    } catch (e) {
      if (!reason && e.message.includes('원문으로 남길 수 없음')) reason = e;
    }
  }
  if (best) return best;
  throw reason ?? last;
}

const OPNAMES = ['PUSHK', 'GETLOC', 'SETLOC', 'NEWLOC', 'GETUP', 'SETUP', 'GETG', 'SETG', 'INDEX', 'SETINDEX',
  'NEWTABLE', 'SETFIELD', 'SETIDX', 'SETPACK', 'BIN', 'UN', 'JMP', 'JMPF', 'JMPT', 'DUP', 'POP', 'NEWPACK',
  'PPUSH', 'PAPPEND', 'CALLP', 'FIRST', 'ADJP', 'SELF', 'VARARG', 'VARPACK', 'RETP', 'CLOSURE', 'FORPREP',
  'FORTEST', 'FORSTEP', 'FORCALL', 'PKGET', 'NOP', 'TBCCHK', 'CLOSELOC'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const luaStr = (s) => {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i);
    const plain = b >= 32 && b <= 126 && b !== 34 && b !== 92;
    out += plain ? String.fromCharCode(b) : '\\' + String(b).padStart(3, '0');
  }
  return out + '"';
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const pack24 = (v) => {
  let out = '';
  for (let k = 0; k < 4; k++) { out += B64[v % 64]; v = Math.floor(v / 64); }
  return out;
};
const packBytes = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    out += pack24((bytes[i] ?? 0) + (bytes[i + 1] ?? 0) * 256 + (bytes[i + 2] ?? 0) * 65536);
  }
  return out;
};

const luaLit = (v) => {
  if (v === null) return 'nil';
  if (typeof v === 'string') return luaStr(v);
  if (typeof v === 'object') return v.num;
  return String(v);
};

// 키 계산식은 compileOps()의 lits 생성부와 반드시 같아야 한다 (rollKey 참고).
const CASE_BODIES = {
  PUSHK: 'push(K[a])',
  GETLOC: 'push(L[a][1])',
  SETLOC: 'L[a][1] = pop()',
  NEWLOC: 'L[a] = { pop() }',
  GETUP: 'push(U[a][1])',
  SETUP: 'U[a][1] = pop()',
  GETG: 'push(ENV[K[a]])',
  SETG: 'ENV[K[a]] = pop()',
  INDEX: 'local k = pop(); local t = pop(); push(t[k])',
  SETINDEX: 'local v = pop(); local k = pop(); local t = pop(); t[k] = v',
  NEWTABLE: 'push({})',
  SETFIELD: 'local v = pop(); local k = pop(); S[sp][k] = v',
  SETIDX: 'local v = pop(); S[sp][a] = v',
  SETPACK: `local pk = pop(); local t = S[sp]
        for j = 1, pk.n do t[a + j - 1] = pk[j] end`,
  BIN: 'local y = pop(); local x = pop(); push(BIN[a](x, y))',
  UN: 'push(UN[a](pop()))',
  JMP: 'pc = 3 * a + 1',
  JMPF: `local c = pop()
        if c == nil or c == false then pc = 3 * a + 1 end`,
  JMPT: `local c = pop()
        if c ~= nil and c ~= false then pc = 3 * a + 1 end`,
  DUP: 'push(S[sp])',
  POP: 'pop()',
  NEWPACK: 'push({ n = 0 })',
  PPUSH: `local v = pop(); local t = S[sp]
        t.n = t.n + 1; t[t.n] = v`,
  PAPPEND: `local src = pop(); local t = S[sp]
        for j = 1, src.n do t.n = t.n + 1; t[t.n] = src[j] end`,
  CALLP: `local pk = pop(); local f = pop()
        -- Lua 5.1: getfenv/setfenv 의 레벨 1 은 "이 함수" 이므로 실행 중인 클로저(SF)를 가리킨다
        if f == getfenv and (pk.n == 0 or pk[1] == 1) then push(pack(getfenv(SF)))
        elseif f == setfenv and pk[1] == 1 and type(pk[2]) == "table" then
          setfenv(SF, pk[2]); ENV = pk[2]; push(pack(SF))
        else
          push(pack(f(unpack(pk, 1, pk.n))))
        end`,
  FIRST: 'local pk = pop(); push(pk[1])',
  ADJP: `local pk = pop()
        for j = 1, a do push(pk[j]) end`,
  SELF: 'local obj = pop(); push(obj[K[a]]); push({ n = 1, obj })',
  VARARG: 'push(V[1])',
  VARPACK: 'push(V)',
  RETP: 'RP = pop(); break',
  CLOSURE: `local proto = PR[a]
        prep(proto)
        local U2 = {}
        for i = 1, proto.nu do
          local fl = proto.u[2 * i - 1]
          local ix = proto.u[2 * i]
          if fl == 1 then U2[i] = L[ix] else U2[i] = U[ix] end
        end
        local FN
        FN = function(...) return exec(proto, U2, getfenv(FN), FN, ...) end
        setfenv(FN, ENV)
        push(FN)`,
  FORPREP: `local i0, l0, s0 = tonumber(L[a][1]), tonumber(L[a + 1][1]), tonumber(L[a + 2][1])
        if not i0 then error("'for' initial value must be a number") end
        if not l0 then error("'for' limit must be a number") end
        if not s0 then error("'for' step must be a number") end
        L[a][1], L[a + 1][1], L[a + 2][1] = i0, l0, s0`,
  FORTEST: `local i, lim, st = L[a][1], L[a + 1][1], L[a + 2][1]
        if st > 0 then push(i <= lim) else push(lim <= i) end`,
  FORSTEP: 'L[a][1] = L[a][1] + L[a + 2][1]',
  FORCALL: `local f, s, ctl = L[a][1], L[a + 1][1], L[a + 2][1]
        local pk = pack(f(s, ctl))
        L[a + 3] = { pk }
        if pk[1] ~= nil then L[a + 2][1] = pk[1]; push(true) else push(false) end`,
  PKGET: 'push(L[a][1][b])',
  NOP: '',
  TBCCHK: `local c = L[a]
        local v = c and c[1]
        if v ~= nil and v ~= false then
          local mt = getmetatable(v)
          if not (mt and mt.__close) then error("variable got a non-closable value") end
        end`,
  CLOSELOC: `local c = L[a]
        local v = c and c[1]
        if c then c[1] = nil end
        if v ~= nil and v ~= false then
          local mt = getmetatable(v)
          local cm = mt and mt.__close
          if cm then cm(v, nil) end
        end`,
};

function dispatchSource(OP) {
  const cases = Object.keys(CASE_BODIES)
    .map((name) => ({ id: OP[name], body: CASE_BODIES[name] }))
    .sort((x, y) => x.id - y.id);
  // 잎의 비교 순서는 무작위 (== 비교라서 순서가 의미를 바꾸지 않는다)
  const leaf = (list) => shuffle(list)
    .map((c, i) => `${i ? 'elseif' : 'if'} op == ${c.id} then\n        ${c.body}`)
    .join('\n') + '\n        else\n        error("VM: bad opcode")\n        end';
  const tree = (list) => {
    if (list.length <= 4) return leaf(list);
    const lo = Math.max(1, Math.floor(list.length / 3));
    const hi = list.length - lo;
    const mid = randInt(lo, hi + 1);
    return `if op <= ${list[mid - 1].id} then\n${tree(list.slice(0, mid))}\n      else\n${tree(list.slice(mid))}\n      end`;
  };
  return tree(cases);
}

function runtimeSource(OP, KEY, KX, KY) {
  // 주의: Lua 5.1 문법만 쓴다 (goto, //, 비트 연산자, table.unpack 직접 사용 금지)
  return `  local unpack = unpack or table.unpack
  local G = _G
  local getfenv = getfenv or function() return _G end
  local setfenv = setfenv or function() end
  local bxor = (bit32 and bit32.bxor) or function(a, b)
    local r, p = 0, 1
    while a > 0 or b > 0 do
      local x, y = a % 2, b % 2
      if x ~= y then r = r + p end
      a, b, p = (a - x) / 2, (b - y) / 2, p * 2
    end
    return r
  end
  local KEY = bxor(${KX}, ${KY})
  local function pack(...) return { n = select("#", ...), ... } end
  -- base64 변형: 문자 4개 = 24비트 값 하나 (little-endian). 이스케이프 없이 문자열에 바로 들어간다.
  local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  local MAPV = {}
  for i = 1, 64 do MAPV[string.byte(B64, i)] = i - 1 end
  local function unb64(s)
    local out, n = {}, 0
    for i = 1, #s, 4 do
      local c1, c2, c3, c4 = string.byte(s, i, i + 3)
      local v = MAPV[c1] + MAPV[c2] * 64 + MAPV[c3] * 4096 + MAPV[c4] * 262144
      n = n + 1
      out[n] = string.char(v % 256, math.floor(v / 256) % 256, math.floor(v / 65536) % 256)
    end
    return table.concat(out)
  end
  -- 문자열 상수: 바이트마다 키가 달라진다 (compile 쪽 kbAt과 같은 식)
  local function dec(s, k, ln)
    local raw = unb64(s)
    local out = {}
    for i = 1, ln do
      local j = i - 1
      local kb = (k + j * 73 + (j * j) % 251) % 256
      out[i] = string.char(bxor(string.byte(raw, i), kb))
    end
    return table.concat(out)
  end
  -- 명령 블롭: 값마다 키 스트림으로 가려져 있다. compile 쪽 ksAt과 같은 식이다.
  -- 로드 때 한 번만 풀고, 실행 루프에는 XOR이 없다.
  local function unblob(s, sl)
    local out, n, prev = {}, 0, 0
    for i = 1, #s, 4 do
      local c1, c2, c3, c4 = string.byte(s, i, i + 3)
      local v = MAPV[c1] + MAPV[c2] * 64 + MAPV[c3] * 4096 + MAPV[c4] * 262144
      local x = (n * 2654435761 + sl) % 8388608
      x = (x * x + KEY) % 8388608
      x = (x + prev * 131) % 8388608
      local plain = bxor(v, x)
      n = n + 1
      out[n] = plain
      prev = plain
    end
    return out
  end
  -- 5.3 정수 연산. 64비트 두 보수를 32비트 두 조각(lo, hi)으로 나눠 처리한다. 모든 중간값은 2^53 안에서 정확하다.
  -- 2^53을 넘는 결과는 부동소수점이라 정밀도가 떨어진다 (문서 참고).
  local TWO32, TWO63, TWO64 = 2 ^ 32, 2 ^ 63, 2 ^ 64
  local mtype = math.type
  local shl, shr
  local function split(a)
    a = math.floor(a)
    return a % TWO32, math.floor(a / TWO32) % TWO32
  end
  local function join(lo, hi)
    if hi >= 2147483648 then return math.floor((hi - TWO32) * TWO32 + lo) end
    return math.floor(hi * TWO32 + lo)
  end
  local function idiv(a, b)
    local q = math.floor(a / b)
    if mtype and (mtype(a) == "float" or mtype(b) == "float" or type(a) == "string" or type(b) == "string") then return q + 0.0 end
    return q
  end
  local function b32(op, x, y)
    local r, p = 0, 1
    for _ = 1, 32 do
      local bx, by = x % 2, y % 2
      local bit
      if op == 1 then bit = bx * by
      elseif op == 2 then bit = (bx + by > 0) and 1 or 0
      else bit = (bx ~= by) and 1 or 0 end
      r = r + bit * p
      x, y, p = (x - bx) / 2, (y - by) / 2, p * 2
    end
    return r
  end
  local function bitw(op, a, b)
    local al, ah = split(a)
    local bl, bh = split(b)
    return join(b32(op, al, bl), b32(op, ah, bh))
  end
  shl = function(a, n)
    n = math.floor(n)
    if n < 0 then return shr(a, -n) end
    if n >= 64 then return 0 end
    if n == 0 then return math.floor(a) end
    local lo, hi = split(a)
    if n >= 32 then return join(0, (lo * 2 ^ (n - 32)) % TWO32) end
    local nlo = (lo * 2 ^ n) % TWO32
    local nhi = ((hi % 2 ^ (32 - n)) * 2 ^ n + math.floor(lo / 2 ^ (32 - n))) % TWO32
    return join(nlo, nhi)
  end
  shr = function(a, n) -- 논리 시프트 (5.3의 >> 는 부호 없는 시프트)
    n = math.floor(n)
    if n < 0 then return shl(a, -n) end
    if n >= 64 then return 0 end
    if n == 0 then return math.floor(a) end
    local lo, hi = split(a)
    if n >= 32 then return math.floor(hi / 2 ^ (n - 32)) end
    return math.floor(hi * 2 ^ (32 - n) + math.floor(lo / 2 ^ n))
  end
  local function bnot(a) return -math.floor(a) - 1 end
  -- 5.3 실행기(math.type 과 load 가 있음)에서는 내장 연산을 쓴다. 5.1 계열에서는 NAT 가 nil 이라 위 근사 구현을 쓴다.
  local NAT = nil
  if mtype and (load or loadstring) then
    local okn, fns = pcall(function()
      return { (load or loadstring)("return function(a, b) return a // b end, function(a, b) return a & b end, function(a, b) return a | b end, function(a, b) return a ~ b end, function(a, b) return a << b end, function(a, b) return a >> b end, function(a) return ~a end")() }
    end)
    if okn and fns and fns[1] then NAT = fns end
  end
  local BIN = {
    [1] = function(a, b) return a + b end,
    [2] = function(a, b) return a - b end,
    [3] = function(a, b) return a * b end,
    [4] = function(a, b) return a / b end,
    [5] = function(a, b) return a .. b end,
    [6] = function(a, b) return a == b end,
    [7] = function(a, b) return a ~= b end,
    [8] = function(a, b) return a < b end,
    [9] = function(a, b) return a <= b end,
    [10] = function(a, b) return a > b end,
    [11] = function(a, b) return a >= b end,
    [12] = function(a, b) return a % b end,
    [13] = function(a, b) return a ^ b end,
    [14] = function(a, b) if NAT then return NAT[1](a, b) end return idiv(a, b) end,
    [15] = function(a, b) if NAT then return NAT[2](a, b) end return bitw(1, a, b) end,
    [16] = function(a, b) if NAT then return NAT[3](a, b) end return bitw(2, a, b) end,
    [17] = function(a, b) if NAT then return NAT[4](a, b) end return bitw(3, a, b) end,
    [18] = function(a, b) if NAT then return NAT[5](a, b) end return shl(a, b) end,
    [19] = function(a, b) if NAT then return NAT[6](a, b) end return shr(a, b) end,
  }
  local UN = {
    [1] = function(a) return -a end,
    [2] = function(a) return not a end,
    [3] = function(a) return #a end,
    [4] = function(a) if NAT then return NAT[7](a) end return bnot(a) end,
  }
  local function _dead(x)
    if x == nil then return x end
    local y = bxor(x, KEY)
    if y ~= y then return y end
    return y + 0
  end
  -- 함수 원형을 처음 쓸 때 한 번만 푼다: 명령 블롭, 상수, 업밸류 기술자
  local function ks(sl, n)
    local x = (n * 2654435761 + sl) % 8388608
    return (x * x + KEY) % 8388608
  end
  -- Fletcher 류 체크섬 (mod 65521). st = {a, b}, 값은 0 이상 2^24 미만 정수
  local function fold(st, x)
    local a = (st[1] + x) % 65521
    st[1] = a
    st[2] = (st[2] + a) % 65521
  end
  -- 실행 환경 감시: 전역 getfenv 교체, 디버그 훅 설치를 잡는다. chkcode 와 같은 주기로 돈다.
  local GF0 = rawget(G, "getfenv")
  local function trap() error("VM: integrity", 0) end
  local function envcheck()
    if rawget(G, "getfenv") ~= GF0 then trap() end
    local dbg = rawget(G, "debug")
    if dbg and dbg.gethook and dbg.gethook() ~= nil then trap() end
  end
  -- 시작 때 한 번: 디버거로 한 줄씩 밟으면 시간이 크게 늘어난다 (임계값은 정상 실행의 수백 배)
  local function timecheck()
    if not os or not os.clock then return end
    local t0, acc = os.clock(), 0
    for i = 1, 20000 do acc = acc + i end
    if os.clock() - t0 > 1.5 then trap() end
  end
  -- 상수: 복호화 전 암호문 상태로 로드 때 한 번 검사한다
  local function chkk(P)
    local K, st = P.k, { 1, 0 }
    for i = 1, P.nk do
      local v = K[i]
      if type(v) == "table" then
        fold(st, 4); fold(st, v.ek); fold(st, v.ln); fold(st, v.t == "n" and 1 or 0)
        local es = v.es
        for j = 1, #es do fold(st, string.byte(es, j)) end
      elseif v == nil then
        fold(st, 1)
      else
        fold(st, 2); fold(st, v and 1 or 0)
      end
    end
    if st[2] * 65521 + st[1] ~= bxor(P.hk, KEY) then error("VM: integrity", 0) end
  end
  -- 명령과 업밸류: 디코드된 평문을 호출마다 다시 검사한다 (메모리 패치 감지)
  local function chkcode(P)
    envcheck()
    local C, Up = P.c, P.u
    local fa, fb = 1, 0
    local hdr1, hdr2, hdr3, hdr4 = P.np, P.va and 1 or 0, P.nu, P.nk
    fa = (fa + hdr1) % 65521; fb = (fb + fa) % 65521
    fa = (fa + hdr2) % 65521; fb = (fb + fa) % 65521
    fa = (fa + hdr3) % 65521; fb = (fb + fa) % 65521
    fa = (fa + hdr4) % 65521; fb = (fb + fa) % 65521
    for i = 1, #C do fa = (fa + C[i]) % 65521; fb = (fb + fa) % 65521 end
    for i = 1, P.nu * 2 do fa = (fa + Up[i]) % 65521; fb = (fb + fa) % 65521 end
    if fb * 65521 + fa ~= bxor(P.hc, KEY) then error("VM: integrity", 0) end
  end
  local function prep(P)
    if not P.ready then
      if type(P.c) == "string" then P.c = unblob(P.c, P.sl) end
      for i = 1, P.nu * 2 do P.u[i] = bxor(P.u[i], ks(P.sl, 1048576 + i)) end
      chkk(P)
      local K = P.k
      for i = 1, P.nk do
        local v = K[i]
        if type(v) == "table" and v.ek then
          local s = dec(v.es, v.ek, v.ln)
          if v.t == "n" then K[i] = tonumber(s) else K[i] = s end
        end
      end
      -- 재검사 간격은 함수/빌드마다 다르다 (고정 상수가 없어야 패치 지점을 못 찾는다)
      P.cs = bxor(P.cs, KEY)
      P.ready = true
    end
    -- 로드 때는 항상 검사하고, 이후에는 함수마다 다른 간격(24~80회)으로 다시 검사한다
    local n = P.cn + 1
    P.cn = n
    if n % P.cs == 1 then chkcode(P) end
  end
  local exec
  exec = function(P, U, E, SF, ...)
    local ENV = E
    prep(P)
    local C = P.c
    local PM = P.pm
    local K = P.k
    local V = pack(...)
    local L = {}
    for i = 1, P.np do L[i] = { V[i] } end
    local S, sp = {}, 0
    local RP
    local pc = 1
    local function push(v) sp = sp + 1; S[sp] = v end
    local function pop() local v = S[sp]; S[sp] = nil; sp = sp - 1; return v end
    while true do
      local op, a, b = PM[C[pc]], C[pc + 1], C[pc + 2]
      pc = pc + 3
      ${dispatchSource(OP)}
    end
    return unpack(RP, 1, RP.n)
  end
  local W
  local tchk = false
  W = function(...)
    if not tchk then tchk = true; timecheck() end
    return exec(PR[1], {}, getfenv(W), W, ...)
  end
  return W`;
}

//  - 첫 블록은 항상 맨 앞에 둔다 (실행 시작점)
function shuffleBlocks(code) {
  const n = code.length;
  if (n === 0) return code;
  const starts = new Set([0]);
  code.forEach((ins, i) => {
    if (ins.op === 'JMP' || ins.op === 'JMPF' || ins.op === 'JMPT') {
      starts.add(ins.a);
      starts.add(i + 1);
    }
  });
  const bounds = [...starts].filter((x) => x <= n).sort((x, y) => x - y);
  const blocks = bounds.map((st, bi) => {
    const en = bi + 1 < bounds.length ? bounds[bi + 1] : n;
    return { start: st, body: code.slice(st, en) };
  });
  blocks.forEach((b, bi) => {
    const last = b.body[b.body.length - 1];
    const endsUncond = last && (last.op === 'JMP' || last.op === 'RETP');
    b.fallthrough = endsUncond ? null : (bi + 1 < blocks.length ? blocks[bi + 1].start : n);
  });
  const order = blocks.map((_, i) => i);
  for (let i = order.length - 1; i > 1; i--) {
    const j = 1 + randInt(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const newStart = new Map();
  let pos = 0;
  for (const bi of order) {
    newStart.set(blocks[bi].start, pos);
    pos += blocks[bi].body.length + (blocks[bi].fallthrough !== null ? 1 : 0);
  }
  newStart.set(n, pos);
  const out = [];
  for (const bi of order) {
    const b = blocks[bi];
    for (const ins of b.body) {
      const copy = { ...ins };
      if (copy.op === 'JMP' || copy.op === 'JMPF' || copy.op === 'JMPT') copy.a = newStart.get(copy.a);
      out.push(copy);
    }
    if (b.fallthrough !== null) out.push({ op: 'JMP', a: newStart.get(b.fallthrough), b: 0 });
  }
  return out;
}

const DENSITY = {
  0: { nop: 0, dead: 0 },
  1: { nop: 4, dead: 6 },
  2: { nop: 3, dead: 4 },
  3: { nop: 2, dead: 3 },
};
function insertDecoys(code, density, consts) {
  const cfg = DENSITY[density] ?? DENSITY[2];
  const newIdx = new Array(code.length + 1);
  const out = [];
  const junk = (count) => {
    for (let d = 0; d < count; d++) {
      if (randInt(0, 2) === 0) {
        out.push({ op: 'NOP', a: randInt(0, 0x7fffff), b: randInt(0, 0x7fffff), decoy: true });
      } else {
        consts.push({ num: String(randInt(1, 1000000)) });
        out.push({ op: 'PUSHK', a: consts.length, b: 0, decoy: true }, { op: 'POP', a: 0, b: 0, decoy: true });
      }
    }
  };
  const K = (n) => { consts.push({ num: String(n) }); return consts.length; };
  const opaquePredicate = () => {
    const r = randInt(2, 90);
    const d = (op, a) => ({ op, a, b: 0, decoy: true });
    switch (randInt(0, 3)) {
      case 0:
        return [d('PUSHK', K(r)), d('PUSHK', K(r + 1)), d('BIN', 3), d('PUSHK', K(2)), d('BIN', 12),
          d('PUSHK', K(0)), d('BIN', 6)];
      case 1:
        return [d('PUSHK', K(r)), d('PUSHK', K(r)), d('BIN', 3), d('PUSHK', K(0)), d('BIN', 11)];
      case 2:
        return [d('PUSHK', K(r)), d('PUSHK', K(r + 1)), d('BIN', 7)];
      default:
        return [d('PUSHK', K(r)), d('PUSHK', K(r)), d('BIN', 3), d('PUSHK', K(4)), d('BIN', 12),
          d('PUSHK', K(2)), d('BIN', 7)];
    }
  };
  code.forEach((ins, i) => {
    if (cfg.dead && randInt(0, cfg.dead) === 0) {
      if (randInt(0, 1) === 0) {
        const jmp = { op: 'JMP', a: 0, b: 0, decoy: true };
        out.push(jmp);
        junk(randInt(2, 6));
        jmp.a = out.length;
      } else {
        const jmp = { op: 'JMPT', a: 0, b: 0, decoy: true };
        out.push(...opaquePredicate(), jmp);
        junk(randInt(2, 5));
        jmp.a = out.length;
      }
    }
    if (cfg.nop && randInt(0, cfg.nop) === 0) junk(randInt(1, 3));
    newIdx[i] = out.length;
    out.push({ ...ins });
  });
  newIdx[code.length] = out.length;
  for (const ins of out) {
    if (!ins.decoy && (ins.op === 'JMP' || ins.op === 'JMPF' || ins.op === 'JMPT')) ins.a = newIdx[ins.a];
  }
  return out;
}

// 런타임 안의 지역 변수 이름을 빌드마다 무작위로 바꾼다. 전역(error, select, table 등)과 테이블 필드(.c, .k 등)는 건드리지 않는다.
const RENAME_LOCALS = ['KEY', 'G', 'C', 'K', 'L', 'S', 'sp', 'RP', 'V', 'U', 'U2', 'P', 'PR', 'pc', 'op', 'ki', 'idx',
  'a', 'b', 'c', 'v', 'x', 'y', 's', 'i', 'j', 'k', 't', 'f', 'pk', 'src', 'obj', 'lim', 'st', 'proto', 'fl', 'ix',
  'ctl', 'out', 'r', 'p', 'push', 'pop', 'pack', 'dec', 'bxor', 'exec', 'BIN', 'UN', 'i0', 'l0', 's0', 'unblob',
  'fold', 'chkk', 'chkcode', 'prep', 'ks', 'kb', 'j', 'fa', 'fb', 'hdr1', 'hdr2', 'hdr3', 'hdr4', 'Up', 'es',
  'prev', 'plain', 'PM', 'GF0', 'trap', 'envcheck', 'timecheck', 'tchk', 'dbg', 'acc', 't0'];
function makeNames() {
  const used = new Set();
  const names = {};
  for (const n of RENAME_LOCALS) {
    let id;
    do { id = '_' + randHex(4); } while (used.has(id));
    used.add(id);
    names[n] = id;
  }
  return names;
}
function renameLocals(src, names) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const prev = i > 0 ? src[i - 1] : '';
      const isField = prev === '.' || prev === ':';
      out += !isField && Object.prototype.hasOwnProperty.call(names, word) ? names[word] : word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// 런타임 chkk/chkcode와 같은 식: mod 65521 Fletcher 체크섬. parts는 정수 배열들의 배열.
function fletcher(parts) {
  let a = 1;
  let b = 0;
  for (const arr of parts) {
    for (const x of arr) {
      a = (a + x) % 65521;
      b = (b + a) % 65521;
    }
  }
  return b * 65521 + a;
}

const OUTPUT_HEADER = "--This file was protected using Custom VM Obfuscator v0.1 [https://jinhyuk.xyz/]\n\n--[[\n     ██╗██╗███╗   ██╗██╗  ██╗██╗   ██╗██╗   ██╗██╗  ██╗\n     ██║██║████╗  ██║██║  ██║╚██╗ ██╔╝██║   ██║██║ ██╔╝\n     ██║██║██╔██╗ ██║███████║ ╚████╔╝ ██║   ██║█████╔╝\n██   ██║██║██║╚██╗██║██╔══██║  ╚██╔╝  ██║   ██║██╔═██╗\n╚█████╔╝██║██║ ╚████║██║  ██║   ██║   ╚██████╔╝██║  ██╗\n ╚════╝ ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝\n\n]]\n\n";

export function obfuscateDetailed(source, opts = {}) {
  const src = source.replace(/^#[^\n]*/, '');
  const { protos, dialect, rawLines } = compileAuto(utf8ToLatin1(src), opts.dialect ?? 'auto');

  const pool = shuffle(Array.from({ length: 254 }, (_, i) => i + 1));
  const OP = {};
  OPNAMES.forEach((name, i) => { OP[name] = pool[i]; });
  const KEY = randInt(1, 0x7fffff);
  const KX = randInt(1, 0x7fffff);
  const KY = (KEY ^ KX) >>> 0;
  const name = '__vm' + randHex(4);
  const names = makeNames();
  // 값 키 스트림: 값 번호 n과 함수 소금 sl로 비선형 키를 만든다. runtime의 unblob과 같은 식이어야 한다.
  const ksAt = (sl, n) => {
    let x = (n * 2654435761 + sl) % 8388608;
    x = (x * x + KEY) % 8388608;
    return x;
  };

  // 무결성 기대값은 KEY로 가려 두고, 런타임이 같은 식으로 다시 계산해 비교한다.
  const hEnc = (x) => (x ^ KEY) >>> 0;
  // 문자열 상수 바이트 키 (런타임 dec와 같은 식, j는 0부터)
  const kbAt = (k, j) => (k + j * 73 + ((j * j) % 251)) % 256;
  // 가짜 프로토: 실제 함수의 명령 모양을 빌려 호출되지 않는 함수를 뒤에 덧붙인다.
  // 실제 프로토는 앞 번호를 그대로 쓰므로 CLOSURE 번호는 바뀌지 않는다.
  const decoyCount = opts.decoys ?? randInt(2, 6);
  const JUMPS = new Set(['JMP', 'JMPF', 'JMPT', 'CLOSURE', 'RETP']);
  for (let d = 0; d < decoyCount; d++) {
    const src = protos[randInt(0, protos.length)];
    const len = Math.max(4, Math.min(60, src.code.length));
    const code = [];
    for (let i = 0; i < len; i++) {
      const ref = src.code[randInt(0, src.code.length)];
      const op = JUMPS.has(ref.op) ? 'NOP' : ref.op;
      code.push({ op, a: randInt(0, 64), b: randInt(0, 64) });
    }
    protos.push({ code, consts: [], upvals: [], np: randInt(0, 4), isVararg: randInt(0, 2) === 1 });
  }
  for (const p of protos) {
    for (let n = randInt(2, 6); n > 0; n--) {
      if (randInt(0, 2) === 0) p.consts.push({ num: String(randInt(0, 1000000)) });
      else p.consts.push(Array.from({ length: randInt(3, 12) }, () => 'abcdefghijklmnopqrstuvwxyz'[randInt(0, 26)]).join(''));
    }
  }

  const lits = protos.map((p) => {
    const sl = randInt(0, 8388608);
    const flat = [];
    const code = insertDecoys(shuffleBlocks(p.code), opts.density ?? 3, p.consts);
    // 함수마다 명령 번호를 다시 섞는다 (proto별 순열). 런타임은 pm 표로 원래 번호를 복원한다.
    const perm = shuffle(Array.from({ length: 254 }, (_, i) => i + 1));
    const inv = new Array(254);
    perm.forEach((e, i) => { inv[e - 1] = i + 1; });
    code.forEach((ins) => {
      flat.push(perm[OP[ins.op] - 1], ins.a, ins.b);
    });
    if (flat.length >= 1048576) throw new Error('함수가 너무 큼 (명령 값 1048576개 이상)');
    // 연쇄 암호화: n번째 키는 (n번 키 스트림 + 앞 명령 평문 * 131) mod 2^23. 한 칸만 고치면 뒤가 전부 깨진다.
    let blob = '';
    let prevPlain = 0;
    for (let n = 0; n < flat.length; n++) {
      const raw = flat[n];
      if (raw < 0 || raw >= 0x1000000) throw new Error('명령 값이 24비트 범위를 벗어남');
      const kk = (ksAt(sl, n) + prevPlain * 131) % 8388608;
      blob += pack24((raw ^ kk) >>> 0);
      prevPlain = raw;
    }
    const ups = [];
    const upPlain = [];
    for (const u of p.upvals) {
      const fp = Number(u.fromParent);
      const ix = Number(u.index);
      upPlain.push(fp, ix);
      ups.push(String((fp ^ ksAt(sl, 1048576 + ups.length + 1)) >>> 0));
      ups.push(String((ix ^ ksAt(sl, 1048576 + ups.length + 1)) >>> 0));
    }
    // 상수 무결성 입력: 암호문 상태 그대로 (런타임 chkk가 복호화 전에 같은 순서로 읽는다)
    const hk = [];
    const consts = p.consts.map((v, j) => {
      if (v === null) { hk.push(1); return 'nil'; }
      if (typeof v === 'boolean') { hk.push(2, v ? 1 : 0); return luaLit(v); }
      const isNum = typeof v === 'number' || (typeof v === 'object' && v !== null);
      const text = typeof v === 'string' ? v : (typeof v === 'object' ? v.num : String(v));
      const kj = (KEY + sl + j * 91) % 256;
      const bytes = [];
      for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) ^ kbAt(kj, i));
      const packed = packBytes(bytes);
      hk.push(4, kj, text.length, isNum ? 1 : 0);
      for (let i = 0; i < packed.length; i++) hk.push(packed.charCodeAt(i));
      return `{ es = ${luaStr(packed)}, ek = ${kj}, ln = ${text.length}${isNum ? ', t = "n"' : ''} }`;
    });
    const hc = fletcher([[p.np, p.isVararg ? 1 : 0, p.upvals.length, p.consts.length], flat, upPlain]);
    const hkv = fletcher([hk]);
    const checkStride = randInt(24, 81);
    return `(function() return { c = ${luaStr(blob)}, k = { ${consts.join(', ')} }, nk = ${p.consts.length}, sl = ${sl}, `
      + `u = { ${ups.join(', ')} }, nu = ${p.upvals.length}, np = ${p.np}, va = ${p.isVararg}, `
      + `hc = ${hEnc(hc)}, hk = ${hEnc(hkv)}, cs = ${hEnc(checkStride)}, cn = 0, pm = { ${inv.join(', ')} } } end)()`;
  });

  const runtimeText = renameLocals(runtimeSource(OP, KEY, KX, KY), names);
  const code = [
    `local ${name} = (function(${names.PR})`,
    runtimeText,
    'end)({',
    '  ' + lits.join(',\n  '),
    '})',
    `return ${name}(...)`,
    '',
  ].join('\n');

  // 변조 감지 블록은 VM으로 감싸지 않고 원문 그대로 앞에 붙인다 (antitamper.js 주석 참고).
  const guard = opts.antiTamper ? ANTI_TAMPER_SRC + '\n' : '';
  const out = guard + code;
  // 출력은 항상 Lua 5.1 문법이어야 한다 (실행기 환경 요구사항). 어기면 내부 오류로 막는다.
  const bad = validateLua51(out);
  if (bad) throw new Error('내부 오류: 출력이 Lua 5.1 문법이 아님 — ' + bad);
  const outCode = opts.header === false ? out : OUTPUT_HEADER + out;
  return { code: outCode, vm: 1, raw: rawLines.length, rawLines, dialect, lits, runtimeText, prName: names.PR };
}

export function validateLua51(code) {
  try {
    for (const t of tokenize(code, DIALECTS['5.1'])) {
      const raw = code.slice(t.s, t.e);
      if (t.t === 'num' && /^0[xX]/.test(raw) && /[.pP]/.test(raw)) throw new Error(`line ${t.line}: 16진 실수 ${raw} (Luau 불가)`);
    }
    parse(code, DIALECTS['5.1']);
    return null;
  } catch (e) { return e.message; }
}

export const obfuscate = (src, opts = {}) => obfuscateDetailed(src, opts).code;

// 배포용 묶음: 함수 원형(proto) 목록을 parts 개의 조각으로 나눈다. 조각은 각각 따로 난독화된 Lua 청크이며,
// 청크를 실행하면 { [원래 번호] = 함수 데이터 } 표를 돌려준다. 엔진(런타임)은 평문 텍스트로 따로 준다.
// 로더가 조각들을 받아 표를 합친 뒤 엔진에 넘기면 원래 프로그램이 실행된다.
export function obfuscateBundle(src, opts = {}) {
  const N = opts.parts ?? 6;
  const r = obfuscateDetailed(src, opts);
  const order = shuffle(Array.from({ length: r.lits.length }, (_, i) => i));
  const groups = Array.from({ length: N }, () => []);
  order.forEach((k, n) => groups[n % N].push(k));
  const partOpts = { dialect: '5.1', density: opts.density, header: false };
  const parts = groups.map((g) => {
    // 조각 본문(데이터 표)은 문자열 상수로 가려서 VM이 감싼다. 표 자체를 VM으로 컴파일하면 명령 수 한계를 넘는다.
    const body = g.map((k) => `  [${k + 1}] = ${r.lits[k]}`).join(',\n');
    return obfuscateDetailed(`return (loadstring or load)(${luaStr(`return {\n${body}\n}\n`)})()\n`, partOpts).code;
  });
  const engine = `return function(${r.prName})\n${r.runtimeText}\nend\n`;
  const bad = validateLua51(engine);
  if (bad) throw new Error('내부 오류: 엔진이 Lua 5.1 문법이 아님 — ' + bad);
  return { code: r.code, engine, parts, count: r.lits.length, raw: r.raw, rawLines: r.rawLines };
}
