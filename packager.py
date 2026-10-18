import random
from bytecode.opcodes import Op
from bytecode.format import decode_chunk
from pipeline import compile_source

def _q(value: str) -> str:
    out = ['"']
    for ch in value:
        n = ord(ch)
        if ch == '"': out.append('\\"')
        elif ch == '\\': out.append('\\\\')
        elif ch == '\n': out.append('\\n')
        elif ch == '\r': out.append('\\r')
        elif ch == '\t': out.append('\\t')
        elif n < 32 or n == 127: out.append('\\%03d' % n)
        else: out.append(ch)
    out.append('"')
    return ''.join(out)

def _constant(value, key):
    if value is None: return '{t=0}'
    if isinstance(value, bool): return '{t=1,v=%s}' % ('true' if value else 'false')
    if isinstance(value, float):
        if value != value: return '{t=2,v=0/0}'
        if value == float('inf'): return '{t=2,v=math.huge}'
        if value == float('-inf'): return '{t=2,v=-math.huge}'
        return '{t=2,v=%s}' % repr(value)
    if isinstance(value, str):
        encoded = '{' + ','.join(str(byte ^ key) for byte in value.encode('utf-8')) + '}'
        return '{t=3,e=%s}' % encoded
    raise TypeError('Unsupported constant: %r' % (value,))

RUNTIME = r'''
local function constant(p, index)
  local c = p.constants[index + 1]
  if not c then error("invalid constant index", 0) end
  if c.t ~= 3 then return c.v end
  local out = {}
  for i = 1, #c.e do out[i] = string.char(bit32.bxor(c.e[i], CK)) end
  return table.concat(out)
end
local ENV = {}
local MAX_STEPS, MAX_DEPTH = 1000000, 128
local steps, depth = 0, 0
local function cell(v) return { value = v } end
local function truthy(v) return v ~= nil and v ~= false end
local function display(v)
  if v == nil then return "nil" end
  if v == true then return "true" elseif v == false then return "false" end
  if type(v) == "number" then
    if v ~= v then return "nan" elseif v == math.huge then return "inf" elseif v == -math.huge then return "-inf" end
    if v % 1 == 0 and math.abs(v) < 1e15 then return string.format("%.0f", v) end
    return string.format("%.14g", v)
  end
  if type(v) == "table" then return "table" end
  if type(v) == "function" then return "function" end
  return tostring(v)
end
local function luaLen(v)
  if type(v) == "string" or type(v) == "table" then return #v end
  error("length operand must be a string or table", 0)
end
local function callValue(f, args)
  if type(f) ~= "function" then error("attempt to call a non-function", 0) end
  return table.pack(f(table.unpack(args, 1, args.n)))
end
local invoke
local function makeClosure(p, ups)
  return function(...)
    return invoke(p, ups, table.pack(...))
  end
end
local function execute(p, ups, regs, varargs)
  local pc = 0
  local pending = { n = 0 }
  while true do
    steps = steps + 1
    if steps > MAX_STEPS then error("instruction limit exceeded", 0) end
    local ins = p.code[pc + 1]
    if not ins then error("invalid program counter", 0) end
    local here = pc
    local op = ((ins[1] - OO - (here + 1) * OS) * OI) % 256
    local a = (ins[2] - AK - (here + 1) * AS) % MOD32
    local b = (ins[3] - BK - (here + 1) * BS) % MOD32
    local c = (ins[4] - CK2 - (here + 1) * CS) % MOD32
    pc = pc + 1
'''

RUNTIME_TAIL = r'''
    else error("unknown opcode", 0) end
  end
end
invoke = function(p, ups, args)
  if depth >= MAX_DEPTH then error("call depth limit exceeded", 0) end
  local regs = {}
  for i = 1, p.nregs do regs[i] = cell(nil) end
  local argc = args.n
  for i = 1, math.min(argc, p.nparams) do regs[i].value = args[i] end
  local varargs = { n = 0 }
  if p.vararg then
    for i = p.nparams + 1, argc do
      varargs.n = varargs.n + 1
      varargs[varargs.n] = args[i]
    end
  end
  depth = depth + 1
  local ok, result = pcall(execute, p, ups, regs, varargs)
  depth = depth - 1
  if not ok then error(result, 0) end
  return table.unpack(result, 1, result.n)
end
ENV.print = function(...)
  local args = table.pack(...)
  local out = {}
  for i = 1, args.n do out[i] = display(args[i]) end
  print(table.concat(out, "\t"))
end
ENV.tostring = function(v) return display(v) end
for _, name in ipairs({ "type", "tonumber", "select", "next", "pairs", "ipairs", "assert", "error", "pcall", "rawget", "rawset", "rawequal" }) do
  ENV[name] = _G[name]
end
ENV.unpack = table.unpack
ENV.table = table
ENV.string = string
ENV.math = math
local entry = PROTOS[1]
invoke(entry, {}, { n = 0 })
'''

