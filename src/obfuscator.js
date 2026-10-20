

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
const latin1ToUtf8 = (s) => {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto',
  'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
const STMT_START = new Set(['name', 'local', 'if', 'while', 'for', 'return', 'function', 'do', 'repeat', 'break', 'goto']);
const CONT = new Set(['=', ',', '(', '[', '{', '.', ':', '+', '-', '*', '/', '%', '^', '#', '..', '==', '~=',
  '<', '<=', '>', '>=', 'and', 'or', 'not']);

class Unsupported extends Error {}

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
  if (content[0] === '\n') content = content.slice(1);
  return { content, next: end + close.length };
}

function readEscape(src, j) {
  const c = src[j + 1];
  const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
  if (c !== undefined && Object.prototype.hasOwnProperty.call(simple, c)) return { ch: simple[c], next: j + 2 };
  if (c !== undefined && /[0-9]/.test(c)) {
    let k = j + 1;
    let digits = '';
    while (k < src.length && digits.length < 3 && /[0-9]/.test(src[k])) digits += src[k++];
    return { ch: String.fromCharCode(Number(digits) & 255), next: k };
  }
  if (c === 'x' && /^[0-9a-fA-F]{2}$/.test(src.slice(j + 2, j + 4))) {
    return { ch: String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16)), next: j + 4 };
  }
  if (c === 'z') {
    let k = j + 2;
    while (k < src.length && /\s/.test(src[k])) k++;
    return { ch: '', next: k };
  }
  return { ch: c ?? '', next: j + 2 };
}

function tokenize(src) {
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
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      const lb = longBracket(src, i + 2);
      if (lb) { i = readLong(src, lb.start, lb.lvl).next; continue; }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i, i + 80));
      push({ t: 'num', v: { num: m[0] } }, i, i + m[0].length);
      i += m[0].length;
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
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\n') throw new Error('unfinished string');
        if (src[j] === '\\') { const r = readEscape(src, j); s += r.ch; j = r.next; } else { s += src[j++]; }
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
      push(KEYWORDS.has(w) ? { t: w } : { t: 'name', v: w }, i, j);
      i = j;
      continue;
    }
    if (src.slice(i, i + 3) === '...') { push({ t: '...' }, i, i + 3); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '~=', '<=', '>=', '..', '::'].includes(two)) { push({ t: two }, i, i + 2); i += 2; continue; }
    push({ t: c }, i, i + 1);
    i++;
  }
  push({ t: 'eof' }, n, n);
  return toks;
}

const BIN_ID = { add: 1, sub: 2, mul: 3, div: 4, concat: 5, eq: 6, ne: 7, lt: 8, le: 9, gt: 10, ge: 11, mod: 12, pow: 13 };
const BIN_OP = new Map([['+', 'add'], ['-', 'sub'], ['*', 'mul'], ['/', 'div'], ['%', 'mod'], ['^', 'pow'], ['..', 'concat'],
  ['==', 'eq'], ['~=', 'ne'], ['<', 'lt'], ['<=', 'le'], ['>', 'gt'], ['>=', 'ge']]);
const PREC = new Map([['or', 1], ['and', 2], ['==', 3], ['~=', 3], ['<', 3], ['<=', 3], ['>', 3], ['>=', 3],
  ['..', 4], ['+', 5], ['-', 5], ['*', 6], ['/', 6], ['%', 6], ['^', 8]]);
const RIGHT = new Set(['^', '..']);
const UNARY = new Map([['-', 'neg'], ['not', 'not'], ['#', 'len']]);
const UN_ID = { neg: 1, not: 2, len: 3 };

function keyOf(v) {
  if (v === null) return 'nil';
  if (typeof v === 'object') return 'n:' + v.num;
  return typeof v + ':' + String(v);
}

function scanRaw(toks, p0) {
  let depth = 0;
  let pendingDo = 0;
  let p = p0;
  for (;;) {
    const t = toks[p];
    if (t.t === 'eof') break;
    if (p > p0 && depth === 0) {
      const prev = toks[p - 1];
      if (STMT_START.has(t.t) && !CONT.has(prev.t) &&
          (t.line > prev.line || prev.t === 'end' || prev.t === 'until')) break;
    }
    switch (t.t) {
      case 'function': case 'if': case 'repeat': depth++; break;
      case 'while': case 'for': depth++; pendingDo++; break;
      case 'do': if (pendingDo > 0) pendingDo--; else depth++; break;
      case 'end': case 'until': depth--; break;
      default: break;
    }
    p++;
  }
  return p;
}

