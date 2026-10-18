import unittest
from pipeline import compile_source


class LuauConformanceTests(unittest.TestCase):
    """Ensure selected Luau features outside the implemented subset fail closed."""

    def test_supported_subset_smoke(self):
        chunk = compile_source(
            'local function add(a, b) return a + b end\n'
            'local total = 0\n'
            'for i = 1, 3 do total = total + i end\n'
            'print(add(total, 4))',
            'supported-subset.lua',
        )
        self.assertIsInstance(chunk, bytes)
        self.assertGreater(len(chunk), 0)

    def test_unsupported_luau_constructs_are_rejected(self):
        cases = {
            'generic for': 'for key, value in pairs({}) do print(key) end',
            'varargs': 'local function f(...) return ... end',
            'do block': 'do local x = 1 end',
            'if expression': 'local x = if true then 1 else 2',
            'continue': 'while true do continue end',
            'method declaration': 'function t:foo() end',
            'backtick interpolation': 'local x = `hello {name}`',
            'type annotation': 'local x: number = 1',
        }
        for feature, source in cases.items():
            with self.subTest(feature=feature):
                with self.assertRaises(Exception):
                    compile_source(source, f'{feature}.luau')


if __name__ == '__main__':
    unittest.main()
