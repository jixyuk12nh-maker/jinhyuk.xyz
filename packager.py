"""Generate a standalone Luau script for the currently supported VM subset.

This is a compatibility prototype, not a production obfuscator. It embeds a
serialized instruction table and a small Luau interpreter.
"""
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
        proto_rows.append('{nparams=%d,nregs=%d,constants=%s,upvalues=%s,code=%s}' % (proto.nparams, proto.nregs, constants, upvalues, code))
    protos = '{' + ','.join(proto_rows) + '}'
    
    O = {op.name: opmap[int(op)] for op in opcodes}
    lines = [
        'local CK, OM, OI, OO, OS = %d, %d, %d, %d, %d' % (const_key, op_mul, op_inv, op_offset, op_step),
        'local AK, AS, BK, BS, CK2, CS = %d, %d, %d, %d, %d, %d' % (operand_keys[0], operand_steps[0], operand_keys[1], operand_steps[1], operand_keys[2], operand_steps[2]),
        'local MOD32 = 4294967296',
        'local PROTOS = ' + protos,
        'local function constant(p, index)',
        '  local c=p.constants[index+1]',
        '  if not c then error("invalid constant index",0) end',
        '  if c.t~=3 then return c.v end',
        '  local out={}; for i=1,#c.e do out[i]=string.char(bit32.bxor(c.e[i],CK)) end',
        '  return table.concat(out)',
        'end',
        'local ENV = { print = print }',
        'local MAX_STEPS, MAX_DEPTH = 1000000, 128',
        'local steps, depth = 0, 0',
        'local function cell(v) return {value=v} end',
        'local function truthy(v) return v ~= nil and v ~= false end',
        'local function display(v)',
        '  if v == nil then return "nil" end',
        '  if v == true then return "true" elseif v == false then return "false" end',
        '  if type(v)=="number" then',
        '    if v ~= v then return "nan" elseif v == math.huge then return "inf" elseif v == -math.huge then return "-inf" end',
        '    if v % 1 == 0 and math.abs(v) < 1e15 then return string.format("%.0f",v) end',
        '    return string.format("%.14g",v)',
        '  end',
        '  if type(v)=="table" then return "table" end',
        '  if type(v)=="function" then return "function" end',
        '  return tostring(v)',
        'end',
        'local function luaLen(v) if type(v)=="string" then return #v elseif type(v)=="table" then return #v end error("invalid length operand", 0) end',
        'local function call(fn, args)',
        '  if type(fn)=="table" and fn.__native then return fn.fn(args) end',
        '  if type(fn)~="table" or not fn.__closure then error("attempt to call a non-function", 0) end',
        '  if depth >= MAX_DEPTH then error("tm call depth limit exceeded", 0) end',
        '  local p, regs = fn.proto, {}',
        '  for i=1,p.nregs do regs[i]=cell(nil) end',
        '  local argc=args.n or #args',
        '  for i=1, math.min(argc,p.nparams) do regs[i].value=args[i] end',
        '  depth=depth+1',
        '  local ok, result = pcall(function()',
        '    local pc=0',
        '    while true do',
        '      steps=steps+1; if steps>MAX_STEPS then error("tm instruction limit exceeded",0) end',
        '      local ins=p.code[pc+1]; if not ins then error("invalid program counter",0) end',
        '      local here=pc',
        '      local op=((ins[1]-OO-(here+1)*OS)*OI)%256',
        '      local a=(ins[2]-AK-(here+1)*AS)%MOD32',
        '      local b=(ins[3]-BK-(here+1)*BS)%MOD32',
        '      local c=(ins[4]-CK2-(here+1)*CS)%MOD32',
        '      pc=pc+1',
    ]
    def emit(op, body): lines.append('      elseif op == %d then %s' % (O[op], body))
    lines.append('      if op == %d then regs[a+1].value=constant(p,b)' % O['LOADK'])
    emit('MOVE', 'regs[a+1].value=regs[b+1].value')
    for name, expr in [('ADD','x+y'),('SUB','x-y'),('MUL','x*y'),('DIV','x/y'),('MOD','x%y'),('POW','x^y'),('IDIV','math.floor(x/y)')]:
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
    emit('GETGLOBAL', 'local k=constant(p,b); regs[a+1].value=ENV[k]')
    emit('SETGLOBAL', 'ENV[constant(p,b)]=regs[a+1].value')
    emit('GETUPVAL', 'if not fn.upvalues[b+1] then error("bad upvalue",0) end; regs[a+1].value=fn.upvalues[b+1].value')
    emit('SETUPVAL', 'if not fn.upvalues[b+1] then error("bad upvalue",0) end; fn.upvalues[b+1].value=regs[a+1].value')
    emit('CALL', 'local args2={n=b}; for i=1,b do args2[i]=regs[a+i+1].value end; regs[a+1].value=call(regs[a+1].value,args2)')
    emit('CLOSURE', 'local child=PROTOS[b+1]; local ups={}; for i,d in ipairs(child.upvalues) do ups[i]=d.s and regs[d.i+1] or fn.upvalues[d.i+1]; if not ups[i] then error("bad closure upvalue",0) end end; regs[a+1].value={__closure=true,proto=child,upvalues=ups}')
    emit('FORCHECK', 'local x,limit,step=regs[b+1].value,regs[c+1].value,regs[b+3].value; if type(x)~="number" or type(limit)~="number" or type(step)~="number" then error("numeric for expects numbers",0) end; regs[a+1].value=(step>=0 and x<=limit or step<0 and x>=limit)')
    emit('FORSTEP', 'local x,step=regs[a+1].value,regs[a+3].value; regs[a+1].value=x+step')
    emit('NEWTABLE', 'regs[a+1].value={} ')
    emit('GETTABLE', 'local t,k=regs[b+1].value,regs[c+1].value; if type(t)~="table" then error("indexing non-table",0) end; regs[a+1].value=t[k]')
    emit('SETTABLE', 'local t,k,v=regs[a+1].value,regs[b+1].value,regs[c+1].value; if type(t)~="table" or k==nil then error("invalid table assignment",0) end; t[k]=v')
    emit('CONCAT', 'local x,y=regs[b+1].value,regs[c+1].value; if (type(x)~="string" and type(x)~="number") or (type(y)~="string" and type(y)~="number") then error("invalid concat operands",0) end; regs[a+1].value=tostring(x)..tostring(y)')
    emit('RETURN', 'if b==0 then return nil end; return regs[a+1].value')
    lines += [
        '      else error("unknown opcode",0) end',
        '    end',
        '  end)',
        '  depth=depth-1',
        '  if not ok then error(result,0) end',
        '  return result',
        'end',
        'ENV.print={__native=true,fn=function(args) local out={}; for i=1,(args.n or #args) do out[i]=display(args[i]) end; print(table.concat(out,\"\\t\")) end}',
        'local entry=PROTOS[1]',
        'call({__closure=true,proto=entry,upvalues={}}, {})',
        '',
    ]
    return '\n'.join(lines)

def pack_source(source: str, filename: str, seed: int | None = None) -> str:
    return generate_luau(compile_source(source, filename), seed=seed)