function collectRawLocals(toks, s, e, out) {
  for (let i = s; i < e; i++) {
    if (toks[i].t !== 'local') continue;
    if (toks[i + 1].t === 'function' && toks[i + 2].t === 'name') { out.add(toks[i + 2].v); continue; }
    let j = i + 1;
    while (toks[j].t === 'name') {
      out.add(toks[j].v);
      j++;
      if (toks[j].t === ',') j++; else break;
    }
  }
}

function compileSegments(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const fail = (msg) => { throw new Unsupported(msg); };
  const expect = (t) => (peek().t === t ? next() : fail(`expected ${t}`));

  const newGroup = () => ({ code: [], consts: [], constIdx: new Map() });
  let cur = newGroup();
  const segments = [];
  const rawLocals = new Set();
  const checkName = (name) => { if (rawLocals.has(name)) fail(`raw local "${name}"`); };

  const K = (v) => {
    const k = keyOf(v);
    if (!cur.constIdx.has(k)) {
      cur.constIdx.set(k, cur.consts.length);
      cur.consts.push(v);
    }
    return cur.constIdx.get(k);
  };
  const emit = (op, a = 0) => { cur.code.push({ op, a }); return cur.code.length - 1; };
  const patch = (idx) => { cur.code[idx].a = cur.code.length; };
  const lastOp = () => (cur.code.length ? cur.code[cur.code.length - 1].op : null);

  function callArgs() {
    expect('(');
    let n = 0;
    if (peek().t !== ')') {
      do { expr(1); n++; } while (peek().t === ',' && next());
    }
    expect(')');
    emit('CALL', n);
  }

  function primary() {
    const t = peek();
    switch (t.t) {
      case 'num': case 'str': next(); emit('PUSHK', K(t.v)); return;
      case 'true': next(); emit('PUSHK', K(true)); return;
      case 'false': next(); emit('PUSHK', K(false)); return;
      case 'nil': next(); emit('PUSHK', K(null)); return;
      case 'name':
        next();
        checkName(t.v);
        emit('GETG', K(t.v));
        if (peek().t === '(') callArgs();
        return;
      case '(': next(); expr(1); expect(')'); return;
      default: fail(`unexpected "${t.t}"`);
    }
  }

  function expr(minP) {
    const u = peek().t;
    if (UNARY.has(u)) {
      next();
      expr(7);
      emit('UN', UN_ID[UNARY.get(u)]);
    } else {
      primary();
    }
    for (;;) {
      const op = peek().t;
      const pr = PREC.get(op);
      if (pr === undefined || pr < minP) break;
      next();
      if (op === 'and' || op === 'or') {
        emit('DUP');
        const j = emit(op === 'and' ? 'JMPF' : 'JMPT', 0);
        emit('POP');
        expr(pr + 1);
        patch(j);
        continue;
      }
      expr(RIGHT.has(op) ? pr : pr + 1);
      emit('BIN', BIN_ID[BIN_OP.get(op)]);
    }
  }

  function block(ends) {
    while (!ends.includes(peek().t) && peek().t !== 'eof') statement();
  }

  function statement() {
    const t = peek();
    switch (t.t) {
      case 'local': {
        next();
        const name = expect('name').v;
        checkName(name);
        if (peek().t === '=') { next(); expr(1); } else emit('PUSHK', K(null));
        emit('SETG', K(name));
        return;
      }
      case 'if': {
        next();
        expr(1);
        expect('then');
        const jf = emit('JMPF', 0);
        block(['else', 'end']);
        if (peek().t === 'else') {
          next();
          const jend = emit('JMP', 0);
          patch(jf);
          block(['end']);
          patch(jend);
        } else {
          patch(jf);
        }
        expect('end');
        return;
      }
      case 'while': {
        next();
        const top = cur.code.length;
        expr(1);
        expect('do');
        const jf = emit('JMPF', 0);
        block(['end']);
        emit('JMP', top);
        patch(jf);
        expect('end');
        return;
      }
      case 'return': {
        next();
        if (!['end', 'eof', 'else', 'elseif', 'until', ';'].includes(peek().t)) { expr(1); emit('POP'); }
        emit('RET');
        if (!['end', 'eof', 'else', 'elseif', 'until', ';'].includes(peek().t)) {
          throw new Error(`'return' must be the last statement in a block`);
        }
        return;
      }
      case 'name': {
        next();
        if (peek().t === '=') { checkName(t.v); next(); expr(1); emit('SETG', K(t.v)); return; }
        p--;
        expr(1);
        if (lastOp() !== 'CALL') fail('not a call statement');
        emit('POP');
        return;
      }
      default:
        fail(`unexpected "${t.t}"`);
    }
  }

  const snapshot = () => ({ p, codeLen: cur.code.length, constLen: cur.consts.length });
  const rollback = (s) => {
    p = s.p;
    cur.code.length = s.codeLen;
    cur.consts.length = s.constLen;
    cur.constIdx = new Map(cur.consts.map((v, i) => [keyOf(v), i]));
  };
  const flush = () => {
    if (cur.code.length === 0) return;
    emit('HALT');
    segments.push({ kind: 'vm', code: cur.code, consts: cur.consts });
    cur = newGroup();
  };

  while (peek().t !== 'eof') {
    if (peek().t === ';') { next(); continue; }
    const start = p;
    const snap = snapshot();
    try {
      statement();
      const nx = peek().t;
      if (!(nx === 'eof' || nx === ';' || STMT_START.has(nx))) fail('statement boundary');
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      rollback(snap);
      flush();
      const end = scanRaw(toks, start);
      collectRawLocals(toks, start, end, rawLocals);
      segments.push({ kind: 'raw', text: src.slice(toks[start].s, toks[end - 1].e) });
      p = end;
    }
  }
  flush();
  return segments;
}

