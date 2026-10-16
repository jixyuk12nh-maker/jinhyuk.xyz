# 바이트코드 형식과 명령어

## 형식 (version 2, little-endian)

- 헤더: 매직 `LGVM`(4바이트), 버전 `u8`
- 프로토타입 개수 `u16`, 이후 프로토타입 목록. 0번이 메인 청크입니다.
- 프로토타입: `nparams u16`, `nregs u16`, upvalue 개수 `u16`, upvalue 설명자 목록 (`instack u8`, `index u16`), 상수 개수 `u32`, 상수 목록, 명령어 개수 `u32`, 명령어 목록
- 상수: 태그 `u8` (0 nil, 1 bool, 2 number(f64), 3 string(길이 u32 + UTF-8))
- 명령어: 7바이트, `op u8, a u16, b u16, c u16`

디코딩 시 남은 데이터 길이와 개수를 먼저 확인하므로 거대한 개수 필드로 메모리를 과도하게 할당하지 않습니다. 파일 끝의 불필요한 데이터는 거부합니다.

## 명령어

레지스터 기반입니다. `R[x]`는 레지스터, `K[x]`는 상수 테이블입니다.

| opcode | 피연산자 | 동작 |
|---|---|---|
| LOADK | A, B | R[A] = K[B] |
| MOVE | A, B | R[A] = R[B] |
| ADD / SUB / MUL / DIV | A, B, C | R[A] = R[B] 연산 R[C] (숫자만 허용, 0 나눗셈은 inf/nan) |
| NEG | A, B | R[A] = -R[B] (숫자만) |
| NOT | A, B | R[A] = not truthy(R[B]) |
| EQ | A, B, C | R[A] = (R[B] == R[C]), 타입이 다르면 false |
| LT / LE | A, B, C | R[A] = R[B] < R[C] 또는 <=, 숫자끼리 또는 문자열끼리만 |
| JMP | A | 명령 인덱스 A로 이동 |
| JMPIF | A, B | R[A]가 참이면 B로 이동 |
| JMPIFNOT | A, B | R[A]가 거짓이면 B로 이동 |
| GETGLOBAL | A, B | R[A] = 전역[K[B]] (K[B]는 문자열, 없으면 nil) |
| SETGLOBAL | A, B | 전역[K[B]] = R[A] |
| CALL | A, B | 함수 R[A], 인자 R[A+1..A+B], 결과를 R[A]에 저장 |
| RETURN | A, B | B=1이면 R[A] 반환, B=0이면 nil 반환 |
| CLOSURE | A, B | R[A] = 프로토타입 B의 함수. 프로토타입의 upvalue 설명자에 따라 현재 프레임 또는 상위 클로저에서 캡처 |
| GETUPVAL | A, B | R[A] = 현재 클로저의 upvalue B |
| SETUPVAL | A, B | 현재 클로저의 upvalue B = R[A] |

## 검증 규칙 (실행 전)

- 알 수 없는 opcode 거부
- 레지스터 번호는 `nregs` 미만이어야 하며, CALL의 인자 영역도 범위 안이어야 함
- 상수 인덱스 범위, 상수 타입 허용 여부
- 점프 대상은 명령어 개수 범위 안
- 사용하지 않는 인수 필드는 0이어야 함
- 전역 이름 상수는 문자열이어야 함
- 프로토타입 인덱스 범위 및 upvalue 캡처 범위
- 마지막 명령은 RETURN 또는 JMP

검증에 실패하면 VM을 실행하지 않고 `검증 실패 (함수 N, 명령 M): …` 오류를 반환합니다.

## 실행 제한

- 명령 실행 횟수: 기본 1,000,000회 초과 시 `ExecutionLimitError`
- 호출 깊이: 200 초과 시 `ExecutionLimitError`


## Phase 5 opcodes

- `FORCHECK flag, index, limit`: checks the numeric-for boundary using `index + 2` as the step register; writes a boolean to `flag`.
- `FORSTEP index`: increments the loop index by the step stored in `index + 2`.

These instructions are compiler-generated and are validated before execution.

## Phase 6 opcodes

- `MOD A, B, C`: numeric modulo (`R[A] = R[B] % R[C]`).
- `POW A, B, C`: numeric exponentiation.
- `IDIV A, B, C`: floor division.
- `LEN A, B`: string byte length or simplified contiguous table prefix length.

The parser also supports colon method-call syntax by inserting the receiver as the first argument. These additions are a limited subset and do not establish full Luau compatibility.
