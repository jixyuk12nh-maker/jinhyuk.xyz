local function id<T>(x: T): T return x end
print(id<<number>>(3))
local function f<T...>(...: T...): T... return ... end
print(f(1, 2))
type U = | "a" | "b"
local s: U = "a"
print(s)
