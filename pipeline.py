from bytecode.format import decode_chunk, encode_chunk
from bytecode.limits import DEFAULT_MAX_STEPS
from bytecode.verifier import verify_chunk
from compiler.codegen import generate
from frontend.parser import parse
from vm.interpreter import VM

def compile_source(source, file):
    statements = parse(source, file)
    chunk = generate(statements)
    verify_chunk(chunk)
    return encode_chunk(chunk)

def run_source(source, file, output, max_steps=DEFAULT_MAX_STEPS):
    data = compile_source(source, file)
    chunk = decode_chunk(data)
    VM(chunk, output=output, max_steps=max_steps).run()