const OPNAMES = ['PUSHK', 'GETG', 'SETG', 'BIN', 'UN', 'JMP', 'JMPF', 'JMPT', 'DUP', 'CALL', 'POP', 'RET', 'HALT'];

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
    const plain = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 32;
    out += plain ? String.fromCharCode(b) : '\\' + String(b).padStart(3, '0');
  }
  return out + '"';
};

const luaLit = (v) => {
  if (v === null) return 'nil';
  if (typeof v === 'string') return luaStr(v);
  if (typeof v === 'object') return v.num;
  return String(v);
};

function runtimeSource(name, OP, KEY) {
  return `local bit32 = bit32
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
}
local UN = {
  [1] = function(a) return -a end,
  [2] = function(a) return not a end,
  [3] = function(a) return #a end,
}
local function ${name}(K, C)
  local env = _G
  local stack, sp, pc = {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end
  local function arg(i) return bit32.bxor(C[i], ${KEY}) end
  local H = {}
  H[${OP.PUSHK}] = function(a) push(K[a + 1]) end
  H[${OP.GETG}] = function(a) push(env[K[a + 1]]) end
  H[${OP.SETG}] = function(a) env[K[a + 1]] = pop() end
  H[${OP.BIN}] = function(a) local b = pop(); local x = pop(); push(BIN[a](x, b)) end
  H[${OP.UN}] = function(a) push(UN[a](pop())) end
  H[${OP.JMP}] = function(a) pc = a * 2 + 1 end
  H[${OP.JMPF}] = function(a) local c = pop(); if c == nil or c == false then pc = a * 2 + 1 end end
  H[${OP.JMPT}] = function(a) local c = pop(); if c ~= nil and c ~= false then pc = a * 2 + 1 end end
  H[${OP.DUP}] = function() push(stack[sp]) end
  H[${OP.CALL}] = function(n)
    local args = {}
    for i = n, 1, -1 do args[i] = pop() end
    local f = pop()
    push(f(table.unpack(args, 1, n)))
  end
  H[${OP.POP}] = function() pop() end
  H[${OP.RET}] = function() return "ret" end
  H[${OP.HALT}] = function() return "halt" end
  while true do
    local op, a = C[pc], arg(pc + 1)
    pc = pc + 2
    local h = H[op]
    if not h then error("VM: bad opcode") end
    local r = h(a)
    if r then return r == "ret" end
  end
end
`;
}

export function obfuscateDetailed(src) {
  const bin = utf8ToLatin1(src);
  const segments = compileSegments(bin);

  const pool = shuffle(Array.from({ length: 254 }, (_, i) => i + 1));
  const OP = {};
  OPNAMES.forEach((name, i) => { OP[name] = pool[i]; });
  const KEY = randInt(1, 0x7fffff);
  const name = '__vm' + randHex(4);

  const parts = [runtimeSource(name, OP, KEY)];
  let vm = 0;
  let raw = 0;
  for (const seg of segments) {
    if (seg.kind === 'vm') {
      vm++;
      const flat = [];
      for (const { op, a } of seg.code) flat.push(OP[op], (a ^ KEY) >>> 0);
      parts.push(`if ${name}({ ${seg.consts.map(luaLit).join(', ')} }, { ${flat.join(', ')} }) then return end`);
    } else {
      raw++;
      parts.push(latin1ToUtf8(seg.text));
    }
  }
  return { code: parts.join('\n') + '\n', vm, raw };
}

export const obfuscate = (src) => obfuscateDetailed(src).code;

