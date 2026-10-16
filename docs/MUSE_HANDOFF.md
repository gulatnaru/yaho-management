# Muse VM / Codex CLI 인수인계

작성: 2026-10-17 KST. 초안 준비는 문서 작성 및 읽기 전용 점검으로 끝냈다. 이후 사용자가 이 문서 단독 commit/push와 Memory 기존8커밋 push를 명시 승인했다. 최종 동기화는 이 범위만 수행하며 DB 접근·migration·명시적 배포·실제 외부AI 호출·merge는 금지한다.

## 1. 안전한 중단 지점과 이전 대상

- Phase21 AI Service 후속 개발의 승인된 합성·비운영 검증 및 Draft PR 생성 완료. 실행 중인 개발 작업을 이어서 기다릴 필요 없음.
- 이전 브랜치: `feature/phase21-ai-service`.
- 마지막 코드 커밋/검증 SHA: `d1f29cacb7c15c5f491ccb9230171e1bc2bd1412`. 이 문서 포함 최신 프로젝트 HEAD는 clone 후 `git rev-parse HEAD` 및 PR54로 확인하며 코드 검증SHA와 구분한다.
- 이전 feature 커밋: `3e1e42702c9d9647d165a07dac0e5ed6915690a8`.
- 후속 Worktree: `C:/Users/gulat/.codex/worktrees/phase21-ai-service/yaho-management`.
- 프로젝트: https://github.com/gulatnaru/yaho-management
- Draft PR54: https://github.com/gulatnaru/yaho-management/pull/54
- 마지막 코드 SHA에서 개발 코드·테스트·schema·migration·SPEC/PLAN/ADR/검증 문서 모두 tracked/pushed. base 대비65파일,4804추가/28삭제. 누락된 미커밋 코드·테스트·migration 없음.
- 새 `docs/MUSE_HANDOFF.md`만 사용자 승인으로 docs commit/push하는 대상이다. 다른 unstaged/untracked 파일은 포함하지 않는다.
- 최신 `docs/LAST_RUN_REPORT.md`는 후속 Worktree에만 있는 미커밋 실행 결과. 보호해 보존하고 자동 stage하지 않는다. 핵심 최종 결과와 실패 이력은 이 문서에도 기록한다.
- 문서 commit으로 HEAD가 달라진다. 코드/E2E 검증SHA는 d1f29ca이며 새 문서 HEAD에서 E2E를 다시 실행한 것으로 기록하지 않는다. 최종동기화에서는 GitHub CI만 새 HEAD에서 확인한다.

## 2. 브랜치 base / PR 의존 관계

```text
main
  └─ feature/phase21-kakao-ai-consultation (PR53, OPEN/DRAFT)
       117151772552b16b6e81e3bbba23bb50e0826f0e
       └─ feature/phase21-ai-service (PR54, OPEN/DRAFT)
            3e1e427 → d1f29ca
```

실제 merge-base는 `117151772552b16b6e81e3bbba23bb50e0826f0e`. PR54의 base는 main이 아닌 Mock 브랜치다. 두 PR을 merge하지 않는다. 향후 PR53 squash merge가 별도 승인되면 follow-up diff만 새 base로 이식하는 계획과 재검증이 필요하다. 지금 rebase/cherry-pick/merge를 실행하지 않는다.

## 3. 전체 Worktree 변경 조사와 보존 대상

| Windows Worktree | 상태 / 변경 파일 | 처리 |
|---|---|---|
| `C:/projects/yaho-management` | main, `.gitignore`, `docs/LAST_RUN_REPORT.md` unstaged | 기존 보호 파일. 수정/stash/restore/checkout/stage/commit 금지 |
| `C:/Users/gulat/.codex/worktrees/phase21-ai-service/yaho-management` | 후속 feature, `docs/LAST_RUN_REPORT.md` unstaged + 이번 `docs/MUSE_HANDOFF.md` untracked | 새 handoff만 승인 후보. 실행 보고서는 자동 커밋하지 않음 |
| `C:/Users/gulat/.codex/worktrees/phase21-kakao-ai-spec/yaho-management` | Mock feature, `REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/LAST_RUN_REPORT.md` unstaged; `docs/AI_CONSULTATION_LIVE_SPEC.md` untracked | 기존 보호4파일. 자동복사/커밋/덮어쓰기 금지 |
| `C:/Users/gulat/.codex/worktrees/phase21-preview-validation/yaho-management` | feature/phase21-preview-validation, HEAD1db777a4929f5ac684a54520cfd8fa4cae252b4e, clean | 과거 validation candidate, 주 개발 branch 아님 |
| `C:/Users/gulat/.codex/worktrees/yaho-metrics-retrospective/yaho-management` | detached1fb8c77bdbdf4a8b1c7d6772b2b955c22a124956, clean | 이번 이전 대상 아님 |

