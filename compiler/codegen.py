from bytecode.chunk import Chunk, Instr, Proto, UpvalueDesc
from bytecode.limits import MAX_CONSTANTS, MAX_PROTOS, MAX_REGISTERS
from bytecode.opcodes import Op
from frontend.ast_nodes import (
    AssignStmt, BinaryOp, BoolLit, BreakStmt, CallExpr, DoStmt, ExprStmt, FunctionExpr,
    FunctionStmt, GenericForStmt, GotoStmt, IfStmt, IndexExpr, LabelStmt, LocalStmt,
    MethodCall, NameRef, NilLit, NumberLit, NumericForStmt, ParenExpr, RepeatStmt,
    ReturnStmt, StringLit, TableLit, UnaryOp, VarArgExpr, WhileStmt,
)
from frontend.diagnostics import CompileError

ARITH_OPS = {"+": Op.ADD, "-": Op.SUB, "*": Op.MUL, "/": Op.DIV, "%": Op.MOD, "^": Op.POW, "//": Op.IDIV}

MULTI_NODES = (CallExpr, MethodCall, VarArgExpr)

def _is_multi(e):
    return isinstance(e, MULTI_NODES)

class Label:
    __slots__ = ("index",)

    def __init__(self):
        self.index = None

class _FunctionState:
    def __init__(self, parent, is_vararg=False):
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
        self.is_vararg = is_vararg
        self.label_scopes = []

