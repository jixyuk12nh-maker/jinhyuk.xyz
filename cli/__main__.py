"""Command-line entry point: `python3 -m cli check|run <file>`."""

import sys
import random

from cli.checks import load_source
from frontend.diagnostics import tmError
from pipeline import compile_source, run_source
from packager import pack_source

USAGE = "사용법: python3 -m cli check <input.lua> | python3 -m cli run <input.lua> | python3 -m cli pack <input.lua> <output.lua> [seed]"

def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("check", "run", "pack"):
        print(USAGE, file=sys.stderr)
        return 2
    command = argv[0]
    if command in ("check", "run") and len(argv) != 2:
        print(USAGE, file=sys.stderr); return 2
    if command == "pack" and len(argv) not in (3, 4):
        print(USAGE, file=sys.stderr); return 2
    path = argv[1]
    try:
        source = load_source(path)
        if command == "check":
            compile_source(source, path)
            print(f"OK: {path} ({len(source.encode('utf-8'))} 바이트)")
        elif command == "run":
            run_source(source, path, sys.stdout)
        else:
            output_path = argv[2]
            seed = int(argv[3]) if len(argv) == 4 else None
            generated = pack_source(source, path, seed=seed)
            with open(output_path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(generated)
            print(f"OK: {output_path} ({len(generated.encode('utf-8'))} bytes)")
    except tmError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"오류: 잘못된 인수입니다 ({exc})", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"오류: 파일을 읽거나 쓸 수 없습니다 ({exc})", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
