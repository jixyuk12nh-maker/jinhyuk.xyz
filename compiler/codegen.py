from bytecode.chunk import Chunk, Instr, Proto, UpvalueDesc
from bytecode.limits import MAX_CONSTANTS, MAX_PROTOS, MAX_REGISTERS
from bytecode.opcodes import Op
from frontend.ast_nodes import (
    AssignStmt, BinaryOp, BoolLit, CallExpr, ExprStmt, FunctionStmt, IfStmt,
    LocalStmt, NameRef, NilLit, NumberLit, ReturnStmt, StringLit, UnaryOp, WhileStmt,
    IndexExpr, TableLit, FunctionExpr, NumericForStmt, RepeatStmt, BreakStmt,
)
from frontend.diagnostics import CompileError

ARITH_OPS = {"+": Op.ADD, "-": Op.SUB, "*": Op.MUL, "/": Op.DIV, "%": Op.MOD, "^": Op.POW, "//": Op.IDIV}

class Label:
    __slots__ = ("index",)

    def __init__(self):
        self.index = None

class _FunctionState:
    def __init__(self, parent):
        self.parent = parent
        self.ir = []
        self.constants = []
        self.const_index = {}
        self.locals = []
        self.next_reg = 0
        self.max_reg = 0
        self.nparams = 0
        self.upvalues = []
        self.upvalue_index = {}

def _target(x):
    if isinstance(x, Label):
        if x.index is None:
            raise RuntimeError("내부 오류: 배치되지 않은 레이블")
        return x.index
    return x

def generate(statements):
    return _Generator().chunk(statements)

