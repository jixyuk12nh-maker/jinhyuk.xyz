import math
import re

_DECIMAL_TEXT = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")
_HEX_TEXT = re.compile(r"^[+-]?0[xX][0-9a-fA-F]+$")


class LuaTable:
    __slots__ = ("entries", "_keys", "_positions", "meta")

    def __init__(self):
        self.entries = {}
        self._keys = None
        self._positions = None
        self.meta = None

    @staticmethod
    def _key(key):
        if key is None:
            raise ValueError("table index is nil")
        if isinstance(key, float) and math.isnan(key):
            raise ValueError("table index is NaN")
        if isinstance(key, (str, bool, float)):
            return (type(key), key)
        return (type(key), id(key))

    def get(self, key):
        entry = self.entries.get(self._key(key))
        return None if entry is None else entry[1]

    def set(self, key, value):
        k = self._key(key)
        entry = self.entries.get(k)
        if entry is None:
            if value is not None:
                self.entries[k] = (key, value)
                self._keys = None
        else:
            self.entries[k] = (entry[0], value)

    def next(self, key):
        if self._keys is None:
            self._keys = list(self.entries)
            self._positions = {k: i for i, k in enumerate(self._keys)}
        if key is None:
            start = 0
        else:
            k = self._key(key)
            if k not in self._positions:
                raise ValueError("invalid key to 'next'")
            start = self._positions[k] + 1
        for i in range(start, len(self._keys)):
            original, value = self.entries[self._keys[i]]
            if value is not None:
                return original, value
        return None

    def length(self):
        n = 0
        while self.get(float(n + 1)) is not None:
            n += 1
        return n


class UpvalueCell:
    __slots__ = ("value",)

    def __init__(self, value=None):
        self.value = value


class LuaFunction:
    __slots__ = ("proto", "upvalues", "chunk", "env")

    def __init__(self, proto, upvalues=None, chunk=None, env=None):
        self.proto = proto
        self.upvalues = list(upvalues or [])
        self.chunk = chunk
        self.env = env


class NativeFunction:
    __slots__ = ("name", "fn")

    def __init__(self, name, fn):
        self.name = name
        self.fn = fn


class LuaThread:
    __slots__ = ("fn", "status", "depth", "frames", "os_thread", "resume_sem", "yield_sem",
                 "transfer", "error")

    def __init__(self, fn):
        self.fn = fn
        self.status = "suspended"
        self.depth = 0
        self.frames = []
        self.os_thread = None
        self.resume_sem = None
        self.yield_sem = None
        self.transfer = []
        self.error = None


class LuaUserdata:
    __slots__ = ("meta", "payload")

    def __init__(self, payload=None, meta=None):
        self.meta = meta
        self.payload = payload


def coerce_number(value):
    if isinstance(value, float):
        return value
    if isinstance(value, str):
        text = value.strip()
        if _DECIMAL_TEXT.match(text):
            return float(text)
        if _HEX_TEXT.match(text):
            return float(int(text, 16))
    return None


def truthy(value):
    return value is not None and value is not False


def type_name(value):
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, LuaTable):
        return "table"
    if isinstance(value, LuaThread):
        return "thread"
    if isinstance(value, LuaUserdata):
        return "userdata"
    return "function"


def format_number(x):
    if math.isnan(x):
        return "nan"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    if x.is_integer() and abs(x) < 1e15:
        return str(int(x))
    return "%.14g" % x


def to_display(value):
    if value is None:
        return "nil"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float):
        return format_number(value)
    if isinstance(value, str):
        return value
    return "%s: 0x%08x" % (type_name(value), id(value) & 0xFFFFFFFF)
