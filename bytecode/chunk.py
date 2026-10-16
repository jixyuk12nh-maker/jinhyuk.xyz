from dataclasses import dataclass
from typing import NamedTuple

class Instr(NamedTuple):
    op: int
    a: int
    b: int
    c: int

@dataclass(frozen=True)
class UpvalueDesc:
    instack: bool
    index: int

@dataclass
class Proto:
    nparams: int
    nregs: int
    constants: list
    code: list
    upvalues: list = None

    def __post_init__(self):
        if self.upvalues is None:
            self.upvalues = []

@dataclass
class Chunk:
    protos: list
