// 무작위 Lua 프로그램 생성기 (결정적 출력: 숫자만 쓰고 print로 확인). 시드로 재현 가능.
export function makeGen(seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  function gen() {
    const vars = [];   // 현재 스코프의 숫자 지역 변수
    const fns = [];    // 정의된 함수 이름 (인자 1개, 숫자 반환)
    const tabs = [];   // 테이블 이름
    let nameId = 0;
    const newName = (p) => `${p}${nameId++}`;
    const lit = () => (rnd() < 0.7 ? String(int(-20, 50)) : (int(1, 9) + '.' + int(0, 9)));
    function expr(d) {
      const r = rnd();
      if (d <= 0 || r < 0.25) {
        const q = rnd();
        if (q < 0.5 || vars.length === 0) return lit();
        return pick(vars);
      }
      if (r < 0.45) return `(${expr(d - 1)} ${pick(['+', '-', '*'])} ${expr(d - 1)})`;
      if (r < 0.55) return `(- ${expr(d - 1)})`;
      if (r < 0.62 && fns.length) return `${pick(fns)}(${expr(d - 1)})`;
      if (r < 0.70 && tabs.length) return `${pick(tabs)}[${int(1, 4)}]`;
      if (r < 0.78) return `math.floor(${expr(d - 1)})`;
      if (r < 0.85) return `select("#", ${expr(d - 1)}, ${expr(d - 1)})`;
      return `(${expr(d - 1)} ${pick(['+', '*'])} ${int(1, 3)})`;
    }
    function cond(d) {
      return `${expr(d)} ${pick(['<', '<=', '>', '>=', '==', '~='])} ${expr(d)}`;
    }
    function block(d, n) {
      const out = [];
      const saved = [vars.length, fns.length, tabs.length];
      for (let i = 0; i < n; i++) out.push(stmt(d));
      vars.length = saved[0]; fns.length = saved[1]; tabs.length = saved[2];
      return out.join('\n');
    }
    function stmt(d) {
      const r = rnd();
      if (d <= 0 || r < 0.22) {
        const e = expr(2);
        const v = newName('v'); vars.push(v);
        return `local ${v} = ${e}`;
      }
      if (r < 0.32 && vars.length) return `${pick(vars)} = ${expr(2)}`;
      if (r < 0.40 && vars.length >= 2) {
        const a = pick(vars), b = pick(vars);
        return `${a}, ${b} = ${b}, ${a}`;
      }
      if (r < 0.48) return `if ${cond(2)} then\n${block(d - 1, int(1, 3))}\nelse\n${block(d - 1, int(0, 2))}\nend`;
      if (r < 0.56) {
        const i = newName('i');
        const saved = vars.length;
        vars.push(i);
        const body = block(d - 1, int(1, 3));
        vars.length = saved;
        return `for ${i} = ${int(1, 3)}, ${int(2, 6)} do\n${body}\nend`;
      }
      if (r < 0.62) {
        const c = newName('c');
        return `do local ${c} = 0 while ${c} < ${int(1, 4)} do ${c} = ${c} + 1\n${block(d - 1, int(1, 2))}\nend end`;
      }
      if (r < 0.70) {
        const f = newName('f');
        const body = (() => { const saved = vars.slice(); vars.length = 0; vars.push('p'); const b = `return ${expr(2)}`; vars.length = 0; saved.forEach((x) => vars.push(x)); return b; })();
        fns.push(f);
        return `local function ${f}(p) ${body} end`;
      }
      if (r < 0.76) {
        const e = [expr(1), expr(1), expr(1), expr(1)];
        const t = newName('t'); tabs.push(t);
        return `local ${t} = {${e.join(', ')}}`;
      }
      if (r < 0.82 && vars.length) return `print(${pick(vars)})`;
      if (r < 0.88) {
        const e1 = expr(1), e2 = expr(1);
        const cap = vars.length ? pick(vars) : '0';
        const v = newName('k'); vars.push(v);
        return `local ${v} = (function(x) local acc = x return function(y) acc = acc + y + ${cap} return acc end end)(${e1})(${e2})`;
      }
      if (r < 0.94) return `print(select("#", ${expr(1)}, ${expr(1)}))`;
      return `local _ = ${expr(1)}`;
    }
    const lines = [];
    const n = int(8, 30);
    for (let i = 0; i < n; i++) lines.push(stmt(3));
    const shown = [...new Set(vars)];
    lines.push(...shown.map((v) => `print(${v})`));
    lines.push(...tabs.map((t) => `print(${t}[1], ${t}[2], #${t})`));
    return lines.join('\n') + '\n';
  }
  return gen();
}
