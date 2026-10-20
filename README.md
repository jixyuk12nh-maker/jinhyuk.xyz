# TM Lua Host

Cloudflare Worker(`tm`), D1(`tm-db`), R2(`jinhyuk--xyz`)로 Lua 스크립트를 저장하고 URL로 배포합니다.

## 역할
| 역할 | 할 수 있는 일 |
|---|---|
| owner | 모든 사용자와 키 관리 (owner, admin, user 모든 역할의 API 키 발급), 역할 변경, 스크립트 관리 |
| admin | `user` 계정과 그 키 관리 (API 키는 `user` 계정에만 발급), 스크립트 관리 |
| user | 로그인 후 스크립트 생성·수정·삭제, 스크립트 키 발급, 본인 키 조회·폐기 |

API 키는 앱사이트 로그인용이며, **계정(사용자)마다** 발급합니다. 관리 화면의 API Keys 화면은 계정 목록이고, 여기서 역할·차단 상태·키를 관리합니다. 프로젝트는 키에 선택적으로 연결되는 정보일 뿐이며, 접근 권한은 계정의 역할로 정해집니다.
스크립트 키는 키 모드 스크립트마다 Script Keys 화면에서 발급하고, API로도 발급합니다.

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

## 난독화 (스크립트 저장 시 자동 적용)
스크립트를 저장하면 `src/obfuscator.js`의 내장 VM 난독화기가 원문을 바이트코드 VM 코드로 바꿉니다.
- 원문: R2의 `scripts/<id>.raw.lua` (작성자와 소유자의 `POST /api/execute`에서만 나옴)
- 난독화본: R2의 `scripts/<id>.lua` (로드스트링, 키 모드 검증 응답)

저장 순서는 다음과 같습니다.
1. 원본을 R2(`raw`)에 먼저 저장합니다.
2. 원본을 VM 난독화합니다. 실패하면 1단계의 원본을 지우고 저장을 막습니다.
3. 난독화본을 R2(`obfuscated`)에 저장합니다.
4. D1에 스크립트 정보를 기록합니다. 실패하면 R2 객체 둘 다 지웁니다.

원본은 관리 화면의 프로필 탭에서 `/api/execute`로 읽고, 난독화본은 로드스트링 주소로 내려갑니다.

R2 객체는 짝으로 저장되며 서로를 메타데이터로 가리킵니다.
- `scripts/<id>.raw.lua`: `role=raw`, `pair=scripts/<id>.lua`, `scriptId`, `sha256`(원문)
- `scripts/<id>.lua`: `role=obfuscated`, `obfuscated=1`, `pair=scripts/<id>.raw.lua`, `scriptId`, `sha256`(원문)
D1의 `hosted_scripts.object_key`와 `raw_object_key`가 기준 연결이고, R2 메타데이터는 R2 콘솔에서 짝을 확인하기 위한 표시입니다.

지원하지 않는 최상위 문장(함수 정의, 테이블, 메서드 호출 등)은 난독화하지 않고 원문 그대로 둡니다.
외부 서버나 secret 설정은 필요 없습니다. 난독화 중 구문 오류가 나면 422로 저장이 막힙니다.
마이그레이션 0013(`raw_object_key`, `obfuscated` 컬럼)을 적용해야 합니다. 0013 이전에 저장된 스크립트는 원문 그대로 서빙되므로, 수정 저장하면 난독화본으로 바뀝니다.

## 난독화 도구 (CLI)
저장 API와 같은 난독화기(`src/obfuscator.js`)를 로컬에서 직접 쓸 수 있습니다.
```
npm run obfuscate -- 원본.lua                 # 원본.obf.lua 생성
npm run obfuscate -- 원본.lua -o 출력.lua      # 출력 경로 지정
npm run obfuscate -- 원본.lua --check         # 파일을 쓰지 않고 구간 수와 구문만 확인
npm run obfuscate -- 스크립트폴더 -o 출력폴더    # 폴더 안의 .lua 전부 (하나라도 실패하면 종료 코드 1)
```
출력에는 `VM 구간 N개, 원문 구간 M개`가 나옵니다. 원문 구간이 많으면 난독화되지 않은 부분이 많다는 뜻입니다.

