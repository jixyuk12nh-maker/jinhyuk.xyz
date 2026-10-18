import bisect
from dataclasses import dataclass

from frontend.diagnostics import CompileError, SourceLocation

KEYWORDS = frozenset({
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
    "until", "while",
})

SYMBOLS = (
    "...", "..", "==", "~=", "<=", ">=", "//", "::",
    "+", "-", "*", "/", "%", "^", "#", "<", ">", "=",
    "(", ")", "{", "}", "[", "]", ";", ":", ",", ".",
)

SIMPLE_ESCAPES = {
    "a": "\a", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v",
    "\\": "\\", '"': '"', "'": "'", "\n": "\n",
}

HEX_DIGITS = frozenset("0123456789abcdefABCDEF")

@dataclass(frozen=True)
class Token:
    kind: str
    value: object
    loc: SourceLocation

class _Locator:
    def __init__(self, source, file):
        self._file = file
        self._starts = [0] + [i + 1 for i, ch in enumerate(source) if ch == "\n"]

    def at(self, pos):
        line = bisect.bisect_right(self._starts, pos)
        return SourceLocation(self._file, line, pos - self._starts[line - 1] + 1)

def _is_digit(ch):
    return "0" <= ch <= "9"

def _is_ident_start(ch):
    return ch.isascii() and (ch.isalpha() or ch == "_")

def _is_ident_char(ch):
    return _is_ident_start(ch) or _is_digit(ch)

def _bracket_level(source, i):
    n = len(source)
    if i >= n or source[i] != "[":
        return None
    j = i + 1
    while j < n and source[j] == "=":
        j += 1
    if j < n and source[j] == "[":
        return j - i - 1
    return None

def _read_long_bracket(source, i, loc, what):
    level = _bracket_level(source, i)
    closer = "]" + "=" * level + "]"
    start = i + level + 2
    if source.startswith("\r\n", start):
        start += 2
    elif source.startswith("\n", start):
        start += 1
    end = source.find(closer, start)
    if end < 0:
        raise CompileError(loc.at(i), f"{what}이(가) 닫히지 않았습니다")
    return end + len(closer), source[start:end]

def _skip_trivia(source, i, loc):
    n = len(source)
    while i < n:
        ch = source[i]
        if ch in " \t\r\n\f\v":
            i += 1
        elif source.startswith("--", i):
            if _bracket_level(source, i + 2) is not None:
                i, _ = _read_long_bracket(source, i + 2, loc, "블록 주석")
            else:
                end = source.find("\n", i)
                i = n if end < 0 else end
        else:
            break
    return i

def _read_number(source, i, loc):
    n = len(source)
    if source.startswith(("0x", "0X"), i):
        j = i + 2
        k = j
        while k < n and source[k] in HEX_DIGITS:
            k += 1
        if k == j or (k < n and _is_ident_char(source[k])):
            raise CompileError(loc.at(i), "잘못된 16진수 리터럴입니다")
        return k, float(int(source[j:k], 16))
    j = i
    while j < n and _is_digit(source[j]):
        j += 1
    if j < n and source[j] == ".":
        j += 1
        while j < n and _is_digit(source[j]):
            j += 1
    if j < n and source[j] in "eE":
        k = j + 1
        if k < n and source[k] in "+-":
            k += 1
        if k < n and _is_digit(source[k]):
            while k < n and _is_digit(source[k]):
                k += 1
            j = k
        else:
            raise CompileError(loc.at(i), "잘못된 숫자 리터럴입니다")
    if j < n and _is_ident_char(source[j]):
        raise CompileError(loc.at(i), "잘못된 숫자 리터럴입니다")
    return j, float(source[i:j])

def _read_string(source, i, loc):
    quote = source[i]
    n = len(source)
    j = i + 1
    parts = []
    while True:
        if j >= n or source[j] == "\n":
            raise CompileError(loc.at(i), "문자열이 닫히지 않았습니다")
        ch = source[j]
        if ch == quote:
            return j + 1, "".join(parts)
        if ch != "\\":
            parts.append(ch)
            j += 1
            continue
        if j + 1 >= n:
            raise CompileError(loc.at(i), "문자열이 닫히지 않았습니다")
        esc = source[j + 1]
        if esc in SIMPLE_ESCAPES:
            parts.append(SIMPLE_ESCAPES[esc])
            j += 2
        elif _is_digit(esc):
            k = j + 1
            while k < n and k - (j + 1) < 3 and _is_digit(source[k]):
                k += 1
            value = int(source[j + 1:k])
            if value > 255:
                raise CompileError(loc.at(j), "이스케이프 값은 255 이하여야 합니다")
            parts.append(chr(value))
            j = k
        elif esc == "x":
            digits = source[j + 2:j + 4]
            if len(digits) != 2 or any(c not in HEX_DIGITS for c in digits):
                raise CompileError(loc.at(j), "\\x 뒤에는 16진수 두 자리가 필요합니다")
            parts.append(chr(int(digits, 16)))
            j += 4
        elif esc == "z":
            j += 2
            while j < n and source[j] in " \t\r\n\f\v":
                j += 1
        else:
            raise CompileError(loc.at(j), f"지원하지 않는 이스케이프 문자 '\\{esc}'")

def tokenize(source, file):
    loc = _Locator(source, file)
    tokens = []
    n = len(source)
    i = 0
    while True:
        i = _skip_trivia(source, i, loc)
        if i >= n:
            tokens.append(Token("EOF", None, loc.at(n)))
            return tokens
        ch = source[i]
        if _is_ident_start(ch):
            j = i + 1
            while j < n and _is_ident_char(source[j]):
                j += 1
            word = source[i:j]
            kind = "KEYWORD" if word in KEYWORDS else "NAME"
            tokens.append(Token(kind, word, loc.at(i)))
            i = j
        elif _is_digit(ch) or (ch == "." and i + 1 < n and _is_digit(source[i + 1])):
            j, value = _read_number(source, i, loc)
            tokens.append(Token("NUMBER", value, loc.at(i)))
            i = j
        elif ch in "\"'":
            j, value = _read_string(source, i, loc)
            tokens.append(Token("STRING", value, loc.at(i)))
            i = j
        elif ch == "[" and _bracket_level(source, i) is not None:
            j, value = _read_long_bracket(source, i, loc, "긴 문자열")
            tokens.append(Token("STRING", value, loc.at(i)))
            i = j
        else:
            sym = next((s for s in SYMBOLS if source.startswith(s, i)), None)
            if sym is None:
                raise CompileError(loc.at(i), f"알 수 없는 문자 '{ch}'")
            tokens.append(Token("SYMBOL", sym, loc.at(i)))
            i += len(sym)
