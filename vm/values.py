import math

class LuaTable:
    __slots__ = ("entries",)

    def __init__(self):
        self.entries = {}

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
        return self.entries.get(self._key(key), (None, None))[1]

    def set(self, key, value):
        k = self._key(key)
        if value is None:
            self.entries.pop(k, None)
        else:
            self.entries[k] = (key, value)

class UpvalueCell:
    __slots__ = ("value",)

    def __init__(self, value=None):
        self.value = value

class LuaFunction:
    __slots__ = ("proto", "upvalues")

    def __init__(self, proto, upvalues=None):
        self.proto = proto
        self.upvalues = list(upvalues or [])

class NativeFunction:
    __slots__ = ("name", "fn")

    def __init__(self, name, fn):
        self.name = name
        self.fn = fn

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
    if isinstance(value, LuaTable):
        return "table"
    return "function"
