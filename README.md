# TM Lua Host

Cloudflare Worker(`tm`), D1(`tm-db`), R2(`jinhyuk--xyz`)로 Lua 스크립트를 저장하고 URL로 배포합니다.

## 역할
| 역할 | 할 수 있는 일 |
|---|---|
| owner | 모든 사용자와 키 관리 (owner, admin, user 모든 역할의 API 키 발급), 역할 변경, 스크립트 관리 |
| admin | `user` 계정과 그 키 관리 (API 키는 `user` 계정에만 발급), 스크립트 관리 |
| user | 로그인 후 스크립트 생성·수정·삭제, 스크립트 키 발급, 본인 키 조회·폐기 |

API 키는 앱사이트 로그인용이며, 프로젝트별로 Users 탭에서 발급·폐기합니다. 스크립트 키는 API로 발급합니다.

## 실행 모드
- 키리스(`keyless`): 누구나 실행합니다.
  ```lua
  loadstring(game:HttpGet("https://jinhyuk.xyz/<슬러그>"))()
  ```
- 키 모드(`key`): 키가 있어야 실행됩니다. 원문 주소는 검증용 로더를 돌려주고, 로더가 `POST /api/key-run`으로 키를 확인받은 뒤 실행합니다.
  ```lua
  script_key = "여기에_스크립트_키"
  loadstring(game:HttpGet("https://jinhyuk.xyz/<슬러그>"))()
  ```
- HWID 잠금: 키 모드 스크립트에서 켜면 키 1개마다 처음 실행된 기기 1대에만 연결됩니다. 같은 사용자가 키를 여러 개 받으면 기기마다 다른 키를 쓰면 됩니다. 기기 값은 `RbxAnalyticsService:GetClientId()`입니다.
- 소유자 로더: `loader.lua`처럼 `.lua`로 끝나는 슬러그로 키리스 스크립트를 만들면 `https://jinhyuk.xyz/loader.lua`로 받을 수 있습니다.
- 한글 슬러그는 입력한 그대로 주소가 됩니다. Roblox 실행기에서 한글 주소가 열리는지는 실제 테스트가 필요합니다.

## 배포
1. D1 스키마를 확인합니다. `api_users`나 `api_keys`가 이미 있다면 구조를 먼저 확인하세요.
   `npx wrangler d1 execute tm-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"`
2. D1을 백업한 뒤 마이그레이션을 적용합니다. (0011은 더 이상 쓰지 않는 `key_run_failures` 테이블을 삭제합니다.)
   `npm run db:migrate:remote`
3. 배포합니다.
   `npm run check && npm run deploy`

## 최초 소유자 만들기
두 가지 방법이 있습니다.

1. 앱사이트에서 가입: 소유자가 한 명도 없을 때만 가입 화면이 나타납니다. 가입하면 소유자가 되고 API 키가 한 번 표시됩니다. 배포 직후 바로 가입하세요. 소유자가 생기기 전까지는 누구나 가입해서 소유자가 될 수 있습니다.
2. 터미널에서 만들기: `npm run owner:create -- <사용자이름>`을 실행하면 D1에 소유자와 API 키가 만들어지고 키가 터미널에 한 번 출력됩니다. 같은 이름의 계정이 있으면 소유자로 올립니다.

소유자가 생긴 뒤에는 가입 화면이 사라집니다. 이후 사용자는 소유자나 관리자가 API 키를 발급합니다.

## API
- `GET /api/health`: 상태 확인 (인증 불필요)
- `POST /api/key-run`: 키 모드 로더가 키를 검증받고 원문을 받는 경로 (인증 불필요, 키가 필요). 브라우저로 열면 403을 반환합니다.
- `POST /api/auth/signup`: 소유자가 없을 때만 가입 가능 (인증 불필요)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/scripts`: 스크립트 목록
- `POST /api/scripts`, `PATCH /api/scripts/:id`, `DELETE /api/scripts/:id`: owner, admin, user (모두 로드스트링 생성·수정·삭제 가능)
- `POST /api/execute`: 스크립트 원문 반환 (API 키 필요). 일반 사용자는 키리스 스크립트만 받을 수 있고, 관리자·소유자는 키 모드 스크립트도 받을 수 있습니다.
- `POST /api/scripts/:id/keys`: 키 모드 스크립트의 키 발급 (로그인한 누구나, 같은 스크립트의 키를 여러 개 발급 가능; 키마다 HWID가 따로 묶임)
- `GET /api/script-keys`: 본인 키 목록 (owner, admin은 전체)
- `PATCH /api/script-keys/:id`: 정지·재개, HWID 초기화 `{"reset_hwid": true}` (owner, admin)
- `DELETE /api/script-keys/:id`: 폐기 (본인 또는 owner, admin)
- `GET /api/users`, `GET /api/keys`: 사용자와 API 키 목록 (owner, admin, admin은 user만)
- `POST /api/keys`, `DELETE /api/keys/:id`: API 키 발급·폐기 (owner, admin)
- `PATCH /api/users/:id`: 상태 변경 (owner, admin), 역할 변경 (owner)

## 앱사이트
`/`는 소개 페이지이고, 관리 화면은 `/admin`입니다. 관리 화면에서 API 키로 로그인합니다. 스크립트 주소를 브라우저로 열면 원문 대신 로더를 보여 주는 페이지가 나옵니다. 소유자와 관리자는 Users 화면에서 사용자 추가, API 키 발급·폐기, 차단, 역할 변경을 할 수 있습니다. Scripts 화면에서 키 모드 스크립트의 KEY 버튼으로 스크립트 키를 발급하고, Script Keys 화면에서 정지·재개·폐기·HWID 초기화를 합니다.

## 한계
- 키리스 원문과 키 모드 로더는 누구나 받을 수 있습니다. 키 모드의 실제 코드는 유효한 키에만 내주지만, 키를 받은 사람은 그 코드를 복사할 수 있습니다.
- 원문 URL은 브라우저 주소창에서 열면 403이 나옵니다. 이는 요청 헤더 기준이라 완전하지 않습니다.
- API 요청 횟수 제한은 아직 없습니다.
- 키 모드 스크립트의 원문도 소유자와 관리자는 편집 창에서 볼 수 있습니다. 일반 사용자에게는 원문이 나가지 않습니다.
- 주요 작업과 인증 실패는 `api_audit_logs`에 기록됩니다.
