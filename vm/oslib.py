import os
import subprocess
import sys
import tempfile
import time

from frontend.diagnostics import LuaRuntimeError
from vm.values import LuaTable, NativeFunction, coerce_number, to_display


def _arg(args, i):
    return args[i] if i < len(args) else None


def _date_field(table, key, default=None):
    value = table.get(key)
    if value is None:
        if default is None:
            raise LuaRuntimeError(f"field '{key}' missing in date table")
        return default
    number = coerce_number(value)
    if number is None:
        raise LuaRuntimeError(f"field '{key}' is not an integer")
    return int(number)


def _os_time(args):
    table = _arg(args, 0)
    if table is None:
        return [float(int(time.time()))]
    if not isinstance(table, LuaTable):
        raise LuaRuntimeError("os.time: 테이블 인자가 필요합니다 (인자 1)")
    fields = (
        _date_field(table, "year"),
        _date_field(table, "month"),
        _date_field(table, "day"),
        _date_field(table, "hour", 12),
        _date_field(table, "min", 0),
        _date_field(table, "sec", 0),
        0,
        0,
        -1,
    )
    return [float(time.mktime(fields))]


def _os_date(args):
    fmt = _arg(args, 0)
    fmt = "%c" if fmt is None else to_display(fmt)
    stamp = _arg(args, 1)
    seconds = time.time() if stamp is None else coerce_number(stamp)
    if seconds is None:
        raise LuaRuntimeError("os.date: 시간 인자가 올바르지 않습니다 (인자 2)")
    utc = fmt.startswith("!")
    if utc:
        fmt = fmt[1:]
    moment = time.gmtime(seconds) if utc else time.localtime(seconds)
    if fmt.startswith("*t"):
        table = LuaTable()
        table.set("year", float(moment.tm_year))
        table.set("month", float(moment.tm_mon))
        table.set("day", float(moment.tm_mday))
        table.set("hour", float(moment.tm_hour))
        table.set("min", float(moment.tm_min))
        table.set("sec", float(moment.tm_sec))
        table.set("wday", float((moment.tm_wday + 1) % 7 + 1))
        table.set("yday", float(moment.tm_yday))
        table.set("isdst", bool(moment.tm_isdst > 0))
        return [table]
    return [time.strftime(fmt, moment)]


def _os_exit(args):
    code = _arg(args, 0)
    if code is None or code is True:
        status = 0
    elif code is False:
        status = 1
    else:
        status = int(coerce_number(code) or 0)
    sys.stdout.flush()
    raise SystemExit(status)


def _os_execute(args):
    command = _arg(args, 0)
    if command is None:
        return [True]
    return [float(subprocess.call(to_display(command), shell=True))]


def _file_result(action, name):
    try:
        action()
        return [True]
    except OSError as exc:
        return [None, f"{name}: {exc.strerror}", float(exc.errno or 0)]


def make_os_lib(vm):
    def os_getenv(args):
        name = _arg(args, 0)
        if not isinstance(name, str):
            raise LuaRuntimeError("os.getenv: 문자열 인자가 필요합니다 (인자 1)")
        return [os.environ.get(name)]

    def os_remove(args):
        name = to_display(_arg(args, 0))
        return _file_result(lambda: os.remove(name), name)

    def os_rename(args):
        old = to_display(_arg(args, 0))
        new = to_display(_arg(args, 1))
        return _file_result(lambda: os.rename(old, new), old)

    def os_tmpname(args):
        fd, path = tempfile.mkstemp()
        os.close(fd)
        return [path]

    def os_difftime(args):
        t2 = coerce_number(_arg(args, 0))
        t1 = coerce_number(_arg(args, 1))
        if t2 is None:
            raise LuaRuntimeError("os.difftime: 숫자 인자가 필요합니다 (인자 1)")
        return [t2 - (t1 if t1 is not None else 0.0)]

    def os_clock(args):
        return [float(time.process_time())]

    def os_setlocale(args):
        return ["C"]

    table = LuaTable()
    for key, fn in {
        "time": _os_time,
        "clock": os_clock,
        "date": _os_date,
        "difftime": os_difftime,
        "getenv": os_getenv,
        "remove": os_remove,
        "rename": os_rename,
        "tmpname": os_tmpname,
        "exit": _os_exit,
        "execute": _os_execute,
        "setlocale": os_setlocale,
    }.items():
        table.set(key, NativeFunction(f"os.{key}", fn))
    return table
