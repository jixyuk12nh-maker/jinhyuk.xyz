import functools
import math
import random

from frontend.diagnostics import LuaRuntimeError
from vm.corolib import make_coroutine_lib
from vm.iolib import make_io_lib
from vm.loaderlib import make_loader_lib
from vm.oslib import make_os_lib
from vm.strlib import make_format, make_gsub, string_find, string_gmatch, string_match
from vm.values import (
    LuaFunction, LuaTable, LuaUserdata, NativeFunction, coerce_number, to_display, truthy, type_name,
)


def _arg(args, i):
    return args[i] if i < len(args) else None


def _check_table(args, i, name):
    value = _arg(args, i)
    if not isinstance(value, LuaTable):
        raise LuaRuntimeError(f"{name}: 테이블 인자가 필요합니다 (인자 {i + 1})")
    return value


def _check_number(args, i, name):
    value = _arg(args, i)
    if not isinstance(value, float):
        raise LuaRuntimeError(f"{name}: 숫자 인자가 필요합니다 (인자 {i + 1})")
    return value


def _check_string(args, i, name):
    value = _arg(args, i)
    if isinstance(value, float):
        return to_display(value)
    if not isinstance(value, str):
        raise LuaRuntimeError(f"{name}: 문자열 인자가 필요합니다 (인자 {i + 1})")
    return value


def _string_index(i, length):
    if i > 0:
        return i
    if i == 0:
        return 1
    return max(length + i + 1, 1)


def error_value(exc):
    return exc.value if hasattr(exc, "value") else str(exc)


def tostring_value(vm, value):
    if isinstance(value, (LuaTable, LuaUserdata)):
        handler = vm.metamethod(value, "__tostring")
        if handler is not None:
            result = vm.call1(handler, [value])
            if not isinstance(result, str):
                raise LuaRuntimeError("'__tostring'은 문자열을 반환해야 합니다")
            return result
    return to_display(value)


def lib(entries):
    table = LuaTable()
    for key, value in entries.items():
        table.set(key, value)
    return table


def native(name, fn):
    return NativeFunction(name, fn)


