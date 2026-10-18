from frontend.diagnostics import LuaRuntimeError

MAXCAPTURES = 32
MAXCCALLS = 200
CAP_UNFINISHED = -1
CAP_POSITION = -2
SPECIALS = frozenset("^$*+?.([%-")


def _ascii_set(predicate):
    return frozenset(chr(i) for i in range(128) if predicate(i))


_ALPHA = _ascii_set(lambda c: 65 <= c <= 90 or 97 <= c <= 122)
_DIGIT = _ascii_set(lambda c: 48 <= c <= 57)
_LOWER = _ascii_set(lambda c: 97 <= c <= 122)
_UPPER = _ascii_set(lambda c: 65 <= c <= 90)
_SPACE = _ascii_set(lambda c: c == 32 or 9 <= c <= 13)
_CNTRL = _ascii_set(lambda c: c < 32 or c == 127)
_PUNCT = _ascii_set(lambda c: 33 <= c <= 126 and not (65 <= c <= 90 or 97 <= c <= 122 or 48 <= c <= 57))
_XDIGIT = _ascii_set(lambda c: 48 <= c <= 57 or 65 <= c <= 70 or 97 <= c <= 102)
_GRAPH = _ascii_set(lambda c: 33 <= c <= 126)
_ALNUM = _ALPHA | _DIGIT

_CLASS_SETS = {
    "a": _ALPHA,
    "c": _CNTRL,
    "d": _DIGIT,
    "g": _GRAPH,
    "l": _LOWER,
    "p": _PUNCT,
    "s": _SPACE,
    "u": _UPPER,
    "w": _ALNUM,
    "x": _XDIGIT,
}


def _match_class(c, cl):
    lower = cl.lower()
    if lower == "z":
        res = c == "\0"
    elif lower in _CLASS_SETS:
        res = c in _CLASS_SETS[lower]
    else:
        return cl == c
    if cl in _UPPER:
        return not res
    return res


class _State:
    __slots__ = ("src", "pat", "level", "capture", "depth")

    def __init__(self, src, pat):
        self.src = src
        self.pat = pat
        self.level = 0
        self.capture = []
        self.depth = 0

    def reset(self):
        self.level = 0
        self.capture = []
        self.depth = 0


def _class_end(ms, p):
    pat = ms.pat
    n = len(pat)
    c = pat[p]
    p += 1
    if c == "%":
        if p >= n:
            raise LuaRuntimeError("malformed pattern (ends with '%')")
        return p + 1
    if c == "[":
        if p < n and pat[p] == "^":
            p += 1
        while True:
            if p >= n:
                raise LuaRuntimeError("malformed pattern (missing ']')")
            cc = pat[p]
            p += 1
            if cc == "%" and p < n:
                p += 1
            if p >= n:
                raise LuaRuntimeError("malformed pattern (missing ']')")
            if pat[p] == "]":
                break
        return p + 1
    return p


def _bracket_match(ms, c, p, ec):
    pat = ms.pat
    sig = True
    if pat[p + 1] == "^":
        sig = False
        p += 1
    p += 1
    while p < ec:
        if pat[p] == "%":
            p += 1
            if _match_class(c, pat[p]):
                return sig
        elif pat[p + 1] == "-" and p + 2 < ec:
            if pat[p] <= c <= pat[p + 2]:
                return sig
            p += 2
        elif pat[p] == c:
            return sig
        p += 1
    return not sig


def _single_match(ms, s, p, ep):
    if s >= len(ms.src):
        return False
    c = ms.src[s]
    pc = ms.pat[p]
    if pc == ".":
        return True
    if pc == "%":
        return _match_class(c, ms.pat[p + 1])
    if pc == "[":
        return _bracket_match(ms, c, p, ep - 1)
    return pc == c


def _match_balance(ms, s, p):
    pat = ms.pat
    src = ms.src
    if p + 1 >= len(pat):
        raise LuaRuntimeError("unbalanced pattern")
    if s >= len(src) or src[s] != pat[p]:
        return None
    b, e = pat[p], pat[p + 1]
    cont = 1
    i = s + 1
    while i < len(src):
        c = src[i]
        if c == e:
            cont -= 1
            if cont == 0:
                return i + 1
        elif c == b:
            cont += 1
        i += 1
    return None


def _max_expand(ms, s, p, ep):
    i = 0
    while _single_match(ms, s + i, p, ep):
        i += 1
    while i >= 0:
        res = _do_match(ms, s + i, ep + 1)
        if res is not None:
            return res
        i -= 1
    return None


def _min_expand(ms, s, p, ep):
    while True:
        res = _do_match(ms, s, ep + 1)
        if res is not None:
            return res
        if _single_match(ms, s, p, ep):
            s += 1
        else:
            return None