조사는 모든 Worktree에서 `git status --porcelain=v1 --untracked-files=all`로 수행했다. ignored 파일은 아래 별도 제외 목록으로 처리한다. 보호된 Mock 미추적 SPEC과 후속 브랜치의 tracked SPEC은 해시가 다르다. 동일 문서라고 가정하여 합치지 않는다. 이 Windows 전용 버전들은 Git clone으로 전달되지 않으며 필요하면 소유자 검토 후 별도 승인해야 한다.

## 4. 완료한 구현

- 기존 Next.js Modular Monolith 유지. 교체 가능한 Provider 인터페이스, 테스트 더블, OpenAI adapter/transport 코드. 실제 연결은 비활성.
- ADMIN 승인 프로그램·일정·안내만 조회하는4개 allowlisted read Tool, 서버 최종 응답 구성, 숫자/개인정보 비노출, 인젝션·권한 검증.
- 월 실제 청구 목표10000KRW(절대 초과 보장 아님), 승인한도8000KRW를 Preview1000/Production7000으로 분리. KST 월 경계, 승인한 FX10%/tax10%/card5% buffer, 원자적 비용 예약·정산·불확실 사용량 hold·외부 청구 reconciliation.
- 중복·동시 요청 보호, HMAC key pinning, 분리·버전 암호화키,90일 만료 조회 차단, 삭제 worker core, 비식별 통계.
- ADMIN 설정/조회 코드와 카카오 Skill 요청·응답 코드. live ingress/ADMIN service 활성화는 immutable BUILD lock으로 차단; env flag만으로 열 수 없음.
- 승인된 Preview identity/lease/run ownership/정확SHA/migration guard. 신규 서비스 E2E는 원장 DELETE 없이 always-rollback fixture 사용.
- Preview DML-only DO에서 실제 SQLSTATE/table/constraint를 정확히 검증한 경우에만 비밀 없는 canonical 오류 재발행. 기존 strict Prisma matcher/Mock timeout/migration은 그대로.
- Phase20 기능·정책과 보호된 Mock26경로 재작성 없음.

## 5. 검증 결과: Windows에서 이미 실행한 증거

아래는 d1f29ca 및 해당 source hash에 대한 완료 결과이며 Muse에서 재실행한 결과가 아니다.

| 검증 | 결과 |
|---|---|
| 전체 unit |148파일/1673 PASS |
| 독립 QA 집중 테스트 |62/62 PASS |
| lint / typecheck / Prisma validate / diff |모두 exit0 |
| 최종 production build |Next dev 전체프로세스0 확인 후 실제 exit0 |
| 폐기용 native PostgreSQL17.11 |15migration 재구성 PASS, 실제 commit 경합9/9 PASS |
| native INTEGRITY |정상3제약 + wrong constraint/state/no-exception negative6 PASS, rollback 잔존0 |
| 실제 Preview AI_SERVICE |9/9 PASS |
| 실제 Preview 기존 Mock |3/3 PASS |
| 실제 Preview 공통/Phase20 회귀 |29/29 PASS, PG race12개 포함 |
| Preview runner |세 실행 모두 wrapper/child0, COMPLETE/EXIT_0/cleanupPASSED, skip/timeout/interrupted/unexecuted0 |
| 최종 독립 QA / Review |각 PASS, Critical0/Major0/Minor0 |
| GitHub quality CI |38926424649 SUCCESS, exact d1f29ca |
| Vercel check |SUCCESS, exact GitSource Preview READY |
| Production Schema Gate |38926417254 detect-schema-change SUCCESS; production-migrate PENDING, stepCount0; 전체 PASS 아님 |

QA는 집중62와 safe artifacts를 직접 검사했다. Review는 synthetic positive1/negative15/non-Preview body0/client0 검사 및 최종 artifacts를 직접 확인했다. 전체unit/nativePG는 BUILD 실행 근거 재사용으로 구분한다. 모바일 검증은 익명 ADMIN 차단 및 화면 폭 검사 범위다.

