import io
import unittest

from bytecode.chunk import Chunk, Instr, Proto
from bytecode.format import decode_chunk, encode_chunk
from bytecode.limits import MAX_CALL_DEPTH
from bytecode.opcodes import Op
from bytecode.verifier import verify_chunk
from frontend.diagnostics import BytecodeError, CompileError, ExecutionLimitError, LuaRuntimeError
from pipeline import compile_source, run_source

RETURN_NIL = Instr(int(Op.RETURN), 0, 1, 0)

def run(source, **kwargs):
    out = io.StringIO()
    run_source(source, "test.lua", out, **kwargs)
    return out.getvalue()

def chunk_of(code, constants=(), nregs=2):
    return Chunk([Proto(nparams=0, nregs=nregs, constants=list(constants), code=list(code))])

class ExecutionTests(unittest.TestCase):
    def test_number_addition(self):
        self.assertEqual(run("print(1 + 2)\n"), "3\n")

    def test_spec_example_prints_30(self):
        src = "local a = 10\nlocal b = 20\nlocal result = a + b\nprint(result)\n"
        self.assertEqual(run(src), "30\n")

    def test_string_output(self):
        self.assertEqual(run("print('hello')\n"), "hello\n")

    def test_local_variables_and_assignment(self):
        self.assertEqual(run("local x = 5\nx = x * 2\nprint(x)\n"), "10\n")

    def test_if_else(self):
        self.assertEqual(run("local n = 3\nif n < 2 then print(1) else print(2) end\n"), "2\n")

    def test_elseif_chain(self):
        src = "if 1 == 2 then print('a') elseif 2 == 2 then print('b') else print('c') end\n"
        self.assertEqual(run(src), "b\n")

    def test_while_loop(self):
        src = "local i = 0\nlocal s = 0\nwhile i < 5 do s = s + i i = i + 1 end\nprint(s)\n"
        self.assertEqual(run(src), "10\n")

    def test_numeric_for_loop(self):
        src = "local s = 0 for i = 1, 5 do s = s + i end print(s)\n"
        self.assertEqual(run(src), "15\n")

    def test_numeric_for_negative_step(self):
        src = "local s = 0 for i = 5, 1, -2 do s = s + i end print(s)\n"
        self.assertEqual(run(src), "9\n")

    def test_repeat_until(self):
        src = "local i = 0 repeat i = i + 1 until i >= 3 print(i)\n"
        self.assertEqual(run(src), "3\n")

    def test_break_in_numeric_for(self):
        src = "local s = 0 for i = 1, 10 do if i == 4 then break end s = s + i end print(s)\n"
        self.assertEqual(run(src), "6\n")

    def test_break_in_while(self):
        src = "local i = 0 while true do i = i + 1 if i == 3 then break end end print(i)\n"
        self.assertEqual(run(src), "3\n")

    def test_break_outside_loop_is_rejected(self):
        with self.assertRaisesRegex(CompileError, "반복문 안에서만"):
            compile_source("break\n", "bad.lua")

    def test_global_function_call_and_return(self):
        src = "function add(a, b)\n return a + b\nend\nprint(add(2, 3))\n"
        self.assertEqual(run(src), "5\n")

    def test_nested_calls(self):
        src = "function f(x) return x * 2 end\nprint(f(f(3)) + 1)\n"
        self.assertEqual(run(src), "13\n")

    def test_comparisons(self):
        src = "print(1 < 2)\nprint(2 <= 1)\nprint(1 == 1)\nprint(1 ~= 1)\nprint(3 >= 3)\nprint(3 > 4)\n"
        self.assertEqual(run(src), "true\nfalse\ntrue\nfalse\ntrue\nfalse\n")

    def test_nil_boolean_and_logic(self):
        self.assertEqual(run("print(nil or 'x')\nprint(false and 1)\nprint(not nil)\n"), "x\nfalse\ntrue\n")

    def test_float_division_prints_like_luau(self):
        self.assertEqual(run("print(10 / 4)\nprint(10 / 2)\n"), "2.5\n5\n")

    def test_comments_and_strings_are_not_code(self):
        src = "-- print(1)\nprint('-- not a comment') --[[ print(9) ]] print(2)\n"
        self.assertEqual(run(src), "-- not a comment\n2\n")

    def test_table_constructor_and_field_access(self):
        src = 'local t = {name = "tm", version = 3}\nt.version = t.version + 1\nprint(t.name)\nprint(t.version)\n'
        self.assertEqual(run(src), "tm\n4\n")

    def test_table_array_and_index_access(self):
        src = 'local t = {"a", "b", "c"}\nprint(t[1])\nprint(t[3])\nt[2] = "updated"\nprint(t[2])\n'
        self.assertEqual(run(src), "a\nc\nupdated\n")

    def test_nested_tables(self):
        src = 'local t = {config = {enabled = true}}\nprint(t.config.enabled)\n'
        self.assertEqual(run(src), "true\n")

    def test_table_nil_assignment_removes_key(self):
        src = 'local t = {x = 1}\nt.x = nil\nprint(t.x)\n'
        self.assertEqual(run(src), "nil\n")

    def test_string_concatenation(self):
        self.assertEqual(run('print("t" .. "m")\nprint("v" .. 3)\n'), "tm\nv3\n")

    def test_bytecode_round_trip_is_stable(self):
        data = compile_source("print(1)\n", "t.lua")
        self.assertEqual(encode_chunk(decode_chunk(data)), data)

    def test_closure_bytecode_round_trip_is_stable(self):
        source = "local x = 1\nlocal f = function() x = x + 1 return x end\nprint(f())\n"
        data = compile_source(source, "closure.lua")
        decoded = decode_chunk(data)
        self.assertEqual(encode_chunk(decoded), data)
        out = io.StringIO()
        from vm.interpreter import VM
        VM(decoded, output=out).run()
        self.assertEqual(out.getvalue(), "2\n")