def _target(x):
    if isinstance(x, Label):
        if x.index is None:
            raise RuntimeError("내부 오류: 레이블이 배치되지 않았습니다")
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
        self.fs = _FunctionState(None, is_vararg=True)
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
                     constants=fs.constants, code=code, upvalues=list(fs.upvalues),
                     is_vararg=fs.is_vararg)

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

    def _check_vararg(self, e):
        if not self.fs.is_vararg:
            raise CompileError(e.loc, "'...'는 가변 인자 함수 안에서만 사용할 수 있습니다")

    def _push_labels(self, stmts):
        scope = {}
        for s in stmts:
            if isinstance(s, LabelStmt):
                if s.name in scope or any(s.name in sc for sc in self.fs.label_scopes):
                    raise CompileError(s.loc, f"레이블 '{s.name}'이(가) 중복되었습니다")
                scope[s.name] = Label()
        self.fs.label_scopes.append(scope)

    def _pop_labels(self):
        self.fs.label_scopes.pop()

    def _block(self, stmts):
        locals_mark = len(self.fs.locals)
        reg_mark = self.fs.next_reg
        self._push_labels(stmts)
        for s in stmts:
            self._stmt(s)
        self._pop_labels()
        self._close_locals(locals_mark)
        self.fs.next_reg = reg_mark

    def _close_locals(self, mark):
        for _, reg in self.fs.locals[mark:]:
            self._emit(Op.NEWLOCAL, reg)
        del self.fs.locals[mark:]

    def _stmt(self, s):
        self.loc = s.loc
        if isinstance(s, LocalStmt):
            self._local(s)
        elif isinstance(s, AssignStmt):
            self._assign(s)
        elif isinstance(s, ExprStmt):
            mark = self.fs.next_reg
            self._emit_call(s.expr, 1)
            self.fs.next_reg = mark
        elif isinstance(s, IfStmt):
            self._if(s)
        elif isinstance(s, DoStmt):
            self._block(s.body)
        elif isinstance(s, WhileStmt):
            self._while(s)
        elif isinstance(s, NumericForStmt):
            self._numeric_for(s)
        elif isinstance(s, GenericForStmt):
            self._generic_for(s)
        elif isinstance(s, RepeatStmt):
            self._repeat(s)
        elif isinstance(s, BreakStmt):
            if not self.break_targets:
                raise CompileError(s.loc, "break는 반복문 안에서만 사용할 수 있습니다")
            label, mark = self.break_targets[-1]
            for _, reg in self.fs.locals[mark:]:
                self._emit(Op.NEWLOCAL, reg)
            self._emit(Op.JMP, label)
        elif isinstance(s, GotoStmt):
            for scope in reversed(self.fs.label_scopes):
                if s.name in scope:
                    self._emit(Op.JMP, scope[s.name])
                    break
            else:
                raise CompileError(s.loc, f"레이블 '{s.name}'을(를) 찾을 수 없습니다")
        elif isinstance(s, LabelStmt):
            self._place(self.fs.label_scopes[-1][s.name])
        elif isinstance(s, ReturnStmt):
            self._return(s)
        elif isinstance(s, FunctionStmt):
            self._function_stmt(s)
        else:
            raise CompileError(s.loc, "지원하지 않는 문장입니다")

    def _explist_into(self, exprs, regs):
        n = len(regs)
        filled = 0
        for i, e in enumerate(exprs):
            if i < n and i == len(exprs) - 1 and _is_multi(e):
                k = n - i
                mark = self.fs.next_reg
                base = self._multi_fixed(e, k)
                for j in range(k):
                    self._emit(Op.MOVE, regs[i + j], base + j)
                self.fs.next_reg = mark
                filled = n
            elif i < n:
                self._expr(e, regs[i])
                filled = i + 1
            else:
                mark = self.fs.next_reg
                tmp = self._alloc()
                self._expr(e, tmp)
                self.fs.next_reg = mark
        for j in range(filled, n):
            self._emit(Op.LOADK, regs[j], self._const(None))

    def _explist_regs(self, exprs, n):
        regs = [self._alloc() for _ in range(n)]
        self._explist_into(exprs, regs)
        return regs

    def _local(self, s):
        mark = self.fs.next_reg
        regs = [self._alloc() for _ in s.names]
        for reg in regs:
            self._emit(Op.NEWLOCAL, reg)
        self._explist_into(s.values, regs)
        self.fs.next_reg = mark + len(regs)
        for name, reg in zip(s.names, regs):
            self.fs.locals.append((name, reg))

    def _assign(self, s):
        mark = self.fs.next_reg
        regs = self._explist_regs(s.values, len(s.targets))
        for target, reg in zip(s.targets, regs):
            self._store(target, reg)
        self.fs.next_reg = mark

    def _store(self, target, reg):
        if isinstance(target, NameRef):
            resolved = self._resolve(target.name, target.loc)
            if resolved is None:
                self._emit(Op.SETGLOBAL, reg, self._const(target.name))
            elif isinstance(resolved, tuple):
                self._emit(Op.SETUPVAL, reg, resolved[1])
            else:
                self._emit(Op.MOVE, resolved, reg)
        elif isinstance(target, IndexExpr):
            mark = self.fs.next_reg
            table = self._alloc()
            key = self._alloc()
            self._expr(target.table, table)
            self._expr(target.key, key)
            self._emit(Op.SETTABLE, table, key, reg)
            self.fs.next_reg = mark
        else:
            raise CompileError(target.loc, "대입 대상이 올바르지 않습니다")

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
        self.break_targets.append((end, len(self.fs.locals)))
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
        var = self._alloc()
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
        self.fs.locals.append((s.name, var))
        self._emit(Op.NEWLOCAL, var)
        self._emit(Op.MOVE, var, base)
        self.break_targets.append((end, locals_mark))
        self._block(s.body)
        self.break_targets.pop()
        self._close_locals(locals_mark)
        self._emit(Op.FORSTEP, base)
        self._emit(Op.JMP, start)
        self._place(end)
        self._emit(Op.NEWLOCAL, var)
        self.fs.next_reg = mark

    def _generic_for(self, s):
        mark = self.fs.next_reg
        hidden = self._explist_regs(s.exprs, 3)
        nvars = len(s.names)
        nil_reg = self._alloc()
        self._emit(Op.LOADK, nil_reg, self._const(None))
        flag = self._alloc()
        call = [self._alloc() for _ in range(max(3, nvars))]
        start = Label()
        end = Label()
        self._place(start)
        for i in range(3):
            self._emit(Op.MOVE, call[i], hidden[i])
        self._emit(Op.CALL, call[0], 2, nvars + 1)
        self._emit(Op.EQ, flag, call[0], nil_reg)
        self._emit(Op.JMPIF, flag, end)
        self._emit(Op.MOVE, hidden[2], call[0])
        locals_mark = len(self.fs.locals)
        var_regs = [self._alloc() for _ in s.names]
        for reg, src in zip(var_regs, call):
            self._emit(Op.NEWLOCAL, reg)
            self._emit(Op.MOVE, reg, src)
        self.fs.locals.extend(zip(s.names, var_regs))
        self.break_targets.append((end, locals_mark))
        self._block(s.body)
        self.break_targets.pop()
        self._close_locals(locals_mark)
        self._emit(Op.JMP, start)
        self._place(end)
        self.fs.next_reg = mark

    def _repeat(self, s):
        locals_mark = len(self.fs.locals)
        reg_mark = self.fs.next_reg
        start = Label()
        end = Label()
        self._place(start)
        self._push_labels(s.body)
        self.break_targets.append((end, locals_mark))
        for stmt in s.body:
            self._stmt(stmt)
        self.break_targets.pop()
        self._pop_labels()
        cond = self._alloc()
        self._expr(s.cond, cond)
        self._close_locals(locals_mark)
        self._emit(Op.JMPIFNOT, cond, start)
        self._place(end)
        self.fs.next_reg = reg_mark

    def _return(self, s):
        mark = self.fs.next_reg
        values = s.values
        if not values:
            self._emit(Op.RETURN, 0, 0)
        elif _is_multi(values[-1]):
            base = self.fs.next_reg
            fixed = values[:-1]
            regs = [self._alloc() for _ in fixed]
            for reg, e in zip(regs, fixed):
                self._expr(e, reg)
            self._multi_pending(values[-1])
            self._emit(Op.RETURNV, base, len(fixed))
        else:
            base = self.fs.next_reg
            regs = [self._alloc() for _ in values]
            for reg, e in zip(regs, values):
                self._expr(e, reg)
            self._emit(Op.RETURN, base, len(values))
        self.fs.next_reg = mark

    def _function_stmt(self, s):
        if s.is_local:
            reg = self._alloc()
            self.fs.locals.append((s.name, reg))
            self._emit(Op.NEWLOCAL, reg)
            idx = self._function(s.params, s.body, s.vararg)
            self._emit(Op.CLOSURE, reg, idx)
            return
        self._assign(AssignStmt(s.loc, [s.target], [FunctionExpr(s.loc, s.params, s.body, s.vararg)]))

    def _function(self, params, body, vararg=False):
        if len(self.protos) >= MAX_PROTOS:
            raise CompileError(self.loc, "함수 개수 한도를 초과했습니다")
        idx = len(self.protos)
        self.protos.append(None)
        parent = self.fs
        self.fs = _FunctionState(parent, is_vararg=vararg)
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
        self._emit(Op.RETURN, 0, 0)

    def _multi_fixed(self, e, k):
        if isinstance(e, VarArgExpr):
            self._check_vararg(e)
            base = self._alloc()
            for _ in range(k - 1):
                self._alloc()
            self._emit(Op.VARARG, base, k)
            return base
        return self._emit_call(e, k + 1)

    def _multi_pending(self, e):
        if isinstance(e, VarArgExpr):
            self._check_vararg(e)
            self._emit(Op.VARARG, 0, 0)
        else:
            self._emit_call(e, 0)

    def _emit_call(self, e, c):
        base = self._alloc()
        if isinstance(e, MethodCall):
            recv = self._alloc()
            self._expr(e.obj, recv)
            key = self._alloc()
            self._emit(Op.LOADK, key, self._const(e.name))
            self._emit(Op.GETTABLE, base, recv, key)
            self.fs.next_reg = recv + 1
            nargs = 1
            args = e.args
        else:
            self._expr(e.callee, base)
            nargs = 0
            args = e.args
        tail = bool(args) and _is_multi(args[-1])
        fixed = args[:-1] if tail else args
        for arg in fixed:
            reg = self._alloc()
            self._expr(arg, reg)
        nargs += len(fixed)
        if tail:
            self._multi_pending(args[-1])
        self._emit(Op.CALLV if tail else Op.CALL, base, nargs, c)
        self.fs.next_reg = base
        for _ in range(max(c - 1, 1)):
            self._alloc()
        return base

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
        elif isinstance(e, ParenExpr):
            self._expr(e.expr, dst)
        elif isinstance(e, VarArgExpr):
            self._check_vararg(e)
            self._emit(Op.VARARG, dst, 1)
        elif isinstance(e, UnaryOp):
            self._unary(e, dst)
        elif isinstance(e, BinaryOp):
            self._binary(e, dst)
        elif isinstance(e, (CallExpr, MethodCall)):
            mark = self.fs.next_reg
            base = self._emit_call(e, 2)
            if dst != base:
                self._emit(Op.MOVE, dst, base)
            self.fs.next_reg = mark
        elif isinstance(e, FunctionExpr):
            idx = self._function(e.params, e.body, e.vararg)
            self._emit(Op.CLOSURE, dst, idx)
        elif isinstance(e, TableLit):
            self._table(e, dst)
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

    def _table(self, e, dst):
        self._emit(Op.NEWTABLE, dst)
        mark = self.fs.next_reg
        last = len(e.fields) - 1
        for i, field in enumerate(e.fields):
            if field.positional and i == last and _is_multi(field.value):
                self._multi_pending(field.value)
                key = self._alloc()
                self._emit(Op.LOADK, key, self._const(field.key.value))
                self._emit(Op.APPENDV, dst, key)
            else:
                key = self._alloc()
                value = self._alloc()
                self._expr(field.key, key)
                self._expr(field.value, value)
                self._emit(Op.SETTABLE, dst, key, value)
            self.fs.next_reg = mark

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
