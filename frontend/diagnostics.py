
from dataclasses import dataclass

class tmError(Exception):
    pass

@dataclass(frozen=True)
class SourceLocation:
    file: str
    line: int
    column: int

    def __str__(self) -> str:
        return f"{self.file}:{self.line}:{self.column}"

class CompileError(tmError):

    def __init__(self, location: SourceLocation, cause: str):
        self.location = location
        self.cause = cause
        super().__init__(f"{location} — {cause}")

class BytecodeError(tmError):
    pass

class LuaRuntimeError(tmError):
    pass

class ExecutionLimitError(LuaRuntimeError):
    pass
