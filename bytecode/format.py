import struct

from bytecode.chunk import Chunk, Instr, Proto, UpvalueDesc
from frontend.diagnostics import BytecodeError

MAGIC = b"LGVM"
VERSION = 2
INSTR_FORMAT = "<BHHH"
INSTR_SIZE = struct.calcsize(INSTR_FORMAT)
TAG_NIL, TAG_BOOL, TAG_NUMBER, TAG_STRING = 0, 1, 2, 3

def encode_chunk(chunk):
    out = bytearray(MAGIC)
    _pack(out, "<B", VERSION)
    _pack(out, "<H", len(chunk.protos))
    for proto in chunk.protos:
        _encode_proto(out, proto)
    return bytes(out)

def decode_chunk(data):
    if not isinstance(data, (bytes, bytearray)):
        raise BytecodeError("바이트코드는 bytes 형식이어야 합니다")
    reader = _Reader(bytes(data))
    if reader.take(len(MAGIC)) != MAGIC:
        raise BytecodeError("매직 넘버가 일치하지 않습니다")
    (version,) = reader.unpack("<B")
    if version != VERSION:
        raise BytecodeError(f"지원하지 않는 바이트코드 버전 {version}")
    (count,) = reader.unpack("<H")
    protos = [_decode_proto(reader) for _ in range(count)]
    if reader.remaining():
        raise BytecodeError("바이트코드 끝에 불필요한 데이터가 있습니다")
    return Chunk(protos)

def _pack(out, fmt, *values):
    try:
        out += struct.pack(fmt, *values)
    except struct.error:
        raise BytecodeError("값이 바이트코드 인코딩 범위를 벗어났습니다") from None

def _encode_proto(out, proto):
    _pack(out, "<HHH", proto.nparams, proto.nregs, len(proto.upvalues))
    for upvalue in proto.upvalues:
        _pack(out, "<BH", int(upvalue.instack), upvalue.index)
    _pack(out, "<I", len(proto.constants))
    for value in proto.constants:
        _encode_constant(out, value)
    _pack(out, "<I", len(proto.code))
    for ins in proto.code:
        _pack(out, INSTR_FORMAT, ins.op, ins.a, ins.b, ins.c)

def _encode_constant(out, value):
    if value is None:
        _pack(out, "<B", TAG_NIL)
    elif isinstance(value, bool):
        _pack(out, "<BB", TAG_BOOL, int(value))
    elif isinstance(value, float):
        _pack(out, "<Bd", TAG_NUMBER, value)
    elif isinstance(value, str):
        raw = value.encode("utf-8")
        _pack(out, "<BI", TAG_STRING, len(raw))
        out += raw
    else:
        raise BytecodeError(f"지원하지 않는 상수 타입 {type(value).__name__}")

class _Reader:
    def __init__(self, data):
        self._data = data
        self._pos = 0

    def take(self, n):
        end = self._pos + n
        if end > len(self._data):
            raise BytecodeError("바이트코드가 예상보다 짧습니다")
        chunk = self._data[self._pos:end]
        self._pos = end
        return chunk

    def unpack(self, fmt):
        return struct.unpack(fmt, self.take(struct.calcsize(fmt)))

    def remaining(self):
        return len(self._data) - self._pos

def _decode_proto(reader):
    nparams, nregs, nupvalues = reader.unpack("<HHH")
    if nupvalues > reader.remaining() // 3:
        raise BytecodeError("upvalue 개수가 데이터 크기와 맞지 않습니다")
    upvalues = []
    for _ in range(nupvalues):
        instack, index = reader.unpack("<BH")
        if instack not in (0, 1):
            raise BytecodeError("잘못된 upvalue 설명자입니다")
        upvalues.append(UpvalueDesc(bool(instack), index))
    (nconst,) = reader.unpack("<I")
    if nconst > reader.remaining():
        raise BytecodeError("상수 개수가 데이터 크기와 맞지 않습니다")
    constants = [_decode_constant(reader) for _ in range(nconst)]
    (ncode,) = reader.unpack("<I")
    if ncode * INSTR_SIZE > reader.remaining():
        raise BytecodeError("명령어 개수가 데이터 크기와 맞지 않습니다")
    code = [Instr(*reader.unpack(INSTR_FORMAT)) for _ in range(ncode)]
    return Proto(nparams=nparams, nregs=nregs, constants=constants, code=code, upvalues=upvalues)

def _decode_constant(reader):
    (tag,) = reader.unpack("<B")
    if tag == TAG_NIL:
        return None
    if tag == TAG_BOOL:
        (flag,) = reader.unpack("<B")
        if flag not in (0, 1):
            raise BytecodeError("잘못된 불리언 상수입니다")
        return bool(flag)
    if tag == TAG_NUMBER:
        (value,) = reader.unpack("<d")
        return value
    if tag == TAG_STRING:
        (size,) = reader.unpack("<I")
        raw = reader.take(size)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            raise BytecodeError("문자열 상수가 UTF-8이 아닙니다") from None
    raise BytecodeError(f"알 수 없는 상수 태그 {tag}")
