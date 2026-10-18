import re
import sys

from frontend.diagnostics import LuaRuntimeError
from vm.values import LuaTable, LuaUserdata, NativeFunction, coerce_number, to_display, type_name

MODE_PATTERN = re.compile(r"^[rwa]\+?b?$")
NUMBER_CHARS = frozenset("0123456789+-.eExXabcdefABCDEF")
WHENCE = {"set": 0, "cur": 1, "end": 2}


class _Handle:
    def __init__(self, stream, std=False, readable=True, writable=True):
        self.stream = stream
        self.std = std
        self.readable = readable
        self.writable = writable
        self.closed = False


def _arg(args, i):
    return args[i] if i < len(args) else None


def _read_number(stream):
    seekable = stream.seekable() if hasattr(stream, "seekable") else False
    ch = stream.read(1)
    while ch and ch.isspace():
        ch = stream.read(1)
    buf = ""
    while ch and ch in NUMBER_CHARS:
        buf += ch
        before = stream.tell() if seekable else None
        ch = stream.read(1)
    if ch and seekable and before is not None:
        stream.seek(before)
    if not buf:
        return None
    return coerce_number(buf)


def _read_one(stream, fmt):
    if isinstance(fmt, float):
        count = int(fmt)
        if count == 0:
            return ""
        text = stream.read(count)
        return text if text else None
    if not isinstance(fmt, str):
        raise LuaRuntimeError("read: 잘못된 형식입니다")
    name = fmt[1:] if fmt.startswith("*") else fmt
    if name[:1] == "l" or name[:1] == "L":
        line = stream.readline()
        if line == "":
            return None
        if name[:1] == "l" and line.endswith("\n"):
            line = line[:-1]
        return line
    if name[:1] == "a":
        return stream.read()
    if name[:1] == "n":
        return _read_number(stream)
    raise LuaRuntimeError("read: 잘못된 형식입니다")


