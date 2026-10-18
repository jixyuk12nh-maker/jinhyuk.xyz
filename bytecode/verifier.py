from bytecode.chunk import Chunk
from bytecode.limits import MAX_CODE, MAX_CONSTANTS, MAX_PROTOS, MAX_REGISTERS
from bytecode.opcodes import Op
from frontend.diagnostics import BytecodeError

VALID_OPS = frozenset(int(op) for op in Op)
CONST_TYPES = (type(None), bool, float, str)

def verify_chunk(chunk):
    if not chunk.protos:
        raise BytecodeError("프로토타입이 없습니다")
    if len(chunk.protos) > MAX_PROTOS:
        raise BytecodeError("프로토타입 개수가 한도를 초과합니다")
    for index, proto in enumerate(chunk.protos):
        _verify_proto(chunk, index, proto)

def _verify_proto(chunk, index, proto):
    def fail(pc, msg):
        raise BytecodeError(f"검증 실패 (함수 {index}, 명령 {pc}): {msg}")

    if not 1 <= proto.nregs <= MAX_REGISTERS:
        fail(-1, f"레지스터 수가 허용 범위를 벗어납니다 ({proto.nregs})")
    if not 0 <= proto.nparams <= proto.nregs:
        fail(-1, "매개변수 수가 레지스터 수보다 큽니다")
    if len(proto.upvalues) > MAX_REGISTERS:
        fail(-1, "upvalue 개수가 한도를 초과합니다")
    for upvalue in proto.upvalues:
        if type(upvalue.instack) is not bool or not isinstance(upvalue.index, int) or upvalue.index < 0:
            fail(-1, "잘못된 upvalue 설명자입니다")
        if upvalue.instack and upvalue.index >= MAX_REGISTERS:
            fail(-1, "upvalue 레지스터 인덱스가 한도를 초과합니다")
    if len(proto.constants) > MAX_CONSTANTS:
        fail(-1, "상수 개수가 한도를 초과합니다")
    for value in proto.constants:
        if type(value) not in CONST_TYPES:
            fail(-1, f"지원하지 않는 상수 타입 {type(value).__name__}")
    if not 1 <= len(proto.code) <= MAX_CODE:
        fail(-1, "명령어 개수가 허용 범위를 벗어납니다")
    for pc, ins in enumerate(proto.code):
        _verify_instr(chunk, proto, pc, ins, fail)
    last = proto.code[-1]
    if last.op not in (Op.RETURN, Op.JMP):
        fail(len(proto.code) - 1, "마지막 명령은 RETURN 또는 JMP여야 합니다")

def _verify_instr(chunk, proto, pc, ins, fail):
    op, a, b, c = ins
    if op not in VALID_OPS:
        fail(pc, f"알 수 없는 opcode {op}")
    nregs = proto.nregs
    nconst = len(proto.constants)

    def reg(x):
        if not 0 <= x < nregs:
            fail(pc, f"잘못된 레지스터 번호 {x}")

    def const(x):
        if not 0 <= x < nconst:
            fail(pc, f"상수 인덱스 범위 초과 {x}")

    def target(x):
        if not 0 <= x < len(proto.code):
            fail(pc, f"잘못된 점프 대상 {x}")

    def unused(*vals):
        if any(v != 0 for v in vals):
            fail(pc, "잘못된 명령어 인수 (사용되지 않는 인수가 0이 아님)")

    if op == Op.LOADK:
        reg(a); const(b); unused(c)
    elif op in (Op.MOVE, Op.NEG, Op.NOT, Op.LEN):
        reg(a); reg(b); unused(c)
    elif op == Op.GETUPVAL:
        reg(a); unused(c)
        if not 0 <= b < len(proto.upvalues):
            fail(pc, f"upvalue 인덱스 범위 초과 {b}")
    elif op == Op.SETUPVAL:
        reg(a); unused(c)
        if not 0 <= b < len(proto.upvalues):
            fail(pc, f"upvalue 인덱스 범위 초과 {b}")
    elif op in (Op.ADD, Op.SUB, Op.MUL, Op.DIV, Op.MOD, Op.POW, Op.IDIV, Op.EQ, Op.LT, Op.LE, Op.CONCAT):
        reg(a); reg(b); reg(c)
    elif op in (Op.NEWTABLE, Op.NEWLOCAL):
        reg(a); unused(b, c)
    elif op == Op.FORCHECK:
        reg(a); reg(b); reg(c)
        if b + 2 >= nregs:
            fail(pc, "숫자형 for 제어 레지스터 범위 초과")
    elif op == Op.FORSTEP:
        reg(a)
        if a + 2 >= nregs:
            fail(pc, "숫자형 for 제어 레지스터 범위 초과")
        unused(b, c)
    elif op == Op.GETTABLE:
        reg(a); reg(b); reg(c)
    elif op == Op.SETTABLE:
        reg(a); reg(b); reg(c)
    elif op == Op.JMP:
        target(a); unused(b, c)
    elif op in (Op.JMPIF, Op.JMPIFNOT):
        reg(a); target(b); unused(c)
    elif op in (Op.GETGLOBAL, Op.SETGLOBAL):
        reg(a); const(b); unused(c)
        if type(proto.constants[b]) is not str:
            fail(pc, "전역 변수 이름은 문자열 상수여야 합니다")
    elif op in (Op.CALL, Op.CALLV):
        reg(a)
        if b < 0 or b >= nregs:
            fail(pc, f"호출 인수 개수가 범위를 벗어났습니다 ({b})")
        if b > 0:
            reg(a + b)
        if c < 0 or c > MAX_REGISTERS:
            fail(pc, "호출 결과 개수가 범위를 벗어났습니다")
        if c >= 2:
            reg(a + c - 2)
    elif op in (Op.RETURN, Op.RETURNV):
        unused(c)
        if not 0 <= b <= MAX_REGISTERS:
            fail(pc, "반환 값 개수가 범위를 벗어났습니다")
        if b > 0:
            reg(a); reg(a + b - 1)
    elif op == Op.VARARG:
        reg(a); unused(c)
        if not 0 <= b <= MAX_REGISTERS:
            fail(pc, "가변 인자 개수가 범위를 벗어났습니다")
        if b > 0:
            reg(a + b - 1)
    elif op == Op.APPENDV:
        reg(a); reg(b); unused(c)
    elif op == Op.CLOSURE:
        reg(a); unused(c)
        if not 1 <= b < len(chunk.protos):
            fail(pc, f"잘못된 프로토타입 인덱스 {b}")
        child = chunk.protos[b]
        for desc in child.upvalues:
            if desc.instack and desc.index >= nregs:
                fail(pc, f"캡처할 레지스터 인덱스 범위 초과 {desc.index}")
            if not desc.instack and desc.index >= len(proto.upvalues):
                fail(pc, f"전달할 upvalue 인덱스 범위 초과 {desc.index}")
