import math
import sys

from bytecode.limits import DEFAULT_MAX_STEPS, MAX_CALL_DEPTH
from bytecode.opcodes import Op
from bytecode.verifier import verify_chunk
from frontend.diagnostics import ExecutionLimitError, LuaRuntimeError
from vm.stdlib import make_globals
from vm.values import (
    LuaFunction, LuaTable, LuaUserdata, NativeFunction, UpvalueCell,
    coerce_number, to_display, truthy, type_name,
)

ARITH = frozenset({Op.ADD, Op.SUB, Op.MUL, Op.DIV, Op.MOD, Op.POW, Op.IDIV})
ARITH_EVENTS = {
    Op.ADD: "__add", Op.SUB: "__sub", Op.MUL: "__mul", Op.DIV: "__div",
    Op.MOD: "__mod", Op.POW: "__pow", Op.IDIV: "__idiv",
}
MAX_META_CHAIN = 100


class LuaOpError(LuaRuntimeError):
    pass


def _is_number(value):
    return isinstance(value, float)


def _is_callable(value):
    return isinstance(value, (LuaFunction, NativeFunction))


def _first(results):
    return results[0] if results else None


def _raw_get(table, key):
    if key is None or (isinstance(key, float) and math.isnan(key)):
        return None
    return table.get(key)


def _raw_set(table, key, value):
    try:
        table.set(key, value)
    except ValueError as exc:
        raise LuaOpError(str(exc)) from None


def _divide(x, y):
    if y == 0.0:
        if x == 0.0 or math.isnan(x):
            return math.nan
        return math.copysign(math.inf, x) * math.copysign(1.0, y)
    return x / y


def _arith_number(op, x, y):
    if op == Op.ADD:
        return x + y
    if op == Op.SUB:
        return x - y
    if op == Op.MUL:
        return x * y
    if op == Op.DIV:
        return _divide(x, y)
    if op == Op.MOD:
        if y == 0.0:
            return math.nan
        return x - math.floor(x / y) * y
    if op == Op.IDIV:
        if y == 0.0:
            if x == 0.0 or math.isnan(x):
                return math.nan
            return math.copysign(math.inf, x) * math.copysign(1.0, y)
        return float(math.floor(x / y))
    try:
        return math.pow(x, y)
    except ValueError:
        return math.nan
    except OverflowError:
        return math.inf if x >= 0 or int(y) % 2 == 0 else -math.inf