검증 Preview deployment ID: `dpl_BJCyhzkGNXHXx3Y3gWooMrzSzrKm`, 정확SHA d1f29ca, Preview target, per-deployment sin1. 프로젝트 전역 Production 브랜치/지역은 main/syd1 그대로다. 기존 배포가 현재도 READY인지 나중에 다시 확인해야 한다. 자동 Preview는 Sydney 기본값이라 기존450ms Mock scope budget과 DB 지역 지연에 민감하며, sin1 배포를 명시적으로 확인한다. Production region이나 guard timeout을 임의 변경하지 않는다.

### 실패 이력과 잔여 위험

- 초기 Sydney AI2/9·Mock1/3 실패, 동일source sin1에서Mock3/3 및AI8/9. 지역 지연 가설은 비교와 일치하나 실제 timing 계측 증명은 아님.
- nativePG에서 Prisma6 P2010/23505가 constraint primary 대신 DETAIL만 노출함을 재현했다. 정확한3중 제약 검증 수정 후 최종 실제Preview AI9/9 PASS. generic 오류를 통과시키는 완화 없음.
- 초기 공통28/29에서 출결 “저장됨” UI assertion 실패. DB COMPLETED/PRESENT·HTTP2XX였고, 기존코드 그대로 focused3/3 및 최종29/29 PASS. UI 원인은 미확정 상태 유지.
- native 초기 claim55P03, settlement fixture의 invalid category, Docker readonly filesystem, probeP1001, usage-limit 중단 이력 보존. 최종 성공과 최초 실패를 구분한다.
- 안전 요약의 testCounts UNKNOWN은 `.safe-tests.json` 상세 수치로 확인했다. 원문 Playwright/HTML/headers/secret 로그를 반출하지 않는다.

## 6. Migration / Preview DB: 적용된 사실과 이번 이전의 금지

- 추가형 `20261015090000_ai_service_followup/migration.sql` 작성 및 승인된 Preview에만 적용 완료. 총15 applied/pending0, 신규11 service table RLS 확인.
- SHA256: `BACD02B4A1C69E19C891D0C122F08BF9F715B6D0B2E43F5899D92C329FEE1B7F`.
- 기존 Mock `20261014090000_phase21_ai_consultations_mock/migration.sql` 해시: `26DC71BB2A44BB15F6DD3FD83ACEB3FA109E84D29275BECCC4F82D05F787026C`.
- 기존 적용 migration 수정/삭제 없음. Production 미접근·미적용.
- 과거 사용자 명시 승인으로 Preview38업무table 영구DELETE 완료. User 인증/schema/migration history/system 보존. 백업 면제는 그 일회 작업만이며 다시 실행할 권한 아님.
- 최종 E2E run-owned cleanup 성공. 서비스 원장은 항상rollback하며 삭제 보호를 우회하지 않는다.
- native 검증 클러스터3개는 서버중지/포트0/경로·reparse·PID 확인 후 Windows 디렉터리를 폐기했다. 실행파일만 남았고 VM에 복사하지 않는다.
- **이번 이전 준비에서는 Preview와 Production DB를 조회·변경하지 않았으며, Muse 첫 작업에서도 DB 접속/migration/seed/E2E를 자동 실행하지 않는다.** 필요 시 현재 승인 범위를 다시 확인한다.

## 7. 미완료와 승인 게이트

코드이전 검증 실패는 없다. 사용자는 새 handoff 단독 게시와 최신 Memory 기존8커밋 동기화를 승인했다. 두 push와 CI 확인을 완료한 뒤 재개하며, 실제 운영·개인정보·외부AI 승인 게이트는 그대로 남는다.

- 실제 OpenAI/Kakao 호출·Skill 연결·고객정보 처리·운영 AI 활성화 금지. 합성 검증 완료가 운영 승인 아님.
- 개인정보 처리방침, 외부AI/국외이전, 보관·삭제·backup/restore 승인 문서 미확보. 실제 고객 LLM 전송 불가.
- 실제 카카오 채널/Skill 인증·권한·응답시간·Callback 검증과 승인된 운영 안내 원문 확보 필요. Callback 초기 비활성,4초 전체 응답 목표.
- 실제 Provider 모델·요금·환율 승인 및 외부 청구 대조, 하루1회 worker의 scheduler·물리삭제 지연·백업 삭제/복구 정책은 별도 운영 검토·승인.
- Production Schema Gate/merge/release는 이번 작업 밖. PENDING을 성공/새 사람승인 요청으로 단정하지 않으며 gate 승인·취소·보호 해제 금지.
- 후속 문서만 commit하면 코드 검증SHA와 새 HEAD를 구분. 새 환경의 테스트는 실행 전 미검증으로 표시.

