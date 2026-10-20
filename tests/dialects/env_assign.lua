local t = { print = print }
_ENV = t
x = 42
print(x, t.x)
