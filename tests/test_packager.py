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
        self.assertIn('ENV.print=', output)
        self.assertNotIn('print(2 + 3)', output)

    def test_opcode_mapping_changes_by_seed(self):
        bytecode = compile_source('print(1 + 2)', 'sample.lua')
        a = generate_luau(bytecode, seed=10)
        b = generate_luau(bytecode, seed=11)
        self.assertNotEqual(a, b)
        self.assertEqual(a, generate_luau(bytecode, seed=10))

    def test_closure_proto_is_embedded(self):
        output = pack_source('local function outer() local x=1; return function() return x end end', 'closure.lua', seed=1)
        self.assertIn('__closure=true', output)
        self.assertIn('upvalues=', output)

    def test_invalid_source_is_rejected(self):
        with self.assertRaises(Exception):
            pack_source('local =', 'bad.lua', seed=1)

if __name__ == '__main__':
    unittest.main()