## 8. Muse VM 첫 실행: 정확한 Git 명령 (Linux shell)

새 디렉터리에서 수행한다. 기존 checkout이 있으면 clone/덮어쓰기 대신 `pwd`, `git status --short --untracked-files=all`, `git worktree list`를 먼저 확인한다. credential이 삽입된 remote URL이나 인증 파일은 출력하지 않는다.

```bash
mkdir -p ~/projects
git clone --branch feature/phase21-ai-service https://github.com/gulatnaru/yaho-management.git ~/projects/yaho-management
cd ~/projects/yaho-management
git fetch origin feature/phase21-ai-service feature/phase21-kakao-ai-consultation
git status --short --untracked-files=all
git branch --show-current
git rev-parse HEAD
git merge-base HEAD origin/feature/phase21-kakao-ai-consultation
git show --no-patch --format=fuller d1f29cacb7c15c5f491ccb9230171e1bc2bd1412
git diff --name-only d1f29cacb7c15c5f491ccb9230171e1bc2bd1412 HEAD
```

기대 base는1171517, 코드SHA는d1f29ca다. 이번 handoff commit을 승인·push하면 HEAD는 새 문서 커밋이 된다. 이 경우 마지막 diff는 승인된 문서만 나와야 한다. 예상 밖 코드 차이가 있으면 중단·조사하며 reset/clean하지 않는다.

```bash
gh pr view 53 --repo gulatnaru/yaho-management --json state,isDraft,headRefOid,baseRefName
gh pr view 54 --repo gulatnaru/yaho-management --json state,isDraft,headRefOid,baseRefName,statusCheckRollup
```

GitHub 인증은 VM의 안전한 credential 관리를 사용한다. Windows Git/CLI 인증 파일은 복사하지 않는다.

### Memory 가져오기: 별도 저장소, 승인된 동기화 후

```bash
mkdir -p ~/agent-memory
git clone https://github.com/gulatnaru/yaho-management-memory.git ~/agent-memory/yaho-management
git -C ~/agent-memory/yaho-management status --short
git -C ~/agent-memory/yaho-management rev-parse HEAD
```

private 저장소이므로 인증이 필요하다. 기존 비Memory 디렉터리에 clone/덮어쓰기하지 않는다. `MEMORY.md`부터 읽고 필요한 `[[current]]` 등만 따른다. 동기화 사전 점검에서 Windows local master842850bece0755ac45753987e4fd16580d3c6063, remote master619291556b80dd7d1c0b3d4d61fa9d4809d29b9f였고 remote0/local8 ahead 및 clean을 확인했다. 사용자가 이8개 커밋의 fast-forward push를 승인했다. 동기화 완료 후 VM의 Memory HEAD가842850bece0755ac45753987e4fd16580d3c6063인지 확인하며 다르면 원격 상태와 인계 결과를 다시 확인한다. 실제 source/docs를 Memory보다 우선한다.

### 개발 재개 시 읽기 순서와 로컬 검증

1. 현재 사용자 지시, AGENTS.md, REQUIREMENTS.md, docs/DECISIONS.md(ADR061/062), ARCHITECTURE.md 확인.
2. docs/AI_CONSULTATION_LIVE_SPEC.md, AI_CONSULTATION_LIVE_PLAN.md, AI_SERVICE_BUILD_REPORT.md, AI_SERVICE_TEST_TRACE.md, AI_SERVICE_QA_REVIEW.md 및 이 handoff 확인. Git의 LAST_RUN_REPORT는 Windows 로컬 최종본보다 오래될 수 있다.
3. Node20(CI와 동일), npm, Codex CLI, GitHub CLI 준비. 역할별 skill 재확인. 코드 변경은yaho-build developer subagent, QA/Review는 읽기 전용.
4. dev 프로세스를 포트에 의존하지 않고 확인. 로컬 검증용 격리 dummy datasource 설정을 안전하게 준비하고 실제 DB credential을 재사용하지 않는다. 값은 문서에 쓰지 않는다.
5. 아래 명령은 로컬 검증 후보다. 실제 DB/외부 API를 요구하면 중단하며 Preview/Production 접근으로 우회하지 않는다.