def generate_luau(bytecode: bytes, seed: int | None = None) -> str:
    chunk = decode_chunk(bytecode)
    rng = random.Random(seed)
    opcodes = list(Op)
    mapped = list(range(31, 31 + len(opcodes)))
    rng.shuffle(mapped)
    opmap = {int(op): mapped[i] for i, op in enumerate(opcodes)}
    const_key = rng.randrange(1, 256)
    op_mul = rng.choice([m for m in range(1, 256, 2)])
    op_inv = pow(op_mul, -1, 256)
    op_offset = rng.randrange(0, 256)
    op_step = rng.randrange(1, 256)
    operand_keys = [rng.randrange(1, 65536) for _ in range(3)]
    operand_steps = [rng.randrange(1, 65536) for _ in range(3)]
    mod32 = 4294967296
    proto_rows = []
    for proto in chunk.protos:
        constants = '{' + ','.join(_constant(v, const_key) for v in proto.constants) + '}'
        upvalues = '{' + ','.join('{s=%s,i=%d}' % ('true' if u.instack else 'false', u.index) for u in proto.upvalues) + '}'
        encoded_rows = []
        for pc, ins in enumerate(proto.code):
            enc_op = (opmap[int(ins.op)] * op_mul + op_offset + (pc + 1) * op_step) % 256
            operands = [ins.a, ins.b, ins.c]
            enc = [(v + operand_keys[i] + (pc + 1) * operand_steps[i]) % mod32 for i, v in enumerate(operands)]
            encoded_rows.append('{%d,%d,%d,%d}' % (enc_op, *enc))
        code = '{' + ','.join(encoded_rows) + '}'
        proto_rows.append('{nparams=%d,nregs=%d,vararg=%s,constants=%s,upvalues=%s,code=%s}' % (
            proto.nparams, proto.nregs, 'true' if proto.is_vararg else 'false', constants, upvalues, code))
    protos = '{' + ','.join(proto_rows) + '}'

    O = {op.name: opmap[int(op)] for op in opcodes}
    lines = [
        'local CK, OM, OI, OO, OS = %d, %d, %d, %d, %d' % (const_key, op_mul, op_inv, op_offset, op_step),
        'local AK, AS, BK, BS, CK2, CS = %d, %d, %d, %d, %d, %d' % (operand_keys[0], operand_steps[0], operand_keys[1], operand_steps[1], operand_keys[2], operand_steps[2]),
        'local MOD32 = 4294967296',
        'local math = math',
        'local PROTOS = ' + protos,
    ]
    lines.append(RUNTIME.rstrip('\n'))
    lines.append('      if op == %d then regs[a+1].value=constant(p,b)' % O['LOADK'])

    def emit(op, body):
        lines.append('      elseif op == %d then %s' % (O[op], body))

    emit('MOVE', 'regs[a+1].value=regs[b+1].value')
    for name, expr in [('ADD', 'x+y'), ('SUB', 'x-y'), ('MUL', 'x*y'), ('DIV', 'x/y'), ('MOD', 'x%y'), ('POW', 'x^y'), ('IDIV', 'math.floor(x/y)')]:
        emit(name, 'local x,y=regs[b+1].value,regs[c+1].value; if type(x)~="number" or type(y)~="number" then error("arithmetic expects numbers",0) end; regs[a+1].value=%s' % expr)
    emit('NEG', 'local x=regs[b+1].value; if type(x)~="number" then error("unary minus expects number",0) end; regs[a+1].value=-x')
    emit('NOT', 'regs[a+1].value=not truthy(regs[b+1].value)')
    emit('LEN', 'regs[a+1].value=luaLen(regs[b+1].value)')
    emit('EQ', 'regs[a+1].value=(regs[b+1].value==regs[c+1].value)')
    emit('LT', 'regs[a+1].value=(regs[b+1].value<regs[c+1].value)')
    emit('LE', 'regs[a+1].value=(regs[b+1].value<=regs[c+1].value)')
    emit('JMP', 'pc=a')
    emit('JMPIF', 'if truthy(regs[a+1].value) then pc=b end')
    emit('JMPIFNOT', 'if not truthy(regs[a+1].value) then pc=b end')
    emit('GETGLOBAL', 'regs[a+1].value=ENV[constant(p,b)]')
    emit('SETGLOBAL', 'ENV[constant(p,b)]=regs[a+1].value')
    emit('GETUPVAL', 'if not ups[b+1] then error("bad upvalue",0) end; regs[a+1].value=ups[b+1].value')
    emit('SETUPVAL', 'if not ups[b+1] then error("bad upvalue",0) end; ups[b+1].value=regs[a+1].value')
    emit('CALL', 'local cargs={n=b}; for i=1,b do cargs[i]=regs[a+i+1].value end; local res=callValue(regs[a+1].value,cargs); if c==0 then pending=res else for i=1,c-1 do regs[a+i].value=res[i] end end')
    emit('CALLV', 'local cargs={n=b}; for i=1,b do cargs[i]=regs[a+i+1].value end; for i=1,pending.n do cargs[b+i]=pending[i] end; cargs.n=b+pending.n; pending={n=0}; local res=callValue(regs[a+1].value,cargs); if c==0 then pending=res else for i=1,c-1 do regs[a+i].value=res[i] end end')
    emit('RETURN', 'local out={n=b}; for i=1,b do out[i]=regs[a+i].value end; return out')
    emit('RETURNV', 'local out={n=b+pending.n}; for i=1,b do out[i]=regs[a+i].value end; for i=1,pending.n do out[b+i]=pending[i] end; return out')
    emit('VARARG', 'if b==0 then pending={n=varargs.n}; for i=1,varargs.n do pending[i]=varargs[i] end else for i=1,b do regs[a+i].value=varargs[i] end end')
    emit('APPENDV', 'local t=regs[a+1].value; local start=regs[b+1].value; for i=1,pending.n do t[start+i-1]=pending[i] end; pending={n=0}')
    emit('CLOSURE', 'local child=PROTOS[b+1]; local ups2={}; for i,d in ipairs(child.upvalues) do ups2[i]=d.s and regs[d.i+1] or ups[d.i+1]; if not ups2[i] then error("bad closure upvalue",0) end end; regs[a+1].value=makeClosure(child,ups2)')
    emit('FORCHECK', 'local x,limit,step=regs[b+1].value,regs[c+1].value,regs[b+3].value; if type(x)~="number" or type(limit)~="number" or type(step)~="number" then error("numeric for expects numbers",0) end; if step==0 then regs[a+1].value=x<=limit else regs[a+1].value=(step>0 and x<=limit) or (step<0 and x>=limit) end')
    emit('FORSTEP', 'local x,step=regs[a+1].value,regs[a+3].value; regs[a+1].value=x+step')
    emit('NEWTABLE', 'regs[a+1].value={}')
    emit('GETTABLE', 'local t,k=regs[b+1].value,regs[c+1].value; if type(t)=="string" then t=string end; if type(t)~="table" then error("indexing non-table",0) end; regs[a+1].value=t[k]')
    emit('SETTABLE', 'local t,k,v=regs[a+1].value,regs[b+1].value,regs[c+1].value; if type(t)~="table" or k==nil then error("invalid table assignment",0) end; t[k]=v')
    emit('CONCAT', 'local x,y=regs[b+1].value,regs[c+1].value; if (type(x)~="string" and type(x)~="number") or (type(y)~="string" and type(y)~="number") then error("invalid concat operands",0) end; regs[a+1].value=display(x)..display(y)')
    emit('NEWLOCAL', 'regs[a+1]=cell(nil)')
    lines.append(RUNTIME_TAIL.rstrip('\n'))
    return '\n'.join(lines) + '\n'

def pack_source(source: str, filename: str, seed: int | None = None) -> str:
    return generate_luau(compile_source(source, filename), seed=seed)