## 보안 보호 (Turnstile / 자동 차단)

### Turnstile 설정

1. Cloudflare Dashboard → Turnstile에서 `jinhyuk.xyz` 도메인용 위젯을 생성합니다.
2. 사이트 키를 Worker 변수 `TURNSTILE_SITE_KEY`로 설정합니다.
3. 비밀 키는 공개 변수나 코드에 넣지 말고 Worker Secret으로 설정합니다.
   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```
4. `TURNSTILE_HOSTNAME`은 `jinhyuk.xyz`로 설정합니다. 로컬 또는 다른 도메인에서 시험하려면 해당 호스트도 Turnstile에 등록하고 호스트 값을 맞춰야 합니다.
5. 두 키가 모두 설정되면 첫 브라우저 진입에 Turnstile을 표시하고, 성공 후 30분 동안 유효한 서명된 HttpOnly 쿠키를 발급합니다. 브라우저 API 요청도 해당 쿠키를 확인합니다.

키를 설정하지 않으면 Turnstile 검사는 활성화되지 않습니다. 배포 후 `GET /api/health` 응답의 `turnstile` 값이 `true`인지 확인하세요.

### 공격 시도 대응

- 같은 IP에서 같은 스크립트의 잘못된 키를 10분 안에 6회 이상 시도하면 이후 응답에 실제 코드 대신 실행 효과가 없는 페이크 Lua 응답을 반환합니다.
- 10분 안에 8회 이상 반복하면 해당 IP를 72시간 자동 차단합니다.
- 인증 없는 API 요청도 반복되면 72시간 자동 차단될 수 있습니다.
- 자동 차단 만료 시각은 D1 `banned_ips.expires_at`에 저장됩니다. 기존 수동 차단은 만료 시각이 없으면 영구 차단으로 유지됩니다.
- 보안 이벤트는 D1 `security_events`에 기록되고, owner/admin은 `GET /api/security-events`로 최근 이벤트를 조회할 수 있습니다.
- 클라이언트 내부의 메모리 덤프 도구 사용을 서버가 직접 확실히 감지할 수는 없습니다. 이 구현은 반복적인 잘못된 키와 인증 실패 등 서버에서 관찰 가능한 신호에 대응합니다.

Cloudflare Dashboard의 **Security → Bots → Bot Fight Mode**도 별도로 활성화하세요. 이 설정은 Worker 코드로 자동 활성화되지 않습니다.

## 테스트
```
npm test
```
`node --test`로 난독화기를 검사합니다. Lua 실행기(`lua5.4`, `lua5.3`, `lua`, `texlua` 중 하나)가 있으면 원본과 난독화본의 실행 결과도 비교합니다. 없으면 그 테스트만 건너뜁니다.

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
- `POST /api/execute`: 스크립트 원문 반환 (API 키 필요, 작성자와 소유자만 가능).
- `POST /api/scripts/:id/keys`: 키 모드 스크립트의 키 발급 (로그인한 누구나, 같은 스크립트의 키를 여러 개 발급 가능; 키마다 HWID가 따로 묶임)
- `GET /api/script-keys`: 본인 키 목록 (owner, admin은 전체)
- `PATCH /api/script-keys/:id`: 정지·재개, HWID 초기화 `{"reset_hwid": true}` (owner, admin)
- `DELETE /api/script-keys/:id`: 폐기 (본인 또는 owner, admin)
- `GET /api/users`, `GET /api/keys`: 사용자와 API 키 목록 (owner, admin, admin은 user만)
- `POST /api/keys`, `DELETE /api/keys/:id`: API 키 발급·폐기 (owner, admin). 키는 `user_id` 또는 `username`으로 계정에 붙고, `project_id`는 선택입니다. admin은 `user` 계정에만 발급합니다.
- `PATCH /api/users/:id`: 상태 변경 (owner, admin), 역할 변경 (owner)

## 원문 보호 규칙
- 스크립트 주소를 브라우저로 열면 누구나(소유자 포함) 차단됩니다. 403 페이지가 나옵니다.
- 원문은 관리 화면의 **프로필** 탭에서만 확인합니다. 본인이 만든 스크립트만 보이고, 소유자는 전체를 봅니다.
- 원문 API(`POST /api/execute`)도 작성자와 소유자만 받을 수 있습니다. 키리스·키 모드 모두 같습니다.
- 소유자는 Cloudflare R2에서 원문 파일을 직접 볼 수 있습니다.
- Roblox 실행기처럼 브라우저가 아닌 요청은 기존과 같습니다. 키리스는 원문, 키 모드는 키 검증용 스텁을 받습니다.

## 앱사이트
`/`는 소개 페이지이고, 관리 화면은 `/admin`입니다. 관리 화면에서 API 키로 로그인합니다. 스크립트 주소를 브라우저로 열면 원문 대신 로더를 보여 주는 페이지가 나옵니다. 소유자와 관리자는 API Keys 화면의 계정 목록에서 키 해지, 차단·차단 해제를 할 수 있습니다. 역할 변경은 소유자만 합니다. 관리자는 `user` 계정만 보이고 관리합니다. 계정 추가와 키 발급은 같은 화면에서 계정 기준으로 진행합니다. Scripts 화면에서 키 모드 스크립트의 KEY 버튼으로 스크립트 키를 발급하고, Script Keys 화면에서 정지·재개·폐기·HWID 초기화를 합니다.

## 한계
- 키리스 원문과 키 모드 로더는 누구나 받을 수 있습니다. 키 모드의 실제 코드는 유효한 키에만 내주지만, 키를 받은 사람은 그 코드를 복사할 수 있습니다.
- 브라우저 여부는 요청 헤더로 판단합니다. 헤더를 직접 조작하면 구분할 수 없습니다.
- 요청 방어는 Turnstile 및 반복 인증 실패 기반 자동 차단을 포함합니다. 모든 경로에 대한 정교한 분산 rate limit은 Cloudflare 대시보드의 WAF/Rate Limiting 규칙도 함께 설정해야 합니다.
- 난독화된 최상위 `local` 변수는 전역 변수로 남습니다. 원본과 실행 결과는 같지만 `_G`에서는 보입니다. 원문 구간의 `local`은 그대로 유지됩니다.
- 원문은 작성자와 소유자만 볼 수 있습니다. 관리자라도 작성자가 아니면 볼 수 없습니다.
- 주요 작업과 인증 실패는 `api_audit_logs`에 기록됩니다.
## Chunked script delivery

Key-protected scripts now use a six-chunk delivery flow. The Worker creates a 120-second session, stores only a hash of the session token, serves one chunk per ordered request, rechecks the license/key before each chunk, and rejects replay/out-of-order requests. The legacy `/api/key-run` endpoint is disabled so it cannot return the full script in one response. Apply migrations `0017_script_delivery_sessions.sql` and `0018_served_script_integrity.sql` before deploying this version.

This raises extraction difficulty but is not DRM: a client that receives and executes Lua code can still dump or reconstruct it. Use server-side logic for sensitive decisions and rotate/revoke exposed keys.

## Automatic deployment with GitHub Actions

This repository uses `wrangler.jsonc` as its only Wrangler configuration file. `wrangler.toml` has been removed to avoid configuration ambiguity.

To enable automatic deployment, add these GitHub repository Actions secrets under **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token permitted to deploy Workers and manage the configured resources as required by Wrangler.
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.

The workflow `.github/workflows/deploy.yml` deploys automatically when a commit is pushed to the `main` branch, and can also be started manually from the GitHub Actions tab. It runs the JavaScript syntax checks before deployment.

Keep `TURNSTILE_SECRET_KEY` in the Cloudflare Worker `tm` **Settings → Variables and Secrets** as a Secret. Never commit the secret value to this repository. The public `TURNSTILE_SITE_KEY` may remain in `wrangler.jsonc`.

If Cloudflare Workers Builds is also configured to deploy on pushes, disable one of the two deployment methods to avoid duplicate deployments. This workflow deploys code; it does not automatically apply production D1 migrations.
