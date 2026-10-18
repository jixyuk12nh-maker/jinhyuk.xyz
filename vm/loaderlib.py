import os
import sys

from frontend.diagnostics import tmError, LuaRuntimeError
from vm.values import LuaFunction, LuaTable, NativeFunction, to_display


def compile_chunk(vm, source, chunkname):
    from bytecode.format import decode_chunk
    from pipeline import compile_source
    name = chunkname[1:] if chunkname[:1] in ("=", "@") else chunkname
    chunk = decode_chunk(compile_source(source, name))
    return vm.load_chunk(chunk)


def _compile_or_message(vm, source, chunkname):
    try:
        return [compile_chunk(vm, source, chunkname)]
    except tmError as exc:
        return [None, str(exc)]


def _arg(args, i):
    return args[i] if i < len(args) else None


def _function_or_none(vm, value):
    return isinstance(value, (LuaFunction, NativeFunction))


def make_loader_lib(vm, globals_table):
    package = LuaTable()
    loaded = LuaTable()
    preload = LuaTable()
    package.set("loaded", loaded)
    package.set("preload", preload)
    package.set("path", "./?.lua;./?/init.lua")
    package.set("cpath", "")

    def loadstring(args):
        source = _arg(args, 0)
        if not isinstance(source, str):
            raise LuaRuntimeError("loadstring: 문자열 인자가 필요합니다 (인자 1)")
        chunkname = _arg(args, 1)
        name = "(loadstring)" if chunkname is None else to_display(chunkname)
        return _compile_or_message(vm, source, name)

    def load(args):
        reader = _arg(args, 0)
        if not _function_or_none(vm, reader):
            raise LuaRuntimeError("load: 읽기 함수 인자가 필요합니다 (인자 1)")
        pieces = []
        while True:
            piece = vm.call1(reader, [])
            if piece is None or piece == "":
                break
            if not isinstance(piece, str):
                return [None, "reader function must return a string"]
            pieces.append(piece)
        chunkname = _arg(args, 1)
        name = "(load)" if chunkname is None else to_display(chunkname)
        return _compile_or_message(vm, "".join(pieces), name)

    def read_file(filename):
        try:
            with open(filename, encoding="utf-8", newline="") as handle:
                return handle.read()
        except OSError as exc:
            raise OSError(f"cannot open {filename}: {exc.strerror}") from None

    def loadfile(args):
        filename = _arg(args, 0)
        if filename is None:
            return _compile_or_message(vm, sys.stdin.read(), "=stdin")
        name = to_display(filename)
        try:
            source = read_file(name)
        except OSError as exc:
            return [None, str(exc)]
        return _compile_or_message(vm, source, "@" + name)

    def dofile(args):
        filename = _arg(args, 0)
        if filename is None:
            result = _compile_or_message(vm, sys.stdin.read(), "=stdin")
        else:
            name = to_display(filename)
            try:
                source = read_file(name)
            except OSError as exc:
                raise LuaRuntimeError(str(exc)) from None
            result = _compile_or_message(vm, source, "@" + name)
        if result[0] is None:
            raise LuaRuntimeError(result[1])
        return vm._call(result[0], [])

    def finish_module(name, result):
        if result is not None:
            loaded.set(name, result)
        if loaded.get(name) is None:
            loaded.set(name, True)
        return [loaded.get(name)]

    def require(args):
        name = _arg(args, 0)
        if not isinstance(name, str):
            raise LuaRuntimeError("require: 문자열 인자가 필요합니다 (인자 1)")
        existing = loaded.get(name)
        if existing is not None:
            return [existing]
        loader = preload.get(name)
        if loader is not None:
            return finish_module(name, vm.call1(loader, [name, ":preload:"]))
        base = name.replace(".", "/")
        path = package.get("path")
        tried = []
        for template in str(path).split(";"):
            filename = template.replace("?", base)
            if os.path.isfile(filename):
                try:
                    source = read_file(filename)
                except OSError as exc:
                    raise LuaRuntimeError(str(exc)) from None
                result = _compile_or_message(vm, source, "@" + filename)
                if result[0] is None:
                    raise LuaRuntimeError(result[1])
                return finish_module(name, vm.call1(result[0], [name, filename]))
            tried.append(filename)
        message = "".join(f"\n\tno file '{f}'" for f in tried)
        raise LuaRuntimeError(f"module '{name}' not found:{message}")

    def module(args):
        name = _arg(args, 0)
        if not isinstance(name, str):
            raise LuaRuntimeError("module: 문자열 인자가 필요합니다 (인자 1)")
        target = loaded.get(name)
        if not isinstance(target, LuaTable):
            existing = globals_table.get(name)
            if isinstance(existing, LuaTable):
                target = existing
            else:
                target = LuaTable()
                globals_table.set(name, target)
            loaded.set(name, target)
        prefix = name.rsplit(".", 1)[0] + "." if "." in name else ""
        target.set("_NAME", name)
        target.set("_M", target)
        target.set("_PACKAGE", prefix)
        if vm.frames:
            vm.frames[-1].env = target
        for option in args[1:]:
            if _function_or_none(vm, option):
                vm._call(option, [target])
        return []

    def seeall(args):
        target = _arg(args, 0)
        if not isinstance(target, LuaTable):
            raise LuaRuntimeError("package.seeall: 테이블 인자가 필요합니다 (인자 1)")
        mt = LuaTable()
        mt.set("__index", globals_table)
        target.meta = mt
        return []

    def loadlib(args):
        return [None, "dynamic libraries not enabled", "absent"]

    package.set("seeall", NativeFunction("package.seeall", seeall))
    package.set("loadlib", NativeFunction("package.loadlib", loadlib))
    for name in ("_G", "string", "table", "math", "io", "os", "coroutine"):
        value = globals_table.get(name)
        if value is not None:
            loaded.set(name, value)
    loaded.set("package", package)

    return {
        "loadstring": NativeFunction("loadstring", loadstring),
        "load": NativeFunction("load", load),
        "loadfile": NativeFunction("loadfile", loadfile),
        "dofile": NativeFunction("dofile", dofile),
        "require": NativeFunction("require", require),
        "module": NativeFunction("module", module),
        "package": package,
    }