def _start_capture(ms, s, p, what):
    if ms.level >= MAXCAPTURES:
        raise LuaRuntimeError("too many captures")
    ms.capture.append([s, what])
    ms.level += 1
    res = _do_match(ms, s, p)
    if res is None:
        ms.level -= 1
        ms.capture.pop()
    return res


def _capture_to_close(ms):
    level = ms.level - 1
    while level >= 0:
        if ms.capture[level][1] == CAP_UNFINISHED:
            return level
        level -= 1
    raise LuaRuntimeError("invalid pattern capture")


def _end_capture(ms, s, p):
    lvl = _capture_to_close(ms)
    ms.capture[lvl][1] = s - ms.capture[lvl][0]
    res = _do_match(ms, s, p)
    if res is None:
        ms.capture[lvl][1] = CAP_UNFINISHED
    return res


def _check_capture(ms, ch):
    idx = ord(ch) - ord("1")
    if idx < 0 or idx >= ms.level or ms.capture[idx][1] == CAP_UNFINISHED:
        raise LuaRuntimeError(f"invalid capture index %{idx + 1}")
    return idx


def _match_capture(ms, s, ch):
    idx = _check_capture(ms, ch)
    init, length = ms.capture[idx]
    cap = ms.src[init:init + length]
    if ms.src.startswith(cap, s):
        return s + len(cap)
    return None


def _match_inner(ms, s, p):
    pat = ms.pat
    src = ms.src
    plen = len(pat)
    while True:
        if p >= plen:
            return s
        pc = pat[p]
        if pc == "(":
            if p + 1 < plen and pat[p + 1] == ")":
                return _start_capture(ms, s, p + 2, CAP_POSITION)
            return _start_capture(ms, s, p + 1, CAP_UNFINISHED)
        if pc == ")":
            return _end_capture(ms, s, p + 1)
        if pc == "$" and p + 1 == plen:
            return s if s == len(src) else None
        if pc == "%" and p + 1 < plen:
            nc = pat[p + 1]
            if nc == "b":
                s = _match_balance(ms, s, p + 2)
                if s is None:
                    return None
                p += 4
                continue
            if nc == "f":
                p += 2
                if p >= plen or pat[p] != "[":
                    raise LuaRuntimeError("missing '[' after '%f' in pattern")
                ep = _class_end(ms, p)
                prev = src[s - 1] if s > 0 else "\0"
                cur = src[s] if s < len(src) else "\0"
                if not _bracket_match(ms, prev, p, ep - 1) and _bracket_match(ms, cur, p, ep - 1):
                    p = ep
                    continue
                return None
            if "0" <= nc <= "9":
                s = _match_capture(ms, s, nc)
                if s is None:
                    return None
                p += 2
                continue
        ep = _class_end(ms, p)
        epc = pat[ep] if ep < plen else ""
        if not _single_match(ms, s, p, ep):
            if epc in ("*", "?", "-"):
                p = ep + 1
                continue
            return None
        if epc == "?":
            res = _do_match(ms, s + 1, ep + 1)
            if res is not None:
                return res
            p = ep + 1
            continue
        if epc == "+":
            return _max_expand(ms, s + 1, p, ep)
        if epc == "*":
            return _max_expand(ms, s, p, ep)
        if epc == "-":
            return _min_expand(ms, s, p, ep)
        s += 1
        p = ep


def _do_match(ms, s, p):
    ms.depth += 1
    try:
        if ms.depth > MAXCCALLS:
            raise LuaRuntimeError("pattern too complex")
        return _match_inner(ms, s, p)
    finally:
        ms.depth -= 1


def has_specials(pattern):
    return any(ch in SPECIALS for ch in pattern)


def search(src, pat, init):
    ms = _State(src, pat)
    anchor = pat[:1] == "^"
    p0 = 1 if anchor else 0
    s = init
    while True:
        ms.reset()
        end = _do_match(ms, s, p0)
        if end is not None:
            return ms, s, end
        if anchor or s >= len(src):
            return None
        s += 1


def get_capture(ms, i, s, e):
    if i >= ms.level:
        if i == 0:
            return ms.src[s:e]
        raise LuaRuntimeError(f"invalid capture index %{i + 1}")
    init, length = ms.capture[i]
    if length == CAP_POSITION:
        return float(init + 1)
    if length == CAP_UNFINISHED:
        raise LuaRuntimeError("unfinished capture")
    return ms.src[init:init + length]


def captures(ms, s, e, whole_if_none):
    count = 1 if ms.level == 0 and whole_if_none else ms.level
    return [get_capture(ms, i, s, e) for i in range(count)]


def new_state(src, pat):
    return _State(src, pat)


def match_from(ms, s, p):
    ms.reset()
    return _do_match(ms, s, p)
