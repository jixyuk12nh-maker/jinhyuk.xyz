import unittest
from pipeline import compile_source


class LuauConformanceTests(unittest.TestCase):

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

    def test_do_block_scopes_locals(self):
        import io
        from pipeline import run_source
        out = io.StringIO()
        run_source('local x = 1\ndo local x = 5 print(x) end\nprint(x)\n', 'do.lua', out)
        self.assertEqual(out.getvalue(), '5\n1\n')

    def test_unsupported_luau_constructs_are_rejected(self):
        cases = {
            'if expression': 'local x = if true then 1 else 2',
            'continue': 'while true do continue end',
            'backtick interpolation': 'local x = `hello {name}`',
            'type annotation': 'local x: number = 1',
        }
        for feature, source in cases.items():
            with self.subTest(feature=feature):
                with self.assertRaises(Exception):
                    compile_source(source, f'{feature}.luau')


if __name__ == '__main__':
    unittest.main()