class SyntaxErrorTests(unittest.TestCase):
    def test_invalid_syntax_reports_line_and_column(self):
        with self.assertRaises(CompileError) as ctx:
            compile_source("local = 1\n", "bad.lua")
        self.assertEqual(ctx.exception.location.line, 1)
        self.assertEqual(ctx.exception.location.column, 7)
        self.assertEqual(str(ctx.exception.location), "bad.lua:1:7")

    def test_unterminated_string_is_rejected(self):
        with self.assertRaises(CompileError):
            compile_source("print('abc)\n", "bad.lua")

    def test_unsupported_syntax_is_rejected_explicitly(self):
        for src in ("local x: number = 1\n",):
            with self.subTest(src=src):
                with self.assertRaisesRegex(CompileError, "지원하지 않는 문법|타입 주석|가 필요"):
                    compile_source(src, "bad.lua")

    def test_upvalue_capture_and_mutation(self):
        src = "local x = 1\nlocal f = function() x = x + 1 return x end\nprint(f())\nprint(f())\n"
        self.assertEqual(run(src), "2\n3\n")

    def test_closure_survives_outer_return(self):
        src = "local function createCounter() local count = 0 return function() count = count + 1 return count end end\nlocal counter = createCounter()\nprint(counter())\nprint(counter())\n"
        self.assertEqual(run(src), "1\n2\n")

    def test_nested_closure_transitively_captures_upvalue(self):
        src = "local x = 7\nlocal outer = function() return function() x = x + 1 return x end end\nlocal inner = outer()\nprint(inner())\nprint(inner())\n"
        self.assertEqual(run(src), "8\n9\n")

    def test_sibling_closures_share_upvalue(self):
        src = "local x = 0\nlocal inc = function() x = x + 1 end\nlocal read = function() return x end\ninc()\ninc()\nprint(read())\n"
        self.assertEqual(run(src), "2\n")

    def test_local_recursive_function_captures_itself(self):
        src = "local function get() return get end\nprint(get() == get)\n"
        self.assertEqual(run(src), "true\n")

    def test_return_must_be_last_statement(self):
        with self.assertRaisesRegex(CompileError, "마지막 문장"):
            compile_source("function f() return 1 print(2) end\n", "bad.lua")