def make_globals(vm):
    out = vm.output
    globals_table = LuaTable()

    def lua_print(args):
        out.write("\t".join(to_display(v) for v in args) + "\n")
        return []

    def lua_type(args):
        return [type_name(_arg(args, 0)) if args else "nil"]

    def lua_tostring(args):
        return [tostring_value(vm, _arg(args, 0))]

    def lua_tonumber(args):
        value = _arg(args, 0)
        base = _arg(args, 1)
        if base is None:
            return [coerce_number(value)]
        text = _check_string(args, 0, "tonumber").strip().lower()
        try:
            return [float(int(text, int(base)))]
        except ValueError:
            return [None]

    def lua_select(args):
        n = _arg(args, 0)
        rest = list(args[1:])
        if n == "#":
            return [float(len(rest))]
        index = int(_check_number(args, 0, "select"))
        if index < 0:
            index = len(rest) + index + 1
        if index < 1:
            raise LuaRuntimeError("select: 인덱스가 범위를 벗어났습니다")
        return rest[index - 1:]

    def lua_next(args):
        table = _check_table(args, 0, "next")
        found = table.next(_arg(args, 1))
        return [None] if found is None else [found[0], found[1]]

    def ipairs_iter(args):
        table = _check_table(args, 0, "ipairs")
        index = _check_number(args, 1, "ipairs") + 1.0
        value = table.get(index)
        return [None] if value is None else [index, value]

    def lua_pairs(args):
        table = _check_table(args, 0, "pairs")
        return [next_fn, table, None]

    def lua_ipairs(args):
        table = _check_table(args, 0, "ipairs")
        return [ipairs_fn, table, 0.0]

    def lua_assert(args):
        if not args or not truthy(args[0]):
            message = _arg(args, 1)
            raise LuaRuntimeError("assertion failed!" if message is None else to_display(message))
        return list(args)

    def lua_error(args):
        value = _arg(args, 0)
        exc = LuaRuntimeError(to_display(value))
        exc.value = value
        raise exc

    def lua_pcall(args):
        if not args:
            raise LuaRuntimeError("pcall: 함수 인자가 필요합니다")
        try:
            return [True] + list(vm._call(args[0], list(args[1:])))
        except LuaRuntimeError as exc:
            return [False, error_value(exc)]

    def lua_xpcall(args):
        handler = _arg(args, 1)
        try:
            return [True] + list(vm._call(_arg(args, 0), list(args[2:])))
        except LuaRuntimeError as exc:
            return [False, vm.call1(handler, [error_value(exc)])]

    def lua_rawget(args):
        table = _check_table(args, 0, "rawget")
        key = _arg(args, 1)
        return [None if key is None else table.get(key)]

    def lua_rawset(args):
        table = _check_table(args, 0, "rawset")
        table.set(_arg(args, 1), _arg(args, 2))
        return [table]

    def lua_rawequal(args):
        x, y = _arg(args, 0), _arg(args, 1)
        return [type(x) is type(y) and x == y]

    def lua_getmetatable(args):
        mt = vm.get_metatable(_arg(args, 0))
        if mt is None:
            return [None]
        protected = mt.get("__metatable")
        return [mt if protected is None else protected]

    def lua_setmetatable(args):
        table = _arg(args, 0)
        if not isinstance(table, LuaTable):
            raise LuaRuntimeError("setmetatable: 테이블 인자가 필요합니다 (인자 1)")
        mt = _arg(args, 1)
        if mt is not None and not isinstance(mt, LuaTable):
            raise LuaRuntimeError("setmetatable: nil 또는 테이블 인자가 필요합니다 (인자 2)")
        if table.meta is not None and table.meta.get("__metatable") is not None:
            raise LuaRuntimeError("cannot change a protected metatable")
        table.meta = mt
        return [table]

    def lua_getfenv(args):
        target = _arg(args, 0)
        if isinstance(target, LuaFunction):
            return [target.env]
        level = 1 if target is None else int(_check_number(args, 0, "getfenv"))
        if level == 0:
            return [globals_table]
        if level < 0 or level > len(vm.frames):
            raise LuaRuntimeError("getfenv: 잘못된 레벨입니다")
        return [vm.frames[-level].env]

    def lua_setfenv(args):
        target = _arg(args, 0)
        env = _arg(args, 1)
        if not isinstance(env, LuaTable):
            raise LuaRuntimeError("setfenv: 테이블 환경이 필요합니다 (인자 2)")
        if isinstance(target, LuaFunction):
            target.env = env
            return [target]
        if isinstance(target, NativeFunction):
            raise LuaRuntimeError("'setfenv': 네이티브 함수의 환경은 바꿀 수 없습니다")
        level = int(_check_number(args, 0, "setfenv"))
        if level < 1 or level > len(vm.frames):
            raise LuaRuntimeError("setfenv: 잘못된 레벨입니다")
        vm.frames[-level].env = env
        return [vm.frames[-level]]

    def lua_newproxy(args):
        flag = _arg(args, 0)
        return [LuaUserdata(None, LuaTable() if truthy(flag) else None)]

    def lua_collectgarbage(args):
        return [0.0]

    def lua_gcinfo(args):
        return [0.0]

    def lua_unpack(args):
        table = _check_table(args, 0, "unpack")
        i = int(_arg(args, 1) or 1.0)
        j = int(_arg(args, 2)) if _arg(args, 2) is not None else table.length()
        return [table.get(float(k)) for k in range(i, j + 1)]

    def table_insert(args):
        table = _check_table(args, 0, "table.insert")
        if len(args) == 2:
            table.set(float(table.length() + 1), args[1])
        elif len(args) == 3:
            pos = int(_check_number(args, 1, "table.insert"))
            length = table.length()
            for k in range(length, pos - 1, -1):
                table.set(float(k + 1), table.get(float(k)))
            table.set(float(pos), args[2])
        else:
            raise LuaRuntimeError("table.insert: 잘못된 인자 개수입니다")
        return []

    def table_remove(args):
        table = _check_table(args, 0, "table.remove")
        length = table.length()
        if length == 0:
            return [None]
        pos = int(_arg(args, 1)) if _arg(args, 1) is not None else length
        value = table.get(float(pos))
        for k in range(pos, length):
            table.set(float(k), table.get(float(k + 1)))
        table.set(float(length), None)
        return [value]

    def table_getn(args):
        return [float(_check_table(args, 0, "table.getn").length())]

    def table_setn(args):
        raise LuaRuntimeError("'setn' is obsolete")

    def table_maxn(args):
        table = _check_table(args, 0, "table.maxn")
        best = 0.0
        key = None
        while True:
            found = table.next(key)
            if found is None:
                return [best]
            key = found[0]
            if isinstance(key, float) and key > best:
                best = key

    def table_sort(args):
        table = _check_table(args, 0, "table.sort")
        comp = _arg(args, 1)
        n = table.length()
        values = [table.get(float(k)) for k in range(1, n + 1)]

        def less(a, b):
            if comp is not None:
                result = vm._call(comp, [a, b])
                return bool(result) and truthy(result[0])
            if isinstance(a, float) and isinstance(b, float):
                return a < b
            if isinstance(a, str) and isinstance(b, str):
                return a < b
            raise LuaRuntimeError(f"attempt to compare {type_name(a)} with {type_name(b)}")

        def cmp(a, b):
            if less(a, b):
                return -1
            if less(b, a):
                return 1
            return 0

        values.sort(key=functools.cmp_to_key(cmp))
        for k, value in enumerate(values, 1):
            table.set(float(k), value)
        return []

    def table_foreach(args):
        table = _check_table(args, 0, "table.foreach")
        fn = _arg(args, 1)
        key = None
        while True:
            found = table.next(key)
            if found is None:
                return [None]
            key, value = found
            result = vm.call1(fn, [key, value])
            if result is not None:
                return [result]

    def table_foreachi(args):
        table = _check_table(args, 0, "table.foreachi")
        fn = _arg(args, 1)
        for i in range(1, table.length() + 1):
            result = vm.call1(fn, [float(i), table.get(float(i))])
            if result is not None:
                return [result]
        return [None]

    def table_concat(args):
        table = _check_table(args, 0, "table.concat")
        sep = _check_string(args, 1, "table.concat") if _arg(args, 1) is not None else ""
        parts = []
        for k in range(1, table.length() + 1):
            value = table.get(float(k))
            if not isinstance(value, (str, float)):
                raise LuaRuntimeError("table.concat: 문자열 또는 숫자 요소만 연결할 수 있습니다")
            parts.append(to_display(value))
        return [sep.join(parts)]

    def string_len(args):
        return [float(len(_check_string(args, 0, "string.len")))]

    def string_sub(args):
        text = _check_string(args, 0, "string.sub")
        length = len(text)
        i = int(_check_number(args, 1, "string.sub")) if _arg(args, 1) is not None else 1
        j = int(_arg(args, 2)) if _arg(args, 2) is not None else -1
        i = _string_index(i, length)
        if j < 0:
            j = length + j + 1
        elif j > length:
            j = length
        return [text[i - 1:j] if i <= j else ""]

    def string_rep(args):
        text = _check_string(args, 0, "string.rep")
        count = int(_check_number(args, 1, "string.rep"))
        return [text * max(count, 0)]

    def string_char(args):
        return ["".join(chr(int(_check_number(args, i, "string.char"))) for i in range(len(args)))]

    def string_byte(args):
        text = _check_string(args, 0, "string.byte")
        i = _string_index(int(_arg(args, 1) or 1.0), len(text))
        j = int(_arg(args, 2)) if _arg(args, 2) is not None else i
        return [float(ord(c)) for c in text[i - 1:j]]

    def string_dump(args):
        raise LuaRuntimeError("unable to dump given function")

    def math_floor(args):
        return [float(math.floor(_check_number(args, 0, "math.floor")))]

    def math_ceil(args):
        return [float(math.ceil(_check_number(args, 0, "math.ceil")))]

    def math_abs(args):
        return [abs(_check_number(args, 0, "math.abs"))]

    def math_sqrt(args):
        value = _check_number(args, 0, "math.sqrt")
        return [math.sqrt(value) if value >= 0 else math.nan]

    def math_max(args):
        return [max(_check_number(args, i, "math.max") for i in range(len(args)))]

    def math_min(args):
        return [min(_check_number(args, i, "math.min") for i in range(len(args)))]

    def math_fmod(args):
        x = _check_number(args, 0, "math.fmod")
        y = _check_number(args, 1, "math.fmod")
        return [math.nan if y == 0 else math.fmod(x, y)]

    def math_unary(name, fn):
        def run(args):
            value = _check_number(args, 0, name)
            try:
                return [float(fn(value))]
            except (ValueError, OverflowError):
                return [math.nan]
        return run

    def math_log(args):
        x = _check_number(args, 0, "math.log")
        if x == 0:
            return [-math.inf]
        if x < 0:
            return [math.nan]
        return [math.log(x)]

    def math_log10(args):
        x = _check_number(args, 0, "math.log10")
        if x == 0:
            return [-math.inf]
        if x < 0:
            return [math.nan]
        return [math.log10(x)]

    def math_pow(args):
        x = _check_number(args, 0, "math.pow")
        y = _check_number(args, 1, "math.pow")
        try:
            return [float(math.pow(x, y))]
        except (ValueError, ZeroDivisionError):
            return [math.nan]

    def math_atan2(args):
        return [math.atan2(_check_number(args, 0, "math.atan2"), _check_number(args, 1, "math.atan2"))]

    def math_modf(args):
        x = _check_number(args, 0, "math.modf")
        if math.isinf(x):
            return [x, 0.0]
        frac, whole = math.modf(x)
        return [float(whole), float(frac)]

    def math_frexp(args):
        m, e = math.frexp(_check_number(args, 0, "math.frexp"))
        return [float(m), float(e)]

    def math_ldexp(args):
        return [math.ldexp(_check_number(args, 0, "math.ldexp"), int(_check_number(args, 1, "math.ldexp")))]

    def math_random(args):
        if not args:
            return [random.random()]
        if len(args) == 1:
            low, high = 1, int(_check_number(args, 0, "math.random"))
        else:
            low = int(_check_number(args, 0, "math.random"))
            high = int(_check_number(args, 1, "math.random"))
        if high < low:
            raise LuaRuntimeError("math.random: 구간이 비어 있습니다")
        return [float(random.randint(low, high))]

    def math_randomseed(args):
        random.seed(_check_number(args, 0, "math.randomseed"))
        return []

    def math_deg(args):
        return [math.degrees(_check_number(args, 0, "math.deg"))]

    def math_rad(args):
        return [math.radians(_check_number(args, 0, "math.rad"))]

    next_fn = native("next", lua_next)
    ipairs_fn = native("ipairs_iter", ipairs_iter)

    base = {
        "print": native("print", lua_print),
        "type": native("type", lua_type),
        "tostring": native("tostring", lua_tostring),
        "tonumber": native("tonumber", lua_tonumber),
        "select": native("select", lua_select),
        "next": next_fn,
        "pairs": native("pairs", lua_pairs),
        "ipairs": native("ipairs", lua_ipairs),
        "assert": native("assert", lua_assert),
        "error": native("error", lua_error),
        "pcall": native("pcall", lua_pcall),
        "xpcall": native("xpcall", lua_xpcall),
        "rawget": native("rawget", lua_rawget),
        "rawset": native("rawset", lua_rawset),
        "rawequal": native("rawequal", lua_rawequal),
        "getmetatable": native("getmetatable", lua_getmetatable),
        "setmetatable": native("setmetatable", lua_setmetatable),
        "getfenv": native("getfenv", lua_getfenv),
        "setfenv": native("setfenv", lua_setfenv),
        "newproxy": native("newproxy", lua_newproxy),
        "unpack": native("unpack", lua_unpack),
        "collectgarbage": native("collectgarbage", lua_collectgarbage),
        "gcinfo": native("gcinfo", lua_gcinfo),
        "_VERSION": "Lua 5.1",
        "_G": globals_table,
    }
    for key, value in base.items():
        globals_table.set(key, value)

    table_lib = lib({
        "insert": native("table.insert", table_insert),
        "remove": native("table.remove", table_remove),
        "concat": native("table.concat", table_concat),
        "sort": native("table.sort", table_sort),
        "getn": native("table.getn", table_getn),
        "setn": native("table.setn", table_setn),
        "maxn": native("table.maxn", table_maxn),
        "foreach": native("table.foreach", table_foreach),
        "foreachi": native("table.foreachi", table_foreachi),
        "unpack": native("table.unpack", lua_unpack),
    })
    string_lib = lib({
        "len": native("string.len", string_len),
        "sub": native("string.sub", string_sub),
        "rep": native("string.rep", string_rep),
        "char": native("string.char", string_char),
        "byte": native("string.byte", string_byte),
        "dump": native("string.dump", string_dump),
        "upper": native("string.upper", lambda a: [_check_string(a, 0, "string.upper").upper()]),
        "lower": native("string.lower", lambda a: [_check_string(a, 0, "string.lower").lower()]),
        "reverse": native("string.reverse", lambda a: [_check_string(a, 0, "string.reverse")[::-1]]),
        "find": native("string.find", string_find),
        "match": native("string.match", string_match),
        "gmatch": native("string.gmatch", string_gmatch),
        "gsub": native("string.gsub", make_gsub(vm)),
        "format": native("string.format", make_format()),
    })
    math_lib = lib({
        "floor": native("math.floor", math_floor),
        "ceil": native("math.ceil", math_ceil),
        "abs": native("math.abs", math_abs),
        "sqrt": native("math.sqrt", math_sqrt),
        "max": native("math.max", math_max),
        "min": native("math.min", math_min),
        "fmod": native("math.fmod", math_fmod),
        "mod": native("math.mod", math_fmod),
        "exp": native("math.exp", math_unary("math.exp", math.exp)),
        "log": native("math.log", math_log),
        "log10": native("math.log10", math_log10),
        "pow": native("math.pow", math_pow),
        "sin": native("math.sin", math_unary("math.sin", math.sin)),
        "cos": native("math.cos", math_unary("math.cos", math.cos)),
        "tan": native("math.tan", math_unary("math.tan", math.tan)),
        "asin": native("math.asin", math_unary("math.asin", math.asin)),
        "acos": native("math.acos", math_unary("math.acos", math.acos)),
        "atan": native("math.atan", math_unary("math.atan", math.atan)),
        "atan2": native("math.atan2", math_atan2),
        "sinh": native("math.sinh", math_unary("math.sinh", math.sinh)),
        "cosh": native("math.cosh", math_unary("math.cosh", math.cosh)),
        "tanh": native("math.tanh", math_unary("math.tanh", math.tanh)),
        "modf": native("math.modf", math_modf),
        "frexp": native("math.frexp", math_frexp),
        "ldexp": native("math.ldexp", math_ldexp),
        "deg": native("math.deg", math_deg),
        "rad": native("math.rad", math_rad),
        "random": native("math.random", math_random),
        "randomseed": native("math.randomseed", math_randomseed),
        "huge": math.inf,
        "pi": math.pi,
    })
    globals_table.set("table", table_lib)
    globals_table.set("string", string_lib)
    globals_table.set("math", math_lib)
    vm.string_meta.set("__index", string_lib)

    globals_table.set("coroutine", make_coroutine_lib(vm))
    globals_table.set("io", make_io_lib(vm))
    globals_table.set("os", make_os_lib(vm))

    for key, value in make_loader_lib(vm, globals_table).items():
        globals_table.set(key, value)

    return globals_table
