from frontend.ast_nodes import (
    AssignStmt, BinaryOp, BoolLit, CallExpr, ExprStmt, FunctionStmt, IfStmt,
    LocalStmt, NameRef, NilLit, NumberLit, ReturnStmt, StringLit, UnaryOp, WhileStmt,
    IndexExpr, TableField, TableLit, NumericForStmt, RepeatStmt, BreakStmt,
)
from frontend.diagnostics import CompileError
from frontend.lexer import tokenize

BINARY_PRECEDENCE = {
    "or": 1, "and": 2,
    "==": 3, "~=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
    "..": 4, "+": 5, "-": 5, "*": 6, "/": 6, "//": 6, "%": 6, "^": 8,
}

BLOCK_END_KEYWORDS = frozenset({"end", "else", "elseif"})

UNSUPPORTED_SYMBOLS = {
    "...": "가변 인자(...)",
    "::": "레이블(::)",
    ":": "타입 주석(:)",
}

UNSUPPORTED_KEYWORDS = {
    "in": "in",
}

def _describe(tok):
    return "파일 끝" if tok.kind == "EOF" else str(tok.value)

class _Parser:
    def __init__(self, tokens):
        self._tokens = tokens
        self._pos = 0

    def parse_chunk(self):
        stmts = self._block(frozenset())
        tok = self._peek()
        if tok.kind != "EOF":
            raise CompileError(tok.loc, "예상하지 못한 토큰입니다")
        return stmts

    def _peek(self):
        return self._tokens[self._pos]

    def _advance(self):
        tok = self._tokens[self._pos]
        if tok.kind != "EOF":
            self._pos += 1
        return tok

    @staticmethod
    def _is(tok, kind, value=None):
        return tok.kind == kind and (value is None or tok.value == value)

    def _accept(self, kind, value):
        if self._is(self._peek(), kind, value):
            return self._advance()
        return None

    def _expect(self, kind, value, what):
        tok = self._peek()
        if self._is(tok, kind, value):
            return self._advance()
        raise CompileError(tok.loc, f"'{value}'가 필요합니다 ({what})")

    def _expect_name(self):
        tok = self._peek()
        self._guard(tok)
        if tok.kind == "NAME":
            return self._advance().value
        raise CompileError(tok.loc, "이름이 필요합니다")

    @staticmethod
    def _guard(tok):
        if tok.kind == "SYMBOL" and tok.value in UNSUPPORTED_SYMBOLS:
            raise CompileError(tok.loc, f"지원하지 않는 문법: {UNSUPPORTED_SYMBOLS[tok.value]}")
        if tok.kind == "KEYWORD" and tok.value in UNSUPPORTED_KEYWORDS:
            raise CompileError(tok.loc, f"지원하지 않는 문법: {UNSUPPORTED_KEYWORDS[tok.value]}")

    def _block(self, stop):
        stmts = []
        while True:
            tok = self._peek()
            if tok.kind == "EOF" or (tok.kind == "KEYWORD" and tok.value in stop):
                return stmts
            if self._accept("SYMBOL", ";"):
                continue
            if self._is(tok, "KEYWORD", "return"):
                stmts.append(self._return())
                nxt = self._peek()
                if not (nxt.kind == "EOF" or (nxt.kind == "KEYWORD" and nxt.value in stop)):
                    raise CompileError(nxt.loc, "return은 블록의 마지막 문장이어야 합니다")
                return stmts
            stmts.append(self._statement())

    def _return(self):
        tok = self._advance()
        nxt = self._peek()
        ends = (
            nxt.kind == "EOF"
            or (nxt.kind == "KEYWORD" and nxt.value in (BLOCK_END_KEYWORDS | {"until"}))
            or (nxt.kind == "SYMBOL" and nxt.value == ";")
        )
        value = None if ends else self._expr()
        self._accept("SYMBOL", ";")
        return ReturnStmt(tok.loc, value)

    def _statement(self):
        tok = self._peek()
        self._guard(tok)
        if tok.kind == "KEYWORD":
            if tok.value == "local":
                self._advance()
                return self._local(tok)
            if tok.value == "function":
                self._advance()
                name = self._expect_name()
                params, body = self._function_rest()
                return FunctionStmt(tok.loc, name, False, params, body)
            if tok.value == "if":
                self._advance()
                return self._if(tok)
            if tok.value == "while":
                self._advance()
                cond = self._expr()
                self._expect("KEYWORD", "do", "while 조건 뒤")
                body = self._block({"end"})
                self._expect("KEYWORD", "end", "while 본문 뒤")
                return WhileStmt(tok.loc, cond, body)
            if tok.value == "for":
                self._advance()
                name = self._expect_name()
                self._expect("SYMBOL", "=", "숫자형 for 변수 뒤")
                start = self._expr()
                self._expect("SYMBOL", ",", "for 시작 값 뒤")
                limit = self._expr()
                step = None
                if self._accept("SYMBOL", ","):
                    step = self._expr()
                self._expect("KEYWORD", "do", "for 헤더 뒤")
                body = self._block({"end"})
                self._expect("KEYWORD", "end", "for 본문 뒤")
                return NumericForStmt(tok.loc, name, start, limit, step, body)
            if tok.value == "repeat":
                self._advance()
                body = self._block({"until"})
                self._expect("KEYWORD", "until", "repeat 본문 뒤")
                cond = self._expr()
                return RepeatStmt(tok.loc, body, cond)
            if tok.value == "break":
                self._advance()
                return BreakStmt(tok.loc)
            if tok.value == "do":
                raise CompileError(tok.loc, "do 블록은 아직 지원하지 않습니다")
        target = self._suffixed()
        if self._accept("SYMBOL", "="):
            if not isinstance(target, (NameRef, IndexExpr)):
                raise CompileError(target.loc, "대입 대상이 올바르지 않습니다")
            return AssignStmt(target.loc, target, self._expr())
        nxt = self._peek()
        if self._is(nxt, "SYMBOL", ","):
            raise CompileError(nxt.loc, "다중 대입은 아직 지원하지 않습니다")
        if isinstance(target, CallExpr):
            return ExprStmt(target.loc, target)
        raise CompileError(target.loc, "이 식은 문장으로 사용할 수 없습니다")

    def _local(self, tok):
        if self._accept("KEYWORD", "function"):
            name = self._expect_name()
            params, body = self._function_rest()
            return FunctionStmt(tok.loc, name, True, params, body)
        names = [self._expect_name()]
        while self._accept("SYMBOL", ","):
            names.append(self._expect_name())
        self._guard(self._peek())
        values = []
        if self._accept("SYMBOL", "="):
            values.append(self._expr())
            while self._accept("SYMBOL", ","):
                values.append(self._expr())
        return LocalStmt(tok.loc, names, values)

    def _function_rest(self):
        self._expect("SYMBOL", "(", "함수 매개변수 목록")
        params = []
        if not self._accept("SYMBOL", ")"):
            while True:
                self._guard(self._peek())
                params.append(self._expect_name())
                if self._accept("SYMBOL", ")"):
                    break
                self._expect("SYMBOL", ",", "매개변수 구분")
        body = self._block({"end"})
        self._expect("KEYWORD", "end", "함수 본문 뒤")
        return params, body

    def _if(self, tok):
        branches = []
        cond = self._expr()
        self._expect("KEYWORD", "then", "if 조건 뒤")
        branches.append((cond, self._block(BLOCK_END_KEYWORDS)))
        else_body = None
        while True:
            if self._accept("KEYWORD", "elseif"):
                cond = self._expr()
                self._expect("KEYWORD", "then", "elseif 조건 뒤")
                branches.append((cond, self._block(BLOCK_END_KEYWORDS)))
            elif self._accept("KEYWORD", "else"):
                else_body = self._block({"end"})
                self._expect("KEYWORD", "end", "if 블록 끝")
                break
            else:
                self._expect("KEYWORD", "end", "if 블록 끝")
                break
        return IfStmt(tok.loc, branches, else_body)

    def _expr(self, min_prec=0):
        left = self._unary()
        while True:
            tok = self._peek()
            self._guard(tok)
            if tok.kind not in ("SYMBOL", "KEYWORD") or tok.value not in BINARY_PRECEDENCE:
                return left
            prec = BINARY_PRECEDENCE[tok.value]
            if prec <= min_prec:
                return left
            self._advance()
            right = self._expr(prec - 1 if tok.value in ("..", "^") else prec)
            left = BinaryOp(tok.loc, tok.value, left, right)

    def _unary(self):
        tok = self._peek()
        self._guard(tok)
        if (tok.kind == "KEYWORD" and tok.value == "not") or self._is(tok, "SYMBOL", "-") or self._is(tok, "SYMBOL", "#"):
            self._advance()
            return UnaryOp(tok.loc, tok.value, self._expr(7) if tok.value == "-" else self._unary())
        return self._suffixed()

    def _suffixed(self):
        expr = self._primary()
        while True:
            tok = self._peek()
            if self._is(tok, "SYMBOL", ":"):
                self._advance()
                method_name = self._expect_name()
                method = IndexExpr(tok.loc, expr, StringLit(tok.loc, method_name))
                self._expect("SYMBOL", "(", "메서드 호출 인자 목록")
                args = [expr]
                if not self._accept("SYMBOL", ")"):
                    args.append(self._expr())
                    while self._accept("SYMBOL", ","):
                        args.append(self._expr())
                    self._expect("SYMBOL", ")", "메서드 호출 인자 목록 뒤")
                expr = CallExpr(tok.loc, method, args)
                continue
            self._guard(tok)
            if self._is(tok, "SYMBOL", "."):
                self._advance()
                name = self._expect_name()
                expr = IndexExpr(tok.loc, expr, StringLit(tok.loc, name))
                continue
            if self._is(tok, "SYMBOL", "["):
                self._advance()
                key = self._expr()
                self._expect("SYMBOL", "]", "테이블 인덱스 뒤")
                expr = IndexExpr(tok.loc, expr, key)
                continue
            if not self._is(tok, "SYMBOL", "("):
                return expr
            self._advance()
            args = []
            if not self._accept("SYMBOL", ")"):
                args.append(self._expr())
                while self._accept("SYMBOL", ","):
                    args.append(self._expr())
                self._expect("SYMBOL", ")", "함수 인자 목록 뒤")
            expr = CallExpr(tok.loc, expr, args)

    def _primary(self):
        tok = self._peek()
        self._guard(tok)
        if tok.kind == "NUMBER":
            self._advance()
            return NumberLit(tok.loc, tok.value)
        if tok.kind == "STRING":
            self._advance()
            return StringLit(tok.loc, tok.value)
        if tok.kind == "NAME":
            self._advance()
            return NameRef(tok.loc, tok.value)
        if tok.kind == "KEYWORD":
            if tok.value in ("true", "false"):
                self._advance()
                return BoolLit(tok.loc, tok.value == "true")
            if tok.value == "nil":
                self._advance()
                return NilLit(tok.loc)
            if tok.value == "function":
                self._advance()
                params, body = self._function_rest()
                from frontend.ast_nodes import FunctionExpr
                return FunctionExpr(tok.loc, params, body)
        if self._is(tok, "SYMBOL", "{"):
            self._advance()
            fields = []
            array_index = 1
            while not self._accept("SYMBOL", "}"):
                if self._peek().kind == "EOF":
                    raise CompileError(self._peek().loc, "테이블 생성자가 닫히지 않았습니다")
                if self._accept("SYMBOL", "["):
                    key = self._expr()
                    self._expect("SYMBOL", "]", "테이블 키 뒤")
                    self._expect("SYMBOL", "=", "테이블 필드 뒤")
                    value = self._expr()
                elif self._peek().kind == "NAME" and self._pos + 1 < len(self._tokens) and self._tokens[self._pos + 1].value == "=":
                    name_tok = self._advance()
                    self._advance()
                    key = StringLit(name_tok.loc, name_tok.value)
                    value = self._expr()
                else:
                    key = NumberLit(tok.loc, float(array_index))
                    array_index += 1
                    value = self._expr()
                fields.append(TableField(key, value))
                if self._accept("SYMBOL", "}"):
                    break
                if not (self._accept("SYMBOL", ",") or self._accept("SYMBOL", ";")):
                    self._expect("SYMBOL", "}", "테이블 필드 뒤")
                    break
            return TableLit(tok.loc, fields)
        if self._is(tok, "SYMBOL", "("):
            self._advance()
            expr = self._expr()
            self._expect("SYMBOL", ")", "괄호 식 뒤")
            return expr
        raise CompileError(tok.loc, f"식이 필요합니다 (발견: {_describe(tok)})")

def parse(source, file):
    return _Parser(tokenize(source, file)).parse_chunk()