class VerifierTests(unittest.TestCase):
    def test_invalid_opcode_is_rejected(self):
        chunk = chunk_of([Instr(99, 0, 0, 0), RETURN_NIL])
        with self.assertRaisesRegex(BytecodeError, "opcode"):
            verify_chunk(chunk)

    def test_invalid_jump_target_is_rejected(self):
        chunk = chunk_of([Instr(int(Op.JMP), 50, 0, 0), RETURN_NIL])
        with self.assertRaisesRegex(BytecodeError, "점프 대상"):
            verify_chunk(chunk)

    def test_constant_index_out_of_range_is_rejected(self):
        chunk = chunk_of([Instr(int(Op.LOADK), 0, 5, 0), RETURN_NIL], constants=[1.0])
        with self.assertRaisesRegex(BytecodeError, "상수 인덱스"):
            verify_chunk(chunk)

    def test_invalid_register_is_rejected(self):
        chunk = chunk_of([Instr(int(Op.LOADK), 9, 0, 0), RETURN_NIL], constants=[1.0], nregs=2)
        with self.assertRaisesRegex(BytecodeError, "레지스터"):
            verify_chunk(chunk)

    def test_unused_operand_must_be_zero(self):
        chunk = chunk_of([Instr(int(Op.MOVE), 0, 1, 7), RETURN_NIL])
        with self.assertRaisesRegex(BytecodeError, "잘못된 명령어 인수"):
            verify_chunk(chunk)

    def test_program_must_end_with_return_or_jump(self):
        chunk = chunk_of([Instr(int(Op.LOADK), 0, 0, 0)], constants=[1.0])
        with self.assertRaisesRegex(BytecodeError, "마지막 명령"):
            verify_chunk(chunk)

    def test_invalid_upvalue_index_is_rejected(self):
        from bytecode.chunk import UpvalueDesc
        child = Proto(nparams=0, nregs=1, constants=[None],
                      code=[Instr(int(Op.GETUPVAL), 0, 0, 0), RETURN_NIL],
                      upvalues=[UpvalueDesc(True, 1)])
        main = Proto(nparams=0, nregs=1, constants=[None],
                     code=[Instr(int(Op.CLOSURE), 0, 1, 0), RETURN_NIL])
        with self.assertRaisesRegex(BytecodeError, "캡처할 레지스터"):
            verify_chunk(Chunk([main, child]))

    def test_corrupt_bytes_are_rejected(self):
        with self.assertRaisesRegex(BytecodeError, "매직 넘버"):
            decode_chunk(b"NOPE\x01\x00\x00")
        good = compile_source("print(1)\n", "t.lua")
        with self.assertRaisesRegex(BytecodeError, "불필요한 데이터"):
            decode_chunk(good + b"x")
        with self.assertRaises(BytecodeError):
            decode_chunk(good[:-3])

class RuntimeLimitTests(unittest.TestCase):
    def test_execution_step_limit_is_enforced(self):
        with self.assertRaises(ExecutionLimitError):
            run("while true do end\n", max_steps=1000)

    def test_call_depth_limit_is_enforced(self):
        with self.assertRaisesRegex(ExecutionLimitError, str(MAX_CALL_DEPTH)):
            run("function f() return f() end\nf()\n")

    def test_calling_non_function_is_runtime_error(self):
        with self.assertRaisesRegex(LuaRuntimeError, "호출할 수 없는 값"):
            run("x = 1\nx()\n")

    def test_arithmetic_on_string_is_runtime_error(self):
        with self.assertRaisesRegex(LuaRuntimeError, "숫자에만"):
            run("print('a' + 1)\n")

if __name__ == "__main__":
    unittest.main()