class VM:
    def __init__(self, chunk, output=None, max_steps=DEFAULT_MAX_STEPS, max_depth=MAX_CALL_DEPTH):
        verify_chunk(chunk)
        self.chunk = chunk
        self.output = output if output is not None else sys.stdout
        self.max_steps = max_steps
        self.max_depth = max_depth
        self.steps = 0
        self.depth = 0
        self.frames = []
        self.coroutines = []
        self.chunks = [chunk]
        self.string_meta = LuaTable()
        self.globals = make_globals(self)

    def load_chunk(self, chunk, env=None):
        verify_chunk(chunk)
        self.chunks.append(chunk)
        return LuaFunction(chunk.protos[0], None, chunk, env if env is not None else self.globals)

    def run(self):
        return self._call(LuaFunction(self.chunk.protos[0], None, self.chunk, self.globals), [])

    def get_metatable(self, value):
        if isinstance(value, LuaTable):
            return value.meta
        if isinstance(value, str):
            return self.string_meta
        if isinstance(value, LuaUserdata):
            return value.meta
        return None

    def metamethod(self, value, event):
        mt = self.get_metatable(value)
        return None if mt is None else mt.get(event)

    def call1(self, fn, args):
        return _first(self._call(fn, args))

    def index(self, obj, key):
        for _ in range(MAX_META_CHAIN):
            if isinstance(obj, LuaTable):
                value = _raw_get(obj, key)
                if value is not None:
                    return value
                handler = None if obj.meta is None else obj.meta.get("__index")
                if handler is None:
                    return None
            else:
                handler = self.metamethod(obj, "__index")
                if handler is None:
                    raise LuaOpError(f"{type_name(obj)} 값은 인덱싱할 수 없습니다")
            if _is_callable(handler):
                return self.call1(handler, [obj, key])
            obj = handler
        raise LuaOpError("'__index' 체인이 너무 깁니다")

    def setindex(self, obj, key, value):
        for _ in range(MAX_META_CHAIN):
            if isinstance(obj, LuaTable):
                if obj.meta is None or _raw_get(obj, key) is not None:
                    _raw_set(obj, key, value)
                    return
                handler = obj.meta.get("__newindex")
                if handler is None:
                    _raw_set(obj, key, value)
                    return
            else:
                handler = self.metamethod(obj, "__newindex")
                if handler is None:
                    raise LuaOpError(f"{type_name(obj)} 값에는 대입할 수 없습니다")
            if _is_callable(handler):
                self._call(handler, [obj, key, value])
                return
            obj = handler
        raise LuaOpError("'__newindex' 체인이 너무 깁니다")

    def _arith(self, op, x, y):
        nx = coerce_number(x)
        ny = coerce_number(y)
        if nx is not None and ny is not None:
            return _arith_number(op, nx, ny)
        event = ARITH_EVENTS[op]
        handler = self.metamethod(x, event)
        if handler is None:
            handler = self.metamethod(y, event)
        if handler is None:
            raise LuaOpError("산술 연산은 숫자에만 적용할 수 있습니다")
        return self.call1(handler, [x, y])

    def _unm(self, x):
        n = coerce_number(x)
        if n is not None:
            return -n
        handler = self.metamethod(x, "__unm")
        if handler is None:
            raise LuaOpError("단항 '-'는 숫자에만 적용할 수 있습니다")
        return self.call1(handler, [x, x])

    def _concat(self, x, y):
        if (isinstance(x, str) or _is_number(x)) and (isinstance(y, str) or _is_number(y)):
            return to_display(x) + to_display(y)
        handler = self.metamethod(x, "__concat")
        if handler is None:
            handler = self.metamethod(y, "__concat")
        if handler is None:
            raise LuaOpError("문자열 연결은 문자열 또는 숫자에만 적용할 수 있습니다")
        return self.call1(handler, [x, y])

    def _length(self, value):
        if isinstance(value, str):
            return float(len(value.encode("utf-8")))
        if isinstance(value, LuaTable):
            return float(value.length())
        if isinstance(value, LuaUserdata):
            handler = self.metamethod(value, "__len")
            if handler is not None:
                return self.call1(handler, [value, value])
        raise LuaOpError("길이 연산자 '#'는 문자열 또는 테이블에만 적용할 수 있습니다")

    def _equal(self, x, y):
        if type(x) is type(y) and x == y:
            return True
        both_tables = isinstance(x, LuaTable) and isinstance(y, LuaTable)
        both_userdata = isinstance(x, LuaUserdata) and isinstance(y, LuaUserdata)
        if not (both_tables or both_userdata):
            return False
        handler = self.metamethod(x, "__eq")
        if handler is None:
            handler = self.metamethod(y, "__eq")
        if handler is None:
            return False
        return truthy(self.call1(handler, [x, y]))

    def _compare(self, x, y, strict):
        if (_is_number(x) and _is_number(y)) or (isinstance(x, str) and isinstance(y, str)):
            return x < y if strict else x <= y
        event = "__lt" if strict else "__le"
        handler = self.metamethod(x, event)
        if handler is None:
            handler = self.metamethod(y, event)
        if handler is None:
            raise LuaOpError("비교는 같은 종류의 숫자 또는 문자열에만 적용할 수 있습니다")
        return truthy(self.call1(handler, [x, y]))

    def _call(self, fn, args):
        if isinstance(fn, NativeFunction):
            return list(fn.fn(args) or [])
        if not isinstance(fn, LuaFunction):
            handler = self.metamethod(fn, "__call")
            if handler is None:
                raise LuaRuntimeError(f"호출할 수 없는 값입니다 ({type_name(fn)})")
            return self._call(handler, [fn] + list(args))
        if self.depth >= self.max_depth:
            raise ExecutionLimitError(f"호출 깊이 제한({self.max_depth})을 초과했습니다")
        proto = fn.proto
        regs = [UpvalueCell() for _ in range(proto.nregs)]
        for i, value in enumerate(args[: proto.nparams]):
            regs[i].value = value
        varargs = list(args[proto.nparams:]) if proto.is_vararg else []
        if len(fn.upvalues) != len(proto.upvalues):
            raise LuaRuntimeError("함수 upvalue 개수가 일치하지 않습니다")
        self.depth += 1
        self.frames.append(fn)
        try:
            return self._execute(proto, regs, fn, varargs)
        finally:
            self.depth -= 1
            self.frames.pop()

    def _error(self, proto, pc, message):
        index = -1
        for chunk in self.chunks:
            found = next((i for i, p in enumerate(chunk.protos) if p is proto), None)
            if found is not None:
                index = found
                break
        return LuaRuntimeError(f"런타임 오류 (함수 {index}, 명령 {pc}): {message}")

    def _execute(self, proto, regs, closure, varargs):
        code = proto.code
        consts = proto.constants
        pc = 0
        pending = []
        while True:
            if self.steps >= self.max_steps:
                raise ExecutionLimitError(f"실행 횟수 제한({self.max_steps})을 초과했습니다")
            self.steps += 1
            op, a, b, c = code[pc]
            here = pc
            pc += 1
            try:
                if op == Op.LOADK:
                    regs[a].value = consts[b]
                elif op == Op.MOVE:
                    regs[a].value = regs[b].value
                elif op in ARITH:
                    regs[a].value = self._arith(op, regs[b].value, regs[c].value)
                elif op == Op.NEG:
                    regs[a].value = self._unm(regs[b].value)
                elif op == Op.NOT:
                    regs[a].value = not truthy(regs[b].value)
                elif op == Op.LEN:
                    regs[a].value = self._length(regs[b].value)
                elif op == Op.EQ:
                    regs[a].value = self._equal(regs[b].value, regs[c].value)
                elif op == Op.LT:
                    regs[a].value = self._compare(regs[b].value, regs[c].value, True)
                elif op == Op.LE:
                    regs[a].value = self._compare(regs[b].value, regs[c].value, False)
                elif op == Op.JMP:
                    pc = a
                elif op == Op.JMPIF:
                    if truthy(regs[a].value):
                        pc = b
                elif op == Op.JMPIFNOT:
                    if not truthy(regs[a].value):
                        pc = b
                elif op == Op.GETGLOBAL:
                    regs[a].value = self.index(closure.env, consts[b])
                elif op == Op.SETGLOBAL:
                    self.setindex(closure.env, consts[b], regs[a].value)
                elif op == Op.GETUPVAL:
                    regs[a].value = closure.upvalues[b].value
                elif op == Op.SETUPVAL:
                    closure.upvalues[b].value = regs[a].value
                elif op in (Op.CALL, Op.CALLV):
                    args = [cell.value for cell in regs[a + 1: a + 1 + b]]
                    if op == Op.CALLV:
                        args.extend(pending)
                        pending = []
                    results = self._call(regs[a].value, args)
                    if c == 0:
                        pending = results
                    else:
                        for i in range(c - 1):
                            regs[a + i].value = results[i] if i < len(results) else None
                elif op == Op.VARARG:
                    if b == 0:
                        pending = list(varargs)
                    else:
                        for i in range(b):
                            regs[a + i].value = varargs[i] if i < len(varargs) else None
                elif op == Op.APPENDV:
                    table = regs[a].value
                    start = regs[b].value
                    for i, value in enumerate(pending):
                        _raw_set(table, start + i, value)
                    pending = []
                elif op == Op.CLOSURE:
                    owner = closure.chunk if closure.chunk is not None else self.chunk
                    child = owner.protos[b]
                    captured = []
                    for desc in child.upvalues:
                        captured.append(regs[desc.index] if desc.instack else closure.upvalues[desc.index])
                    regs[a].value = LuaFunction(child, captured, owner, closure.env)
                elif op == Op.FORCHECK:
                    index = regs[b].value
                    limit = regs[c].value
                    step = regs[b + 2].value
                    if not (_is_number(index) and _is_number(limit) and _is_number(step)):
                        raise self._error(proto, here, "숫자형 for의 시작/끝/증분은 숫자여야 합니다")
                    if step == 0:
                        regs[a].value = index <= limit
                    else:
                        regs[a].value = index <= limit if step > 0 else index >= limit
                elif op == Op.FORSTEP:
                    index = regs[a].value
                    step = regs[a + 2].value
                    if not (_is_number(index) and _is_number(step)):
                        raise self._error(proto, here, "숫자형 for의 인덱스/증분은 숫자여야 합니다")
                    regs[a].value = index + step
                elif op == Op.NEWTABLE:
                    regs[a].value = LuaTable()
                elif op == Op.GETTABLE:
                    regs[a].value = self.index(regs[b].value, regs[c].value)
                elif op == Op.SETTABLE:
                    self.setindex(regs[a].value, regs[b].value, regs[c].value)
                elif op == Op.CONCAT:
                    regs[a].value = self._concat(regs[b].value, regs[c].value)
                elif op == Op.NEWLOCAL:
                    regs[a] = UpvalueCell()
                elif op == Op.RETURN:
                    return [regs[a + i].value for i in range(b)]
                elif op == Op.RETURNV:
                    return [regs[a + i].value for i in range(b)] + pending
                else:
                    raise self._error(proto, here, f"알 수 없는 opcode {op}")
            except LuaOpError as exc:
                raise self._error(proto, here, str(exc)) from None
