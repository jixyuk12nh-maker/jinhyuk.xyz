"""Diagnostic (error) reporting shared by all modules.

Every error carries a file name, a source location and a human-readable
cause. Internal state is never included in the message.
"""

from dataclasses import dataclass

class tmError(Exception):
    """Base error for user-facing failures."""

@dataclass(frozen=True)
class SourceLocation:
    file: str
    line: int
    column: int

    def __str__(self) -> str:
        return f"{self.file}:{self.line}:{self.column}"

class CompileError(tmError):
    """Raised when input cannot be processed. Message format: `loc — cause`."""

    def __init__(self, location: SourceLocation, cause: str):
        self.location = location
        self.cause = cause
        super().__init__(f"{location} — {cause}")

class BytecodeError(tmError):
    """Raised when bytecode is malformed or fails verification."""

class LuaRuntimeError(tmError):
    """Raised when a program fails during execution."""

class ExecutionLimitError(LuaRuntimeError):
    """Raised when execution exceeds a configured resource limit."""
