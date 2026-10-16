from dataclasses import dataclass

@dataclass
class NilLit:
    loc: object

@dataclass
class BoolLit:
    loc: object
    value: bool

@dataclass
class NumberLit:
    loc: object
    value: float

@dataclass
class StringLit:
    loc: object
    value: str

@dataclass
class NameRef:
    loc: object
    name: str

@dataclass
class UnaryOp:
    loc: object
    op: str
    operand: object

@dataclass
class BinaryOp:
    loc: object
    op: str
    left: object
    right: object

@dataclass
class CallExpr:
    loc: object
    callee: object
    args: list

@dataclass
class LocalStmt:
    loc: object
    names: list
    values: list

@dataclass
class AssignStmt:
    loc: object
    target: object
    value: object

@dataclass
class IfStmt:
    loc: object
    branches: list
    else_body: object

@dataclass
class WhileStmt:
    loc: object
    cond: object
    body: list

@dataclass
class ReturnStmt:
    loc: object
    value: object

@dataclass
class FunctionStmt:
    loc: object
    name: str
    is_local: bool
    params: list
    body: list

@dataclass
class ExprStmt:
    loc: object
    expr: object

@dataclass
class IndexExpr:
    loc: object
    table: object
    key: object

@dataclass
class TableField:
    key: object
    value: object

@dataclass
class TableLit:
    loc: object
    fields: list

@dataclass
class FunctionExpr:
    loc: object
    params: list
    body: list

@dataclass
class NumericForStmt:
    loc: object
    name: str
    start: object
    limit: object
    step: object
    body: list

@dataclass
class RepeatStmt:
    loc: object
    body: list
    cond: object

@dataclass
class BreakStmt:
    loc: object
