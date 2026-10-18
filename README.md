# TM Lua Host

Cloudflare Worker(`tm`), D1(`tm-db`), R2로 Lua 스크립트를 저장하고 URL로 배포하는 서비스입니다.

## 구성
- D1: `hosted_scripts`(스크립트 메타데이터), `api_users`, `api_keys`, `api_audit_logs`
- R2: 스크립트 원문 (`wrangler.jsonc`의 `jinhyuk--xyz`)
- 인증: API 키를 `Authorization: Bearer tmk_...` 헤더로 전송합니다. 키는 SHA-256 해시로만 D1에 저장되며, 키를 URL이나 로그에 남기지 않습니다.

## 역할
| 역할 | 할 수 있는 일 |
|---|---|
| owner | 모든 사용자와 키 관리, 관리자 지정, 스크립트 관리 |
| admin | `user` 계정과 그 키 관리, 스크립트 관리 |
| user | 허용된 스크립트 실행 (`POST /api/execute`) |

## 배포 전 준비
1. `wrangler.jsonc`의 D1 ID와 R2 버킷 이름을 확인합니다. R2 버킷이 없으면 대시보드에서 만듭니다.
2. 기존 스키마를 확인합니다.
   `npx wrangler d1 execute tm-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"`
   `api_users`나 `api_keys`가 이미 있다면 구조를 먼저 확인하세요. 마이그레이션은 `IF NOT EXISTS`를 쓰므로 기존 테이블 구조가 다르면 그대로 남습니다.
3. D1을 백업한 뒤 마이그레이션을 적용합니다.
   `npx wrangler d1 migrations apply tm-db --remote`
4. 배포합니다.
   `npm run check && npm run deploy`

## 최초 Owner 생성 (한 번만)
1. 사용자 ID와 이름을 정해 SQL 파일을 만듭니다. 예시는 ID `owner-1`, 이름 `jinhyuk`입니다.
   `node scripts/make-key.mjs owner-1 jinhyuk owner > owner.sql`
   API 키가 터미널에 한 번만 출력됩니다. 안전한 곳에 저장하세요. 파일에는 키의 해시만 들어 있습니다.
2. 파일을 D1에 적용합니다.
   `npx wrangler d1 execute tm-db --remote --file owner.sql`
3. 키가 동작하는지 확인합니다.
   `curl -H "Authorization: Bearer <키>" https://jinhyuk.xyz/api/auth/me`
4. `owner.sql` 파일은 삭제합니다.

## 관리자와 사용자 키 발급
Owner나 Admin이 아래처럼 요청합니다. 사용자가 없으면 자동으로 만들어집니다. 기본 역할은 `user`이고, Owner만 `role`에 `admin`이나 `owner`를 줄 수 있습니다.

```
curl -X POST https://jinhyuk.xyz/api/keys \
  -H "Authorization: Bearer <키>" -H "Content-Type: application/json" \
  -d '{"username":"alice","role":"user","expires_in_days":30}'
```

응답의 `token`은 한 번만 보입니다. 키를 재발급하려면 새 키를 발급한 뒤 이전 키를 `DELETE /api/keys/:id`로 폐기하세요.

## API
- `GET /api/health` 서비스 상태 (인증 불필요)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/scripts` 스크립트 목록
- `POST /api/scripts`, `PATCH /api/scripts/:id`, `DELETE /api/scripts/:id` (owner, admin)
- `POST /api/execute` 스크립트 원문 반환. body에 `id` 또는 `slug` (키 필요)
- `POST /api/keys`, `DELETE /api/keys/:id` (owner, admin)
- `PATCH /api/users/:id` 상태 변경(`active`/`blocked`), 역할 변경은 owner만

## 원문 URL과 로더
- `https://jinhyuk.xyz/<slug>`와 `https://jinhyuk.xyz/raw/<id>`는 키 없이 열리는 공개 경로입니다. 로더가 이 경로를 쓰기 때문입니다.
- 브라우저에서 직접 열면 403이 나옵니다. Sec-Fetch 헤더로 판단하므로 `HttpGet`으로 받는 로더에는 영향이 없습니다.
- 로더: `loadstring(game:HttpGet("https://jinhyuk.xyz/<slug>"))()`

## 한계
- 로더용 공개 URL은 브라우저가 아닌 클라이언트로 누구나 받을 수 있습니다. 비밀값이나 민감한 코드는 올리지 마세요.
- 브라우저 차단은 요청 헤더에 기반하므로 완벽하지 않습니다.
- 요청 제한(rate limit)과 스크립트별 권한 설정은 아직 없습니다.
- 모든 인증 실패와 주요 작업은 `api_audit_logs`에 기록됩니다.

## 실행 모드와 스크립트 키
- 키리스(`mode=keyless`): 누구나 `loadstring(game:HttpGet("https://jinhyuk.xyz/<슬러그>"))()`로 실행합니다.
- 키 모드(`mode=key`): 원문 주소는 키 검증용 짧은 로더를 돌려줍니다. 키를 가진 누구나 실행할 수 있고, 키가 폐기·정지·만료되면 실행되지 않습니다. 실행 전에 `script_key`를 설정해야 합니다.
  ```lua
  script_key = "여기에_스크립트_키"
  loadstring(game:HttpGet("https://jinhyuk.xyz/<슬러그>"))()
  ```
  로더는 `POST /api/key-run`으로 키를 검증받고, 통과하면 원문을 받아 실행합니다. 원문은 키 없이는 받을 수 없습니다.
- 스크립트 키 발급: 로그인한 누구나 `POST /api/scripts/:id/keys`로 키 모드 스크립트의 키를 받을 수 있습니다. 사용자당 스크립트별 활성 키는 하나입니다.
- 키 조회·정지·폐기: `GET /api/script-keys`, `PATCH /api/script-keys/:id`(`active`/`suspended`, 관리자만), `DELETE /api/script-keys/:id`(본인 또는 관리자).
- 한글 슬러그는 입력한 그대로 주소가 됩니다 (예: `https://jinhyuk.xyz/리버즈`). Roblox 실행기가 한글 주소를 그대로 여는지는 실제 테스트가 필요합니다.
- 키 모드 스크립트의 원문 읽기(편집 화면)는 서버 연결 후 지원할 예정입니다.
- 소유자용 로더는 `loader.lua`처럼 `.lua`로 끝나는 슬러그로 키리스 스크립트를 만들면 됩니다.
- HWID 잠금(`hwid_lock`): 키 모드 스크립트에서 켜면 키 1개가 처음 실행한 기기 1대에만 연결됩니다. 다른 기기에서는 403이 나옵니다. Owner/Admin은 `PATCH /api/script-keys/:id`에 `{"reset_hwid": true}`를 보내 연결을 풀 수 있습니다. HWID 값은 로블록스의 `RbxAnalyticsService:GetClientId()`를 씁니다.
- 앱사이트(`public/`)에서 API 키로 로그인하면 키 모드 스크립트의 "키 발급" 버튼으로 본인 키를 받을 수 있고, "내 스크립트 키"에서 정지·폐기·HWID 초기화를 할 수 있습니다.
