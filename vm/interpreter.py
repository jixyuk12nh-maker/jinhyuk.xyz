import math
import sys

from bytecode.limits import DEFAULT_MAX_STEPS, MAX_CALL_DEPTH
from bytecode.opcodes import Op
from bytecode.verifier import verify_chunk
from frontend.diagnostics import ExecutionLimitError, LuaRuntimeError
from vm.values import LuaFunction, LuaTable, NativeFunction, UpvalueCell, to_display, truthy, type_name

ARITH = frozenset({Op.ADD, Op.SUB, Op.MUL, Op.DIV, Op.MOD, Op.POW, Op.IDIV})

def _is_number(value):
    return isinstance(value, float)

def _lua_equal(x, y):
    return type(x) is type(y) and x == y

def _divide(x, y):
    if y == 0.0:
        if x == 0.0 or math.isnan(x):
            return math.nan
        return math.copysign(math.inf, x) * math.copysign(1.0, y)
    return x / y

class VM:
    def __init__(self, chunk, output=None, max_steps=DEFAULT_MAX_STEPS, max_depth=MAX_CALL_DEPTH):
        verify_chunk(chunk)
        self.chunk = chunk
        self.output = output if output is not None else sys.stdout
        self.max_steps = max_steps
        self.max_depth = max_depth
        self.steps = 0
        self.depth = 0
        self.globals = {"print": NativeFunction("print", self._print)}

    def run(self):
        return self._call(LuaFunction(self.chunk.protos[0]), [])

    def _print(self, args):
        self.output.write("\t".join(to_display(v) for v in args) + "\n")
        return None

    def _call(self, fn, args):
        if isinstance(fn, NativeFunction):
            return fn.fn(args)
        if not isinstance(fn, LuaFunction):
            raise LuaRuntimeError(f"호출할 수 없는 값입니다 ({type_name(fn)})")
        if self.depth >= self.max_depth:
            raise ExecutionLimitError(f"호출 깊이 제한({self.max_depth})을 초과했습니다")
        proto = fn.proto
        regs = [UpvalueCell() for _ in range(proto.nregs)]
        for i, value in enumerate(args[: proto.nparams]):
            regs[i].value = value
        if len(fn.upvalues) != len(proto.upvalues):
            raise LuaRuntimeError("함수 upvalue 개수가 일치하지 않습니다")
        self.depth += 1
        try:
            return self._execute(proto, regs, fn)
        finally:
            self.depth -= 1

    def _error(self, proto, pc, message):
        index = next((i for i, p in enumerate(self.chunk.protos) if p is proto), -1)
        return LuaRuntimeError(f"런타임 오류 (함수 {index}, 명령 {pc}): {message}")

    def _arith(self, op, x, y, proto, pc):
        if not (_is_number(x) and _is_number(y)):
            raise self._error(proto, pc, "산술 연산은 숫자에만 적용할 수 있습니다")
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
        if op == Op.POW:
            try:
                return math.pow(x, y)
            except ValueError:
                return math.nan
            except OverflowError:
                return math.inf if x >= 0 or int(y) % 2 == 0 else -math.inf

    def _compare(self, x, y, proto, pc, strict):
        comparable = (_is_number(x) and _is_number(y)) or (isinstance(x, str) and isinstance(y, str))
        if not comparable:
            raise self._error(proto, pc, "비교는 같은 종류의 숫자 또는 문자열에만 적용할 수 있습니다")
        return x < y if strict else x <= y

    def _execute(self, proto, regs, closure=None):
        code = proto.code
        consts = proto.constants
        closure = closure or LuaFunction(proto)
        pc = 0
        while True:
            if self.steps >= self.max_steps:
                raise ExecutionLimitError(f"실행 횟수 제한({self.max_steps})을 초과했습니다")
            self.steps += 1
            op, a, b, c = code[pc]
            here = pc
            pc += 1
            if op == Op.LOADK:
                regs[a].value = consts[b]
            elif op == Op.MOVE:
                regs[a].value = regs[b].value
            elif op in ARITH:
                regs[a].value = self._arith(op, regs[b].value, regs[c].value, proto, here)
            elif op == Op.NEG:
                value = regs[b].value
                if not _is_number(value):
                    raise self._error(proto, here, "단항 '-'는 숫자에만 적용할 수 있습니다")
                regs[a].value = -value
            elif op == Op.NOT:
                regs[a].value = not truthy(regs[b].value)
            elif op == Op.LEN:
                value = regs[b].value
                if isinstance(value, str):
                    regs[a].value = float(len(value.encode("utf-8")))
                elif isinstance(value, LuaTable):
                    length = 0
                    while value.get(float(length + 1)) is not None:
                        length += 1
                    regs[a].value = float(length)
                else:
                    raise self._error(proto, here, "길이 연산자 '#'는 문자열 또는 테이블에만 적용할 수 있습니다")
            elif op == Op.EQ:
                regs[a].value = _lua_equal(regs[b].value, regs[c].value)
            elif op == Op.LT:
                regs[a].value = self._compare(regs[b].value, regs[c].value, proto, here, True)
            elif op == Op.LE:
                regs[a].value = self._compare(regs[b].value, regs[c].value, proto, here, False)
            elif op == Op.JMP:
                pc = a
            elif op == Op.JMPIF:
                if truthy(regs[a].value):
                    pc = b
            elif op == Op.JMPIFNOT:
                if not truthy(regs[a].value):
                    pc = b
            elif op == Op.GETGLOBAL:
                regs[a].value = self.globals.get(consts[b])
            elif op == Op.SETGLOBAL:
                self.globals[consts[b]] = regs[a].value
            elif op == Op.GETUPVAL:
                regs[a].value = closure.upvalues[b].value
            elif op == Op.SETUPVAL:
                closure.upvalues[b].value = regs[a].value
            elif op == Op.CALL:
                fn = regs[a].value
                args = [cell.value for cell in regs[a + 1 : a + 1 + b]]
                regs[a].value = self._call(fn, args)
            elif op == Op.CLOSURE:
                child = self.chunk.protos[b]
                captured = []
                for desc in child.upvalues:
                    captured.append(regs[desc.index] if desc.instack else closure.upvalues[desc.index])
                regs[a].value = LuaFunction(child, captured)
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
                table, key = regs[b].value, regs[c].value
                if not isinstance(table, LuaTable):
                    raise self._error(proto, here, "테이블 인덱싱 대상이 테이블이 아닙니다")
                try:
                    regs[a].value = table.get(key)
                except ValueError as exc:
                    raise self._error(proto, here, str(exc)) from None
            elif op == Op.SETTABLE:
                table, key, value = regs[a].value, regs[b].value, regs[c].value
                if not isinstance(table, LuaTable):
                    raise self._error(proto, here, "테이블 대입 대상이 테이블이 아닙니다")
                try:
                    table.set(key, value)
                except ValueError as exc:
                    raise self._error(proto, here, str(exc)) from None
            elif op == Op.CONCAT:
                x, y = regs[b].value, regs[c].value
                if not ((isinstance(x, str) or _is_number(x)) and (isinstance(y, str) or _is_number(y))):
                    raise self._error(proto, here, "문자열 연결은 문자열 또는 숫자에만 적용할 수 있습니다")
                sx = str(int(x)) if _is_number(x) and x.is_integer() else str(x)
                sy = str(int(y)) if _is_number(y) and y.is_integer() else str(y)
                regs[a].value = sx + sy
            elif op == Op.RETURN:
                return regs[a].value if b == 1 else None
            else:
                raise self._error(proto, here, f"알 수 없는 opcode {op}")

