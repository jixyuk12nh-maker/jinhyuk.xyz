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

def _constant(value):
    if value is None: return '{t=0}'
    if isinstance(value, bool): return '{t=1,v=%s}' % ('true' if value else 'false')
    if isinstance(value, float):
        if value != value: return '{t=2,v=0/0}'
        if value == float('inf'): return '{t=2,v=math.huge}'
        if value == float('-inf'): return '{t=2,v=-math.huge}'
        return '{t=2,v=%s}' % repr(value)
    if isinstance(value, str): return '{t=3,v=%s}' % _q(value)
    raise TypeError('Unsupported constant: %r' % (value,))

def generate_luau(bytecode: bytes, seed: int | None = None) -> str:
    chunk = decode_chunk(bytecode)
    rng = random.Random(seed)
    opcodes = list(Op)
    mapped = list(range(31, 31 + len(opcodes)))
    rng.shuffle(mapped)
    opmap = {int(op): mapped[i] for i, op in enumerate(opcodes)}
    proto_rows = []
    for proto in chunk.protos:
        constants = '{' + ','.join(_constant(v) for v in proto.constants) + '}'
        upvalues = '{' + ','.join('{s=%s,i=%d}' % ('true' if u.instack else 'false', u.index) for u in proto.upvalues) + '}'
        code = '{' + ','.join('{%d,%d,%d,%d}' % (opmap[int(ins.op)], ins.a, ins.b, ins.c) for ins in proto.code) + '}'
        proto_rows.append('{nparams=%d,nregs=%d,constants=%s,upvalues=%s,code=%s}' % (proto.nparams, proto.nregs, constants, upvalues, code))
    protos = '{' + ','.join(proto_rows) + '}'
    
    O = {op.name: opmap[int(op)] for op in opcodes}
    lines = [
        'local PROTOS = ' + protos,
        'local ENV = { print = print }',
        'local MAX_STEPS, MAX_DEPTH = 1000000, 128',
        'local steps, depth = 0, 0',
        'local function cell(v) return {value=v} end',
        'local function truthy(v) return v ~= nil and v ~= false end',
        'local function display(v) if v == nil then return "nil" end return tostring(v) end',
        'local function luaLen(v) if type(v)=="string" then return #v elseif type(v)=="table" then return #v end error("invalid length operand", 0) end',
        'local function call(fn, args)',
        '  if type(fn)=="table" and fn.__native then return fn.fn(args) end',
        '  if type(fn)~="table" or not fn.__closure then error("attempt to call a non-function", 0) end',
        '  if depth >= MAX_DEPTH then error("tm call depth limit exceeded", 0) end',
        '  local p, regs = fn.proto, {}',
        '  for i=1,p.nregs do regs[i]=cell(nil) end',
        '  for i=1, math.min(#args,p.nparams) do regs[i].value=args[i] end',
        '  depth=depth+1',
        '  local ok, result = pcall(function()',
        '    local pc=0',
        '    while true do',
        '      steps=steps+1; if steps>MAX_STEPS then error("tm instruction limit exceeded",0) end',
        '      local ins=p.code[pc+1]; if not ins then error("invalid program counter",0) end',
        '      local op,a,b,c=ins[1],ins[2],ins[3],ins[4]; local here=pc; pc=pc+1',
    ]
    def emit(op, body): lines.append('      elseif op == %d then %s' % (O[op], body))
    lines.append('      if op == %d then regs[a+1].value=p.constants[b+1].v' % O['LOADK'])
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
    emit('GETGLOBAL', 'local k=p.constants[b+1].v; regs[a+1].value=ENV[k]')
    emit('SETGLOBAL', 'ENV[p.constants[b+1].v]=regs[a+1].value')
    emit('GETUPVAL', 'if not fn.upvalues[b+1] then error("bad upvalue",0) end; regs[a+1].value=fn.upvalues[b+1].value')
    emit('SETUPVAL', 'if not fn.upvalues[b+1] then error("bad upvalue",0) end; fn.upvalues[b+1].value=regs[a+1].value')
    emit('CALL', 'local args2={}; for i=1,b do args2[i]=regs[a+i].value end; regs[a+1].value=call(regs[a+1].value,args2)')
    emit('CLOSURE', 'local child=PROTOS[b+1]; local ups={}; for i,d in ipairs(child.upvalues) do ups[i]=d.s and regs[d.i+1] or fn.upvalues[d.i+1]; if not ups[i] then error("bad closure upvalue",0) end end; regs[a+1].value={__closure=true,proto=child,upvalues=ups}')
    emit('FORCHECK', 'local x,limit,step=regs[b+1].value,regs[c+1].value,regs[b+3].value; if type(x)~="number" or type(limit)~="number" or type(step)~="number" then error("numeric for expects numbers",0) end; regs[a+1].value=(step>=0 and x<=limit or step<0 and x>=limit)')
    emit('FORSTEP', 'local x,step=regs[a+1].value,regs[a+3].value; regs[a+1].value=x+step')
    emit('NEWTABLE', 'regs[a+1].value={} ')
    emit('GETTABLE', 'local t,k=regs[b+1].value,regs[c+1].value; if type(t)~="table" then error("indexing non-table",0) end; regs[a+1].value=t[k]')
    emit('SETTABLE', 'local t,k,v=regs[a+1].value,regs[b+1].value,regs[c+1].value; if type(t)~="table" or k==nil then error("invalid table assignment",0) end; t[k]=v')
    emit('CONCAT', 'local x,y=regs[b+1].value,regs[c+1].value; if (type(x)~="string" and type(x)~="number") or (type(y)~="string" and type(y)~="number") then error("invalid concat operands",0) end; regs[a+1].value=tostring(x)..tostring(y)')
    emit('RETURN', 'return regs[a+1].value')
    lines += [
        '      else error("unknown opcode",0) end',
        '    end',
        '  end)',
        '  depth=depth-1',
        '  if not ok then error(result,0) end',
        '  return result',
        'end',
        'ENV.print={__native=true,fn=function(args) local out={}; for i,v in ipairs(args) do out[i]=display(v) end; print(table.concat(out,"\\t")) end}',
        'local entry=PROTOS[1]',
        'call({__closure=true,proto=entry,upvalues={}}, {})',
        '',
    ]
    return '\n'.join(lines)

def pack_source(source: str, filename: str, seed: int | None = None) -> str:
    return generate_luau(compile_source(source, filename), seed=seed)