class _Generator:
    def __init__(self):
        self.protos = []
        self.fs = None
        self.loc = None
        self.break_targets = []

    def chunk(self, statements):
        self.protos.append(None)
        self.fs = _FunctionState(None)
        self._block(statements)
        self._implicit_return()
        self.protos[0] = self._finish(self.fs)
        return Chunk(self.protos)

    def _finish(self, fs):
        code = []
        for op, a, b, c in fs.ir:
            if op == Op.JMP:
                a = _target(a)
            elif op in (Op.JMPIF, Op.JMPIFNOT):
                b = _target(b)
            code.append(Instr(int(op), int(a), int(b), int(c)))
        return Proto(nparams=fs.nparams, nregs=max(fs.max_reg, 1),
                     constants=fs.constants, code=code, upvalues=list(fs.upvalues))

    def _emit(self, op, a=0, b=0, c=0):
        self.fs.ir.append([op, a, b, c])

    def _place(self, label):
        label.index = len(self.fs.ir)

    def _alloc(self):
        fs = self.fs
        reg = fs.next_reg
        fs.next_reg += 1
        if fs.next_reg > MAX_REGISTERS:
            raise CompileError(self.loc, "지역 레지스터 한도를 초과했습니다")
        fs.max_reg = max(fs.max_reg, fs.next_reg)
        return reg

    def _const(self, value):
        fs = self.fs
        key = (type(value).__name__, value)
        idx = fs.const_index.get(key)
        if idx is None:
            if len(fs.constants) >= MAX_CONSTANTS:
                raise CompileError(self.loc, "상수 개수 한도를 초과했습니다")
            idx = len(fs.constants)
            fs.constants.append(value)
            fs.const_index[key] = idx
        return idx

    def _add_upvalue(self, fs, name, desc):
        existing = fs.upvalue_index.get(name)
        if existing is not None:
            return existing
        idx = len(fs.upvalues)
        fs.upvalues.append(desc)
        fs.upvalue_index[name] = idx
        return idx

    def _resolve_upvalue(self, fs, name):
        parent = fs.parent
        if parent is None:
            return None
        for var, reg in reversed(parent.locals):
            if var == name:
                return self._add_upvalue(fs, name, UpvalueDesc(True, reg))
        parent_index = self._resolve_upvalue(parent, name)
        if parent_index is not None:
            return self._add_upvalue(fs, name, UpvalueDesc(False, parent_index))
        return None

    def _resolve(self, name, loc):
        for var, reg in reversed(self.fs.locals):
            if var == name:
                return reg
        upvalue = self.fs.upvalue_index.get(name)
        if upvalue is not None:
            return ("upvalue", upvalue)
        upvalue = self._resolve_upvalue(self.fs, name)
        if upvalue is not None:
            return ("upvalue", upvalue)
        return None

    def _block(self, stmts):
        locals_mark = len(self.fs.locals)
        reg_mark = self.fs.next_reg
        for s in stmts:
            self._stmt(s)
        del self.fs.locals[locals_mark:]
        self.fs.next_reg = reg_mark

    def _stmt(self, s):
        self.loc = s.loc
        if isinstance(s, LocalStmt):
            self._local(s)
        elif isinstance(s, AssignStmt):
            self._assign(s)
        elif isinstance(s, ExprStmt):
            mark = self.fs.next_reg
            t = self._alloc()
            self._expr(s.expr, t)
            self.fs.next_reg = mark
        elif isinstance(s, IfStmt):
            self._if(s)
        elif isinstance(s, WhileStmt):
            self._while(s)
        elif isinstance(s, NumericForStmt):
            self._numeric_for(s)
        elif isinstance(s, RepeatStmt):
            self._repeat(s)
        elif isinstance(s, BreakStmt):
            if not self.break_targets:
                raise CompileError(s.loc, "break는 반복문 안에서만 사용할 수 있습니다")
            self._emit(Op.JMP, self.break_targets[-1])
        elif isinstance(s, ReturnStmt):
            self._return(s)
        elif isinstance(s, FunctionStmt):
            self._function_stmt(s)
        else:
            raise CompileError(s.loc, "지원하지 않는 문장입니다")

    def _local(self, s):
        mark = self.fs.next_reg
        regs = [self._alloc() for _ in s.names]
        for i, reg in enumerate(regs):
            if i < len(s.values):
                self._expr(s.values[i], reg)
            else:
                self._emit(Op.LOADK, reg, self._const(None))
        for extra in s.values[len(regs):]:
            tmp = self._alloc()
            self._expr(extra, tmp)
        self.fs.next_reg = mark + len(regs)
        for name, reg in zip(s.names, regs):
            self.fs.locals.append((name, reg))

    def _assign(self, s):
        mark = self.fs.next_reg
        tmp = self._alloc()
        self._expr(s.value, tmp)
        if isinstance(s.target, NameRef):
            reg = self._resolve(s.target.name, s.loc)
            if reg is None:
                self._emit(Op.SETGLOBAL, tmp, self._const(s.target.name))
            elif isinstance(reg, tuple):
                self._emit(Op.SETUPVAL, tmp, reg[1])
            else:
                self._emit(Op.MOVE, reg, tmp)
        elif isinstance(s.target, IndexExpr):
            table = self._alloc()
            key = self._alloc()
            self._expr(s.target.table, table)
            self._expr(s.target.key, key)
            self._emit(Op.SETTABLE, table, key, tmp)
        self.fs.next_reg = mark

    def _if(self, s):
        end = Label()
        for cond, body in s.branches:
            nxt = Label()
            mark = self.fs.next_reg
            c = self._alloc()
            self._expr(cond, c)
            self._emit(Op.JMPIFNOT, c, nxt)
            self.fs.next_reg = mark
            self._block(body)
            self._emit(Op.JMP, end)
            self._place(nxt)
        if s.else_body is not None:
            self._block(s.else_body)
        self._place(end)

    def _while(self, s):
        start = Label()
        end = Label()
        self._place(start)
        mark = self.fs.next_reg
        c = self._alloc()
        self._expr(s.cond, c)
        self._emit(Op.JMPIFNOT, c, end)
        self.fs.next_reg = mark
        self.break_targets.append(end)
        self._block(s.body)
        self.break_targets.pop()
        self._emit(Op.JMP, start)
        self._place(end)

    def _numeric_for(self, s):
        mark = self.fs.next_reg
        base = self._alloc()
        limit = self._alloc()
        step = self._alloc()
        flag = self._alloc()
        self._expr(s.start, base)
        self._expr(s.limit, limit)
        if s.step is None:
            self._emit(Op.LOADK, step, self._const(1.0))
        else:
            self._expr(s.step, step)
        start = Label()
        end = Label()
        self._place(start)
        self._emit(Op.FORCHECK, flag, base, limit)
        self._emit(Op.JMPIFNOT, flag, end)
        locals_mark = len(self.fs.locals)
        self.fs.locals.append((s.name, base))
        self.break_targets.append(end)
        self._block(s.body)
        self.break_targets.pop()
        del self.fs.locals[locals_mark:]
        self._emit(Op.FORSTEP, base)
        self._emit(Op.JMP, start)
        self._place(end)
        self.fs.next_reg = mark

    def _repeat(self, s):
        locals_mark = len(self.fs.locals)
        reg_mark = self.fs.next_reg
        start = Label()
        end = Label()
        self._place(start)
        self.break_targets.append(end)
        for stmt in s.body:
            self._stmt(stmt)
        self.break_targets.pop()
        cond = self._alloc()
        self._expr(s.cond, cond)
        self._emit(Op.JMPIFNOT, cond, start)
        self._place(end)
        del self.fs.locals[locals_mark:]
        self.fs.next_reg = reg_mark

    def _return(self, s):
        mark = self.fs.next_reg
        t = self._alloc()
        if s.value is None:
            self._emit(Op.LOADK, t, self._const(None))
        else:
            self._expr(s.value, t)
        self._emit(Op.RETURN, t, 1)
        self.fs.next_reg = mark

    def _function_stmt(self, s):
        if s.is_local:
            reg = self._alloc()
            self.fs.locals.append((s.name, reg))
            idx = self._function(s.params, s.body)
            self._emit(Op.CLOSURE, reg, idx)
            return
        mark = self.fs.next_reg
        tmp = self._alloc()
        idx = self._function(s.params, s.body)
        self._emit(Op.CLOSURE, tmp, idx)
        self._emit(Op.SETGLOBAL, tmp, self._const(s.name))
        self.fs.next_reg = mark

    def _function(self, params, body):
        if len(self.protos) >= MAX_PROTOS:
            raise CompileError(self.loc, "함수 개수 한도를 초과했습니다")
        idx = len(self.protos)
        self.protos.append(None)
        parent = self.fs
        self.fs = _FunctionState(parent)
        for name in params:
            reg = self._alloc()
            self.fs.locals.append((name, reg))
        self.fs.nparams = len(params)
        self._block(body)
        self._implicit_return()
        self.protos[idx] = self._finish(self.fs)
        self.fs = parent
        return idx

    def _implicit_return(self):
        t = self._alloc()
        self._emit(Op.LOADK, t, self._const(None))
        self._emit(Op.RETURN, t, 1)

    def _expr(self, e, dst):
        self.loc = e.loc
        if isinstance(e, NumberLit):
            self._emit(Op.LOADK, dst, self._const(e.value))
        elif isinstance(e, StringLit):
            self._emit(Op.LOADK, dst, self._const(e.value))
        elif isinstance(e, BoolLit):
            self._emit(Op.LOADK, dst, self._const(e.value))
        elif isinstance(e, NilLit):
            self._emit(Op.LOADK, dst, self._const(None))
        elif isinstance(e, NameRef):
            reg = self._resolve(e.name, e.loc)
            if reg is None:
                self._emit(Op.GETGLOBAL, dst, self._const(e.name))
            elif isinstance(reg, tuple):
                self._emit(Op.GETUPVAL, dst, reg[1])
            elif reg != dst:
                self._emit(Op.MOVE, dst, reg)
        elif isinstance(e, UnaryOp):
            self._unary(e, dst)
        elif isinstance(e, BinaryOp):
            self._binary(e, dst)
        elif isinstance(e, CallExpr):
            self._call(e, dst)
        elif isinstance(e, FunctionExpr):
            idx = self._function(e.params, e.body)
            self._emit(Op.CLOSURE, dst, idx)
        elif isinstance(e, TableLit):
            self._emit(Op.NEWTABLE, dst)
            mark = self.fs.next_reg
            for field in e.fields:
                key = self._alloc()
                value = self._alloc()
                self._expr(field.key, key)
                self._expr(field.value, value)
                self._emit(Op.SETTABLE, dst, key, value)
            self.fs.next_reg = mark
        elif isinstance(e, IndexExpr):
            mark = self.fs.next_reg
            table = self._alloc()
            key = self._alloc()
            self._expr(e.table, table)
            self._expr(e.key, key)
            self._emit(Op.GETTABLE, dst, table, key)
            self.fs.next_reg = mark
        else:
            raise CompileError(e.loc, "지원하지 않는 식입니다")

    def _unary(self, e, dst):
        mark = self.fs.next_reg
        t = self._alloc()
        self._expr(e.operand, t)
        unary_op = {"-": Op.NEG, "not": Op.NOT, "#": Op.LEN}[e.op]
        self._emit(unary_op, dst, t)
        self.fs.next_reg = mark

    def _binary(self, e, dst):
        if e.op in ("and", "or"):
            end = Label()
            self._expr(e.left, dst)
            self._emit(Op.JMPIFNOT if e.op == "and" else Op.JMPIF, dst, end)
            self._expr(e.right, dst)
            self._place(end)
            return
        mark = self.fs.next_reg
        left = self._alloc()
        self._expr(e.left, left)
        right = self._alloc()
        self._expr(e.right, right)
        op = e.op
        if op in ARITH_OPS:
            self._emit(ARITH_OPS[op], dst, left, right)
        elif op == "..":
            self._emit(Op.CONCAT, dst, left, right)
        elif op == "==":
            self._emit(Op.EQ, dst, left, right)
        elif op == "~=":
            self._emit(Op.EQ, dst, left, right)
            self._emit(Op.NOT, dst, dst)
        elif op == "<":
            self._emit(Op.LT, dst, left, right)
        elif op == "<=":
            self._emit(Op.LE, dst, left, right)
        elif op == ">":
            self._emit(Op.LT, dst, right, left)
        elif op == ">=":
            self._emit(Op.LE, dst, right, left)
        else:
            raise CompileError(e.loc, f"지원하지 않는 연산자 '{op}'")
        self.fs.next_reg = mark

    def _call(self, e, dst):
        mark = self.fs.next_reg
        base = self._alloc()
        self._expr(e.callee, base)
        for arg in e.args:
            reg = self._alloc()
            self._expr(arg, reg)
        self._emit(Op.CALL, base, len(e.args))
        if dst != base:
            self._emit(Op.MOVE, dst, base)
        self.fs.next_reg = mark
