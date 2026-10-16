# 지원 문법 (Phase 6 — 부분 구현)

지원하지 않는 문법은 가능한 경우 명시적인 컴파일 오류로 거부합니다. 아래 목록은 공식 Luau 전체 문법을 의미하지 않습니다.

## 지원

- 상수: 숫자, 문자열(`'…'`, `"…"` 및 기본 이스케이프), `true`, `false`, `nil`
- 주석: `-- …` 및 `--[[ … ]]` 형태의 블록 주석
- 지역 변수: `local x = e`, `local a, b = e1, e2` (다중 반환 의미는 지원하지 않음)
- 변수 대입: `x = e`
- 테이블: `{}`, 배열 필드, `name = value`, `[expr] = value`
- 테이블 접근/대입: `t.name`, `t[key]`, 중첩 테이블
- 산술: `+ - * / % ^ //`, 단항 `-`
- 길이: `#string`, `#table` (테이블은 연속된 1-based 배열 접두부 길이)
- 문자열 연결: `..` (문자열과 숫자만)
- 비교: `== ~= < <= > >=`
- 논리: `and`, `or`, `not` (단락 평가)
- 제어 흐름: `if/elseif/else`, `while`, 숫자형 `for`, `repeat ... until`, `break`
- 함수: `function f(a) ... end`, `local function f(a) ... end`, `function(a) ... end`
- 클로저: 외부 지역 변수 캡처, 변경, 중첩 캡처 및 클로저 간 공유
- 호출: `f(args)`, `object:method(args)` (메서드 선언 sugar는 미지원)
- 전역 내장 함수: `print(...)` 호출 문법 (실제 함수는 VM이 제공하는 `print` 한정)

## 미지원 또는 제한

- 일반 반복자 `for ... in`
- 가변 인자 `...`, 다중 반환의 실제 의미, 다중 대입
- `do ... end` 독립 블록
- 메서드 선언 `function object:method()`
- 타입 주석 및 제네릭 타입 문법
- 16진수/확장 숫자 리터럴, Luau 보간 문자열, 모든 긴 문자열 형식
- 메타테이블, coroutine/task, 표준 라이브러리 대부분
- Roblox 런타임 globals/API (`game`, `Instance`, `workspace`, `task` 등)
- 공식 Luau 전체 문법 및 동작 호환성

## 입력 및 실행 제한

- 최대 입력 크기: 1 MiB
- 함수 호출 깊이: 200
- 기본 실행 명령 수: 1,000,000회