def make_io_lib(vm):
    file_meta = LuaTable()
    methods = LuaTable()

    stdin_handle = _Handle(sys.stdin, std=True, writable=False)
    stdout_handle = _Handle(vm.output, std=True, readable=False)
    stderr_handle = _Handle(sys.stderr, std=True, readable=False)
    stdin_obj = LuaUserdata(stdin_handle, file_meta)
    stdout_obj = LuaUserdata(stdout_handle, file_meta)
    stderr_obj = LuaUserdata(stderr_handle, file_meta)
    state = {"input": stdin_obj, "output": stdout_obj}

    def as_handle(value, name):
        if not (isinstance(value, LuaUserdata) and isinstance(value.payload, _Handle)):
            raise LuaRuntimeError(f"{name}: 파일 인자가 필요합니다")
        handle = value.payload
        if handle.closed:
            raise LuaRuntimeError("attempt to use a closed file")
        return handle

    def write_values(handle, obj, values):
        if not handle.writable:
            raise LuaRuntimeError("file is not writable")
        for index, value in enumerate(values, 1):
            if not isinstance(value, (str, float)):
                raise LuaRuntimeError(
                    f"bad argument #{index} to 'write' (string expected, got {type_name(value)})")
            handle.stream.write(to_display(value))
        return [obj]

    def read_values(handle, formats):
        if not handle.readable:
            raise LuaRuntimeError("file is not readable")
        if not formats:
            formats = ["l"]
        results = []
        for fmt in formats:
            value = _read_one(handle.stream, fmt)
            results.append(value)
            if value is None:
                break
        return results

    def open_file(name, mode):
        if not MODE_PATTERN.match(mode):
            raise LuaRuntimeError(f"bad argument #2 to 'open' (invalid mode '{mode}')")
        python_mode = mode[0] + ("+" if "+" in mode else "")
        return open(name, python_mode, encoding="utf-8", newline="")

    def io_open(args):
        name = _arg(args, 0)
        if not isinstance(name, str):
            raise LuaRuntimeError("bad argument #1 to 'open' (string expected)")
        mode = _arg(args, 1)
        mode = "r" if mode is None else to_display(mode)
        try:
            stream = open_file(name, mode)
        except OSError as exc:
            return [None, f"{name}: {exc.strerror}", float(exc.errno or 0)]
        readable = mode[0] == "r" or "+" in mode
        writable = mode[0] in "wa" or "+" in mode
        return [LuaUserdata(_Handle(stream, readable=readable, writable=writable), file_meta)]

    def io_write(args):
        return write_values(as_handle(state["output"], "io.write"), state["output"], args)

    def io_read(args):
        return read_values(as_handle(state["input"], "io.read"), args)

    def lines_iterator(handle, formats, close_at_end):
        def step(_):
            if handle.closed:
                return [None]
            values = read_values(handle, formats)
            if values[0] is None and close_at_end:
                handle.stream.close()
                handle.closed = True
            return values
        return NativeFunction("lines_iter", step)

    def io_lines(args):
        name = _arg(args, 0)
        if name is None:
            handle = as_handle(state["input"], "io.lines")
            return [lines_iterator(handle, args[1:], False)]
        try:
            stream = open_file(name, "r")
        except OSError as exc:
            raise LuaRuntimeError(f"{name}: {exc.strerror}") from None
        handle = _Handle(stream)
        return [lines_iterator(handle, args[1:], True)]

    def io_close(args):
        target = _arg(args, 0)
        if target is None:
            target = state["output"]
        return file_close([target])

    def io_type(args):
        value = _arg(args, 0)
        if not (isinstance(value, LuaUserdata) and isinstance(value.payload, _Handle)):
            return [None]
        return ["closed file" if value.payload.closed else "file"]

    def io_input(args):
        return _select_default(args, "input", "r")

    def io_output(args):
        return _select_default(args, "output", "w")

    def _select_default(args, key, mode):
        target = _arg(args, 0)
        if target is None:
            return [state[key]]
        if isinstance(target, str):
            try:
                stream = open_file(target, mode)
            except OSError as exc:
                raise LuaRuntimeError(f"{target}: {exc.strerror}") from None
            state[key] = LuaUserdata(_Handle(stream, readable=mode == "r", writable=mode != "r"), file_meta)
        else:
            as_handle(target, f"io.{key}")
            state[key] = target
        return [state[key]]

    def file_write(args):
        handle = as_handle(_arg(args, 0), "write")
        return write_values(handle, args[0], args[1:])

    def file_read(args):
        handle = as_handle(_arg(args, 0), "read")
        return read_values(handle, args[1:])

    def file_lines(args):
        handle = as_handle(_arg(args, 0), "lines")
        return [lines_iterator(handle, args[1:], False)]

    def file_close(args):
        obj = _arg(args, 0)
        handle = as_handle(obj, "close")
        if handle.std:
            return [None, "cannot close standard file"]
        handle.stream.close()
        handle.closed = True
        return [True]

    def file_flush(args):
        handle = as_handle(_arg(args, 0), "flush")
        if hasattr(handle.stream, "flush"):
            handle.stream.flush()
        return [_arg(args, 0)]

    def file_seek(args):
        handle = as_handle(_arg(args, 0), "seek")
        whence = _arg(args, 1)
        whence = "cur" if whence is None else to_display(whence)
        if whence not in WHENCE:
            raise LuaRuntimeError(f"bad argument #2 to 'seek' (invalid option '{whence}')")
        offset = _arg(args, 2)
        offset = 0 if offset is None else int(coerce_number(offset) or 0)
        if WHENCE[whence] == 0:
            handle.stream.seek(offset)
        elif offset != 0:
            raise LuaRuntimeError("seek: 텍스트 파일에서는 현재/끝 위치 기준 오프셋을 지원하지 않습니다")
        else:
            handle.stream.seek(0, WHENCE[whence])
        return [float(handle.stream.tell())]

    def file_setvbuf(args):
        as_handle(_arg(args, 0), "setvbuf")
        return [True]

    def file_tostring(args):
        value = _arg(args, 0)
        handle = value.payload if isinstance(value, LuaUserdata) else None
        if isinstance(handle, _Handle) and handle.closed:
            return ["file (closed)"]
        return ["file (0x%08x)" % (id(value) & 0xFFFFFFFF)]

    method_fns = {
        "write": file_write,
        "read": file_read,
        "lines": file_lines,
        "close": file_close,
        "flush": file_flush,
        "seek": file_seek,
        "setvbuf": file_setvbuf,
    }
    for key, fn in method_fns.items():
        methods.set(key, NativeFunction(f"file:{key}", fn))
    file_meta.set("__index", methods)
    file_meta.set("__name", "FILE*")
    file_meta.set("__tostring", NativeFunction("file:__tostring", file_tostring))

    table = LuaTable()
    io_fns = {
        "open": io_open,
        "write": io_write,
        "read": io_read,
        "lines": io_lines,
        "close": io_close,
        "type": io_type,
        "input": io_input,
        "output": io_output,
    }
    for key, fn in io_fns.items():
        table.set(key, NativeFunction(f"io.{key}", fn))
    table.set("stdin", stdin_obj)
    table.set("stdout", stdout_obj)
    table.set("stderr", stderr_obj)
    return table