```bash
npm ci
npm run prisma:generate
npm run lint
npx tsc --noEmit --incremental false
npm test
npx prisma validate
pgrep -af '[n]ext dev' || true
# dev 프로세스가 없을 때만 실행. 실행 중이면 build를 생략하고 이유를 보고한다.
npm run build
git diff --check
```

Playwright 명령은 `npm run test:e2e:preview`지만 이번 이전 작업에서는 실행하지 않는다. 별도 실행 권한 확인 후 기존 guard를 통과해야 한다. Playwright 단독 실행이나 BASE_URL만 지정해 guard를 우회하지 않는다. nativePG 스크립트는 고정 loopback의 폐기용 PG만 사용하며 Preview/기존 DB로 바꾸지 않는다. Windows 바이너리/클러스터를 Linux VM에서 재사용하지 않는다.

## 9. 환경변수: 이름만 기록, 값 제외

### Preview runner가 명시적으로 읽는12항목

```text
DATABASE_URL
DIRECT_URL
ADMIN_EMAIL
ADMIN_PASSWORD
VERCEL_AUTOMATION_BYPASS_SECRET
PREVIEW_E2E_HANDSHAKE_SECRET
PREVIEW_E2E_SUPABASE_PROJECT_REF
PRODUCTION_E2E_SUPABASE_PROJECT_REF
PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256
PLAYWRIGHT_BASE_URL
PREVIEW_E2E_ALLOWED_BASE_URLS
PREVIEW_E2E_DEPLOYMENT_SHA
```

PRODUCTION_E2E_SUPABASE_PROJECT_REF는 거부 대상 식별값이며 Production credential을 준비하라는 지시가 아니다. 연결값은 승인된 Preview만 사용한다. app/runner/runtime identity/정확SHA/migration/lease를 기존 guard로 검증해야 한다.

### 기존 Mock용6항목: 신규 service key와 혼용 금지

```text
AI_ENCRYPTION_KEYS
AI_ENCRYPTION_ACTIVE
AI_HMAC_KEYS
AI_HMAC_ACTIVE
AI_MOCK_REQUEST_SECRET
AI_MOCK_LIMITS
```

### Service key reader 이름: live 활성화 권한이 아님

```text
AI_SERVICE_ENCRYPTION_KEYS
AI_SERVICE_ENCRYPTION_ACTIVE
AI_SERVICE_HMAC_KEYS
AI_SERVICE_HMAC_ACTIVE
```

로컬 app/auth의 기존 이름:`AUTH_SECRET`, `NEXTAUTH_URL`. suite 선택:`PREVIEW_E2E_FOCUS`. native opt-in:`AI_SERVICE_LOCAL_POSTGRES_APPROVED`. 이름 기재가 DB 실행/live 활성화를 승인하지 않는다. runner가 생성하는 run ID/proof/lease 변수는 Windows에서 복사하지 않는다.

실제 OpenAI API key는 이번 작업에 필요 없고 runtime에 실Provider를 연결하지 않는다. 실제 key 설정과 활성화는 별도 승인·설계 확인 대상이다. `.env` 재설정은 사용자의 안전한 secret 경로로 진행하고 cat/echo/로그/채팅에 값을 출력하지 않는다. 현재 runner는 프로젝트 직하 `.env.local`을 제한 parser로 읽으며 별도 `.env.preview-e2e.local`을 요구하지 않는다.

## 10. 이전 제외 / 로컬 전용 자료

- 모든 `.env*`의 실값, API/DB/ADMIN 인증정보, CLI 로그인정보, cookie/token/proof, runtime identity 실값, Vercel 링크·인증 설정, DB dump/backup/데이터, 고객정보.
- `node_modules`, `.next`, 브라우저 profile, Playwright 원문 artifacts/trace/HTML/screenshot. VM에서 재설치하고 원문을 통째로 archive하지 않는다.
- Windows CreatorTemp의 nativePG 바이너리·일회 probe/context/관리SQL. 클러스터 데이터는 이미 폐기했으며 재사용할 개발 스크립트는 Git에 있다.
- 보호된 기존 unstaged/untracked6파일 및 후속 local-only LAST_RUN_REPORT. 자동 commit/전송하지 않는다. 최신 핵심 결과는 이 handoff와 PR54 본문에 정리했다.
- 로컬 safe-tests/safe-summary는 Git 미수록. AI9/Mock3/default29 실제 결과 및 실패 이력은 이 문서/PR54에 기록했다. 원문 자료를 VM에서 새로 실행한 증거로 취급하지 않는다.

