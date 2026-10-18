import threading

from frontend.diagnostics import LuaRuntimeError
from vm.values import LuaFunction, LuaTable, LuaThread, NativeFunction, to_display

STACK_SIZE = 64 * 1024 * 1024


def _error_value(exc):
    return exc.value if hasattr(exc, "value") else str(exc)


def _run(vm, co):
    try:
        co.transfer = list(vm._call(co.fn, co.transfer))
    except LuaRuntimeError as exc:
        co.error = _error_value(exc)
        co.transfer = []
    except RecursionError:
        co.error = "스택 오버플로"
        co.transfer = []
    except Exception as exc:
        co.error = f"내부 오류: {exc}"
        co.transfer = []
    co.status = "dead"
    co.yield_sem.release()


def resume(vm, co, args):
    if co.status == "dead":
        return [False, "cannot resume dead coroutine"]
    if co.status != "suspended":
        return [False, "cannot resume non-suspended coroutine"]
    previous = vm.coroutines[-1] if vm.coroutines else None
    if previous is not None:
        previous.status = "normal"
    co.status = "running"
    co.transfer = list(args)
    saved_depth, saved_frames = vm.depth, vm.frames
    vm.depth, vm.frames = co.depth, co.frames
    vm.coroutines.append(co)
    if co.os_thread is None:
        co.resume_sem = threading.Semaphore(0)
        co.yield_sem = threading.Semaphore(0)
        threading.stack_size(STACK_SIZE)
        co.os_thread = threading.Thread(target=_run, args=(vm, co), daemon=True)
        co.os_thread.start()
    else:
        co.resume_sem.release()
    co.yield_sem.acquire()
    co.depth, co.frames = vm.depth, vm.frames
    vm.depth, vm.frames = saved_depth, saved_frames
    vm.coroutines.pop()
    if previous is not None:
        previous.status = "running"
    if co.error is not None:
        message = co.error
        co.error = None
        return [False, message]
    return [True] + co.transfer


def yield_(vm, args):
    if not vm.coroutines:
        raise LuaRuntimeError("attempt to yield from outside a coroutine")
    co = vm.coroutines[-1]
    co.transfer = list(args)
    co.status = "suspended"
    co.yield_sem.release()
    co.resume_sem.acquire()
    return list(co.transfer)


def _check_thread(args, name):
    value = args[0] if args else None
    if not isinstance(value, LuaThread):
        raise LuaRuntimeError(f"{name}: 코루틴 인자가 필요합니다 (인자 1)")
    return value


def make_coroutine_lib(vm):
    def co_create(args):
        fn = args[0] if args else None
        if not isinstance(fn, (LuaFunction, NativeFunction)):
            raise LuaRuntimeError("coroutine.create: 함수 인자가 필요합니다 (인자 1)")
        return [LuaThread(fn)]

    def co_resume(args):
        co = _check_thread(args, "coroutine.resume")
        return resume(vm, co, args[1:])

    def co_yield(args):
        return yield_(vm, args)

    def co_status(args):
        return [_check_thread(args, "coroutine.status").status]

    def co_running(args):
        return [vm.coroutines[-1] if vm.coroutines else None]

    def co_wrap(args):
        fn = args[0] if args else None
        if not isinstance(fn, (LuaFunction, NativeFunction)):
            raise LuaRuntimeError("coroutine.wrap: 함수 인자가 필요합니다 (인자 1)")
        co = LuaThread(fn)

        def wrapped(call_args):
            result = resume(vm, co, call_args)
            if result[0] is False:
                failure = LuaRuntimeError(to_display(result[1]))
                failure.value = result[1]
                raise failure
            return result[1:]

        return [NativeFunction("coroutine.wrap", wrapped)]

    table = LuaTable()
    for key, fn in {
        "create": co_create,
        "resume": co_resume,
        "yield": co_yield,
        "status": co_status,
        "running": co_running,
        "wrap": co_wrap,
    }.items():
        table.set(key, NativeFunction(f"coroutine.{key}", fn))
    return table
