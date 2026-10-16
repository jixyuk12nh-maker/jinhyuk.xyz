"""Input validation for the Phase 1 `check` command."""

import os

from cli.limits import MAX_INPUT_BYTES
from frontend.diagnostics import CompileError, SourceLocation

def load_source(path: str) -> str:
    """Read a Luau source file, enforcing size and encoding limits.

    Raises CompileError with a location and cause on failure.
    """
    if not os.path.isfile(path):
        raise CompileError(SourceLocation(path, 1, 1), "파일을 찾을 수 없습니다")

    size = os.path.getsize(path)
    if size > MAX_INPUT_BYTES:
        raise CompileError(
            SourceLocation(path, 1, 1),
            f"입력이 너무 큽니다 ({size} 바이트, 최대 {MAX_INPUT_BYTES} 바이트)",
        )

    with open(path, "rb") as f:
        raw = f.read()

    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        line = raw[: exc.start].count(b"\n") + 1
        column = exc.start - (raw.rfind(b"\n", 0, exc.start) + 1) + 1
        raise CompileError(
            SourceLocation(path, line, column), "UTF-8 인코딩이 아닙니다"
        ) from None
