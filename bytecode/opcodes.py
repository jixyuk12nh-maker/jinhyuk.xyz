from enum import IntEnum

class Op(IntEnum):
    LOADK = 1
    MOVE = 2
    ADD = 3
    SUB = 4
    MUL = 5
    DIV = 6
    NEG = 7
    NOT = 8
    EQ = 9
    LT = 10
    LE = 11
    JMP = 12
    JMPIF = 13
    JMPIFNOT = 14
    GETGLOBAL = 15
    SETGLOBAL = 16
    CALL = 17
    RETURN = 18
    CLOSURE = 19
    NEWTABLE = 20
    GETTABLE = 21
    SETTABLE = 22
    CONCAT = 23
    GETUPVAL = 24
    SETUPVAL = 25
    FORCHECK = 26
    FORSTEP = 27
    MOD = 28
    POW = 29
    IDIV = 30
    LEN = 31
