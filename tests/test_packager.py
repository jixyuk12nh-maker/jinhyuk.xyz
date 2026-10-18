import io
import os
import tempfile
import unittest
from packager import generate_luau, pack_source
from pipeline import compile_source

class PackagerTests(unittest.TestCase):
    def test_generates_standalone_luau_shell(self):
        output = pack_source('print(2 + 3)', 'sample.lua', seed=7)
        self.assertIn('local PROTOS =', output)
        self.assertIn('local PROTOS =', output)
        self.assertNotIn('generated standalone Luau VM', output)
        self.assertIn('ENV.print = function', output)
        self.assertNotIn('print(2 + 3)', output)

    def test_opcode_mapping_changes_by_seed(self):
        bytecode = compile_source('print(1 + 2)', 'sample.lua')
        a = generate_luau(bytecode, seed=10)
        b = generate_luau(bytecode, seed=11)
        self.assertNotEqual(a, b)
        self.assertEqual(a, generate_luau(bytecode, seed=10))

    def test_closure_proto_is_embedded(self):
        output = pack_source('local function outer() local x=1; return function() return x end end', 'closure.lua', seed=1)
        self.assertIn('makeClosure', output)
        self.assertIn('upvalues=', output)

    def test_runtime_preserves_nil_arguments_and_number_display(self):
        output = pack_source('print(nil, 1, true, false)', 'args.lua', seed=3)
        self.assertIn('local argc = args.n', output)
        self.assertIn('local cargs={n=b}', output)
        self.assertIn('for i = 1, args.n do out[i] = display(args[i]) end', output)
        self.assertIn('string.format("%.14g", v)', output)
        self.assertIn('elseif op == ', output)

    def test_call_arguments_skip_the_function_register(self):
        output = pack_source('local function add(a, b) return a + b end\nprint(add(2, 3))', 'call.lua', seed=4)
        self.assertIn('for i=1,b do cargs[i]=regs[a+i+1].value end', output)
        self.assertNotIn('for i=1,b do cargs[i]=regs[a+i].value end', output)

    def test_string_constants_and_instruction_operands_are_encoded(self):
        output = pack_source('print("secret-marker-xyz", 41)', 'protected.lua', seed=17)
        self.assertNotIn('secret-marker-xyz', output)
        self.assertIn('bit32.bxor(c.e[i], CK)', output)
        self.assertIn('local MOD32 = 4294967296', output)
        self.assertIn('((ins[1] - OO - (here + 1) * OS) * OI) % 256', output)

    def test_invalid_source_is_rejected(self):
        with self.assertRaises(Exception):
            pack_source('local =', 'bad.lua', seed=1)

if __name__ == '__main__':
    unittest.main()
