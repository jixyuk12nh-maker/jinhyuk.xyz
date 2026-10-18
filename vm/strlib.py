import math

from frontend.diagnostics import LuaRuntimeError
from vm import lpattern
from vm.values import LuaTable, NativeFunction, to_display, truthy, type_name

FORMAT_FLAGS = "-+ #0"
UNSIGNED_MASK = (1 << 64) - 1


def _arg(args, i):
    return args[i] if i < len(args) else None


def _str(args, i, name):
    value = _arg(args, i)
    if isinstance(value, float):
        return to_display(value)
    if not isinstance(value, str):
        raise LuaRuntimeError(f"bad argument #{i + 1} to '{name}' (string expected, got {type_name(value)})")
    return value


def _int(args, i, name, default=None):
    value = _arg(args, i)
    if value is None and default is not None:
        return default
    if not isinstance(value, float):
        raise LuaRuntimeError(f"bad argument #{i + 1} to '{name}' (number expected, got {type_name(value)})")
    return int(value)


def _posrelat(pos, length):
    if pos >= 0:
        return pos
    if -pos > length:
        return 0
    return length + pos + 1


def _start_index(init, length):
    init = _posrelat(init, length) - 1
    if init < 0:
        return 0
    if init > length:
        return length
    return init


def _find_aux(args, find):
    name = "string.find" if find else "string.match"
    src = _str(args, 0, name)
    pat = _str(args, 1, name)
    init = _start_index(_int(args, 2, name, 1), len(src))
    plain = find and truthy(_arg(args, 3))
    if find and (plain or not lpattern.has_specials(pat)):
        pos = src.find(pat, init)
        if pos < 0:
            return [None]
        return [float(pos + 1), float(pos + len(pat))]
    found = lpattern.search(src, pat, init)
    if found is None:
        return [None]
    ms, s, e = found
    if find:
        return [float(s + 1), float(e)] + lpattern.captures(ms, s, e, False)
    return lpattern.captures(ms, s, e, True)


def string_find(args):
    return _find_aux(args, True)


def string_match(args):
    return _find_aux(args, False)


def string_gmatch(args):
    src = _str(args, 0, "string.gmatch")
    pat = _str(args, 1, "string.gmatch")
    state = {"pos": 0, "last": None}
    ms = lpattern.new_state(src, pat)

    def step(_):
        pos = state["pos"]
        while pos <= len(src):
            end = lpattern.match_from(ms, pos, 0)
            if end is not None and end != state["last"]:
                state["pos"] = state["last"] = end
                return lpattern.captures(ms, pos, end, True)
            pos += 1
        state["pos"] = pos
        return [None]

    return [NativeFunction("gmatch_iter", step)]


def _add_value(vm, ms, s, e, repl, out):
    if isinstance(repl, str):
        i = 0
        n = len(repl)
        while i < n:
            ch = repl[i]
            if ch != "%":
                out.append(ch)
                i += 1
                continue
            i += 1
            if i >= n:
                raise LuaRuntimeError("invalid use of '%' in replacement string")
            nxt = repl[i]
            if nxt == "%":
                out.append("%")
            elif "0" <= nxt <= "9":
                if nxt == "0":
                    out.append(ms.src[s:e])
                else:
                    value = lpattern.get_capture(ms, ord(nxt) - ord("1"), s, e)
                    out.append(to_display(value))
            else:
                raise LuaRuntimeError("invalid use of '%' in replacement string")
            i += 1
        return
    if isinstance(repl, LuaTable):
        value = repl.get(lpattern.get_capture(ms, 0, s, e))
    else:
        result = vm._call(repl, lpattern.captures(ms, s, e, True))
        value = result[0] if result else None
    if value is None or value is False:
        out.append(ms.src[s:e])
    elif isinstance(value, (str, float)):
        out.append(to_display(value))
    else:
        raise LuaRuntimeError(f"invalid replacement value (a {type_name(value)})")


def make_gsub(vm):
    def string_gsub(args):
        src = _str(args, 0, "string.gsub")
        pat = _str(args, 1, "string.gsub")
        repl = _arg(args, 2)
        if not (isinstance(repl, (str, float, LuaTable)) or type_name(repl) == "function"):
            raise LuaRuntimeError("bad argument #3 to 'gsub' (string/function/table expected)")
        if isinstance(repl, float):
            repl = to_display(repl)
        max_n = _int(args, 3, "string.gsub", len(src) + 1)
        anchor = pat[:1] == "^"
        p0 = 1 if anchor else 0
        ms = lpattern.new_state(src, pat)
        out = []
        pos = 0
        count = 0
        while count < max_n:
            end = lpattern.match_from(ms, pos, p0)
            if end is not None:
                count += 1
                _add_value(vm, ms, pos, end, repl, out)
            if end is not None and end > pos:
                pos = end
            elif pos < len(src):
                out.append(src[pos])
                pos += 1
            else:
                break
            if anchor:
                break
        out.append(src[pos:])
        return ["".join(out), float(count)]

    return string_gsub


def _quote(value):
    if isinstance(value, float):
        return "%.17g" % value
    out = ['"']
    for ch in value:
        if ch in '"\\\n':
            out.append("\\" + ch)
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\0":
            out.append("\\000")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def make_format():
    def string_format(args):
        fmt = _str(args, 0, "string.format")
        out = []
        argi = 1
        i = 0
        n = len(fmt)
        while i < n:
            ch = fmt[i]
            if ch != "%":
                out.append(ch)
                i += 1
                continue
            i += 1
            if i < n and fmt[i] == "%":
                out.append("%")
                i += 1
                continue
            start = i
            while i < n and fmt[i] in FORMAT_FLAGS:
                i += 1
            while i < n and fmt[i].isdigit():
                i += 1
            if i < n and fmt[i] == ".":
                i += 1
                while i < n and fmt[i].isdigit():
                    i += 1
            if i >= n:
                raise LuaRuntimeError("invalid option to 'format'")
            conv = fmt[i]
            spec = fmt[start:i]
            i += 1
            if argi >= len(args):
                raise LuaRuntimeError(f"bad argument #{argi + 1} to 'format' (no value)")
            value = args[argi]
            argi += 1
            out.append(_format_one(spec, conv, value, argi))
        return ["".join(out)]

    return string_format


def _format_one(spec, conv, value, argi):
    if conv in "di":
        number = _number_arg(value, argi)
        return ("%" + spec + "d") % _to_int(number)
    if conv in "uxXo":
        number = _number_arg(value, argi)
        integer = _to_int(number) & UNSIGNED_MASK
        if conv == "u":
            return ("%" + spec + "d") % integer
        return ("%" + spec + conv) % integer
    if conv in "eEfFgG":
        number = _number_arg(value, argi)
        return ("%" + spec + conv) % number
    if conv == "c":
        number = _number_arg(value, argi)
        return ("%" + spec + "s") % chr(_to_int(number) & 0xFF)
    if conv == "s":
        text = to_display(value)
        return ("%" + spec + "s") % text
    if conv == "q":
        if not isinstance(value, (str, float)):
            raise LuaRuntimeError("bad argument to 'format' (string/number expected for %q)")
        return _quote(value)
    raise LuaRuntimeError(f"invalid option '%{conv}' to 'format'")


def _number_arg(value, argi):
    if not isinstance(value, float):
        raise LuaRuntimeError(f"bad argument #{argi} to 'format' (number expected, got {type_name(value)})")
    return value


def _to_int(number):
    if math.isnan(number) or math.isinf(number):
        raise LuaRuntimeError("number has no integer representation")
    return int(number)