## 11. 최종 동기화 승인 범위

- Project:`docs/MUSE_HANDOFF.md`만 feature/phase21-ai-service에 docs commit/push. 기존 LAST_RUN_REPORT와 보호 파일은 제외. 코드 검증 SHA는d1f29ca로 계속 구분한다.
- Memory:clean한 master의 기존8개 로컬 커밋을 private origin/master로 일반 push. 이미 최신 checkpoint가 있어 내용 수정/새 commit은 불필요하다. 원격 변경·분기가 발견되면 force push하지 않고 중단한다.
- 이번 승인에도 main push/force push/merge/Production gate 승인/DB 작업은 범위 밖이다. 문서 push에 따른 Preview 자동 build/CI는 가능하지만 실제API나Production 활성화를 허용하지 않는다.

## 부록: 검증된 feature 차이65파일 (base1171517 → 코드d1f29ca)

```text
M	REQUIREMENTS.md
A	app/(admin)/ai-service/[id]/page.tsx
A	app/(admin)/ai-service/actions.ts
A	app/(admin)/ai-service/error.tsx
A	app/(admin)/ai-service/loading.tsx
A	app/(admin)/ai-service/page.tsx
A	app/api/ai-service/v1/retention/route.ts
A	app/api/ai-service/v1/skill/route.ts
A	app/api/e2e/ai-service-validation/route.ts
A	docs/AI_CONSULTATION_LIVE_PLAN.md
A	docs/AI_CONSULTATION_LIVE_SPEC.md
A	docs/AI_SERVICE_BUILD_REPORT.md
A	docs/AI_SERVICE_QA_REVIEW.md
A	docs/AI_SERVICE_TEST_TRACE.md
M	docs/DECISIONS.md
M	docs/LAST_RUN_REPORT.md
A	lib/e2e/preview-environment.ts
M	lib/e2e/preview-focus.ts
M	lib/e2e/preview-invocation.ts
M	lib/e2e/preview-runner.ts
M	playwright.config.ts
A	prisma/migrations/20261015090000_ai_service_followup/migration.sql
M	prisma/schema.prisma
A	scripts/e2e/ai-service-local-postgres.ts
A	scripts/e2e/ai-service-preview-migration-policy.ts
M	scripts/e2e/phase21-preview-environment.ts
M	scripts/e2e/preview-migration.ts
M	scripts/e2e/preview.ts
A	server/ai-service/admin-context.ts
A	server/ai-service/admin.ts
A	server/ai-service/billing.ts
A	server/ai-service/contracts.ts
A	server/ai-service/cost.ts
A	server/ai-service/crypto.ts
A	server/ai-service/handler.ts
A	server/ai-service/keys.ts
A	server/ai-service/ledger.ts
A	server/ai-service/openai-transport.ts
A	server/ai-service/preview/handler.ts
A	server/ai-service/preview/locks.ts
A	server/ai-service/preview/rollback.ts
A	server/ai-service/preview/scenarios.ts
A	server/ai-service/provider.ts
A	server/ai-service/public-numerals.ts
A	server/ai-service/public-text.ts
A	server/ai-service/publication-digest.ts
A	server/ai-service/repository.ts
A	server/ai-service/retention.ts
A	server/ai-service/runtime.ts
A	server/ai-service/tools.ts
A	server/ai-service/transport.ts
A	tests/e2e/phase21-ai-service.spec.ts
A	tests/unit/ai-service/actions.test.ts
A	tests/unit/ai-service/cost-provider.test.ts
A	tests/unit/ai-service/fake-db.ts
A	tests/unit/ai-service/handler-runtime.test.ts
A	tests/unit/ai-service/keys.test.ts
A	tests/unit/ai-service/korean-quantity.test.ts
A	tests/unit/ai-service/ledger.test.ts
A	tests/unit/ai-service/migration.test.ts
A	tests/unit/ai-service/openai-transport.test.ts
A	tests/unit/ai-service/preview-validation.test.ts
A	tests/unit/ai-service/privacy-tools.test.ts
A	tests/unit/ai-service/qa-regressions.test.ts
A	tests/unit/ai-service/review-regressions.test.ts
```
