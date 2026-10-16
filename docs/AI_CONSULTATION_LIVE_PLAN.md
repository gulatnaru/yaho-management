# Task
Phase21 후속 AI 실연동 — 조건부 승인 PLAN / 합성 전용 BUILD

## Current DB / environment verification — 2026-10-16

- 최신 독립 QA: PASS(Critical0/Major0/Minor0), focused4files/95tests actualexit0. 최초 sandbox spawn EPERM은 실패 이력으로 구분했고 escalation 재실행 PASS를 확인했다. 문서의 과거 미승인/NOT RUN/BLOCKED 표기는 historical로 표시했으며, 최신 Review는 root가 이어서 수행한다.

- 최신 명시적 사용자 승인에 따른 Preview 업무 데이터 일회 영구 DELETE는 완료됐다. 백업/출처 증명은 이번 승인에서 면제됐으며, 이전 UNKNOWN_STOP 및 backup-required 문단은 과거 checkpoint다. 기존 자동 E2E cleanup 정책이나 Production 보호를 일반적으로 바꾸지 않는다.
- 삭제 첫 안전실패(DELETE0/P0001/committed=false), 정확40table 집합 확인과 명시적 C collation 수정, root 재검토 후38table DELETE/fresh empty 및 User/history/schema 보존 PASS 이력은 유지한다.
- 승인 SQL20261015090000_ai_service_followup은 이제 APPLIED_PREVIEW다. root 실행 preflight/deploy/verify actualexit0, 전체15migration complete/pending0, 독립 catalog의 AiService11table RLS=true를 확인했다. Production 적용·접속·배포는 NOT RUN/금지다. 승인 신규/기존Mock migration checksum은 그대로다.
- 별도 폐기 native PostgreSQL17.11에서15versioned migrations 실제 재구성 PASS(exit0), 독립2Prisma clients의 실제 commit 경합9/9 PASS(exit0)를 별도 PG developer가 완료했다. 고정 loopback127.0.0.1:55421/yaho_phase21_validation만 사용했고 외부 API0, Preview/Production으로 이 suite를 실행하지 않았다. 최종 script SHA256은2CD2C20B7444A686A3FDE040525A572226A6D65D4AE874BBB41C0036C1105B1B이다.
- 실제9case: 중복 claim1회, 중복정산/metric1회, 동일invoice정산1회, 월예산마지막허용, subject quota마지막허용, publication version경합/철회, advisory lock timeout+rollback, pool maxWait writer차단, expiry purge와late settle의금융보존. 이는 repository doubles와 다른 실제 PostgreSQL 증거다. 이9case 범위 밖 실제 Preview pooler/HTTP/permission/trigger wrapping/모바일 검증은 아직 NOT RUN이다.
- native 첫 실행의 정산 실패 원인은 신규 test fixture의 category:SYNTHETIC이 DB CHECK에서 허용되지 않았기 때문으로 확정됐다. 이전 settlement lock-timeout 추측은 폐기한다. 별도로 관찰된 claim55P03 contention과 이 fixture 오류를 혼동하지 않는다. 신규 script의2곳 category만 실제 허용 GUIDANCE로, cleanup 설명만 native cluster로 수정했고 core/migration은 변경0이다. 최초 실패를 PASS로 덮지 않고 fresh15-rebuild/9case 재실행 성공을 별도 기록한다.
- native runtime fast stop exit0/55421listen0을 확인했다. append-only 원장·KeyPin·증빙에 SQL DELETE/trigger 우회를 하지 않았다. 합성 rows가 남은 정지된 owned disposable cluster 파일은 전체 QA/Review 후 root가 범위를 검증해 폐기할 예정이다. 운영 백업복구나 실청구 정산 검증으로 보고하지 않는다.
- 후속 remote env helper 최초 실패는 P21_ENV_VERCEL_FAILED(exit1)였다. 비밀 없는 진단으로 아직 원격에 없는 feature branch에 대한 branch_not_found를 확인했으며 첫 remote 변경0이었다. root가 브랜치 준비 후 Preview feature 범위에서12키 provision PASS를 확인했다. helper/product code 변경으로 우회하지 않았고 secret/stdout/stderr 원문을 출력하지 않았다.
- fresh local gates: dummy loopback DATABASE_URL/DIRECT_URL로 full148files/1667tests PASS(actualexit0), lint/tsc(--incremental false)/Prisma validate/diff 모두exit0. 전체 Next dev process0 확인 후 finalbuild는 route/optimization/trace까지 actualexit0이었다. 최종 GUIDANCE fixture 수정 후 lint/tsc(--incremental false)와 build를 다시 실행했고 모두exit0이다. Next dev0 확인 후 route/trace까지 FINAL_BUILD_EXIT=0, FINAL_PG_HASH_MATCH=True로2CD2C20B7444A686A3FDE040525A572226A6D65D4AE874BBB41C0036C1105B1B 동결을 확인했다. Unit source/core/schema는 바뀌지 않아1667PASS를 유지하고 불필요하게 재실행하지 않았다.
- 새 worktree의 승인된18키 .env.local이 존재해 Next build가 파일을 인식했지만, DB URL은 명시적dummy override였다. 원본 프로젝트 env/Production 값을 읽거나 이 gate에서 Preview/Production DB를 조회하지 않았다. 실제 nativePG9/9와 Preview/browser 결과는 별개이며, Preview E2E는 아직 NOT RUN이다. 소스를 동결하고 독립 QA/Review에 인계한다. 이후 Preview exact-head 검증 후 QA/Review를 다시 확인한다.
- exact GitSource SHA/READY를 갖춘 Preview9E2E, 기존 Mock/Phase20 regression 및 검증 snapshot/최종 feature commit/push/stacked Draft PR은 root가 승인 workflow에 따라 진행한다. Preview E2E를 아직 PASS로 보고하지 않는다.
- 원래 dirty/protected 파일·Mock26·Phase20·적용 migration bytes 보존. 실제 Kakao/OpenAI/고객 상담, Production/merge/운영cron/PC 종료는 계속 금지. LAST_RUN_REPORT는 root 소유다.
## Latest Preview maintenance checkpoint — 2026-10-16

- 최신 사용자는 yaho-preview 기존 모든 업무 데이터의 영구 DELETE를 승인했고, 백업·복원·합성출처 증명을 선행조건에서 제외했다. 이 승인은 아래 과거 backup/provenance STOP을 현재 진행 차단조건으로 사용하지 않도록 supersede한다. 과거 audit UNKNOWN_STOP 결과 자체를 취소하거나 실제 고객이었다고 단정하지 않는다.
- 이 예외는 사용자 승인 일회 수동 Preview 정리에 한정된다. 기존 E2E run-owned cleanup 정책/Production 보호/금융원장 append-only 제약을 일반적으로 완화하지 않는다. 스키마 DROP/TRUNCATE/reset/dbpush/trigger 또는 정책 우회는 계속 금지다.
- root의 Preview metadata 및 두 DSN/ref/runtime identity·14개 checksum/exact15th pending preflight PASS를 선행했고, 개발자 실행에서도 같은 source12 whitelist/두 연결/동일 direct transaction identity/history를 재확인했다. Production 연결·환경값 사용은 없었다.
- 고정38개 기존 업무 table(설정, Child/Safety, 일정, 예약/신청/동반/기기/금융, Mock AI 자료·통계, stale lease)을 FK 역순 DELETE했다. 기존 User 전체/ADMIN 인증, _prisma_migrations, schema/system/auth/storage/roles 및 적용 migration 파일은 보존했다. 새 AiService11table은 삭제 당시 아직 미적용이다.
- 한 transaction의 global try-advisory lock 및 User/lease 포함40table ACCESS EXCLUSIVE lock 아래 activelease/User.teacherId 부재, 정확한 relation/FK/trigger/policy inventory, 전후 User/history/catalog digest equality와 잔존0을 검증했다. 원문 데이터와 digest값은 출력하지 않았다.
- 첫 시도는 PREVIEW_DELETE_TABLE_INVENTORY_DENIED(P0001), committed=false, DELETE0/exit1이었다. readonly 진단에서 exact40 setsEqual=true지만 locale 정렬이 달랐고, 양쪽/lock ORDER BY의 COLLATE "C" 명시만 수정했다. 임시 사후검증 identifier parser의 E2e 숫자누락도 실제 실행 전 수정했다. 테이블/삭제범위는 완화하지 않았다.
- root 재검토 후 두 번째 실행 및 fresh connection 사후검증 PASS/actualexit0: committed=true, businessTablesEmpty=true, userAuthenticationPreserved=true, migrations14Verified=true, schemaPreserved=true, freshIdentityVerified=true. 업무 원문/ID/연락처/계좌/secret 출력0, Production0.
- 검토 SQL은 repository 밖 CreatorTemp/yaho-preview-business-delete-review.sql, 최종 SHA256 AE1EE301D21C780456B36685DF638FFF7FB9AFD657FE3F275DB1688C81EA0EF7. 이 일회 관리 SQL/실행기는 product API나 routine cleanup 경로에 추가하지 않았다.
- Preview pending15th 적용과 exact Preview 배포/E2E는 root가 이어서 수행한다. 별도 loopback 폐기 PostgreSQL에서15versioned migrations 재구성은 root 실행으로 PASS했고, 실제 금융 경합 검증은 별도 developer가 진행 중이다. 기존 합성 로컬1667 PASS와 실제 Preview 검증 결과를 구분한다.
- 실제 Kakao/OpenAI API/고객 상담/Production/merge/운영cron/PC 종료 금지는 유지한다. LAST_RUN_REPORT는 root가 관리한다.
## Goal
Next.js Modular Monolith 안에 Provider 교체, 승인된 조회 Tool, 환경별 비용 원장, 암호화·90일 만료·삭제 및 ADMIN 관리 코드를 구현한다. 최초 BUILD 승인은 실제 외부 연결·DB 적용·배포를 제외했다. 아래 최신 continuation 승인 경계가 현재 작업에 적용된다.

## Current State
- 독립 브랜치: feature/phase21-ai-service
- 기반: PR #53 HEAD117151772552b16b6e81e3bbba23bb50e0826f0e.
- PR #53은 Draft 유지. 기존 Mock 구현·migration·실제 Skill/cron 비활성 stub을 변경하지 않는다.
- 이 브랜치는 PR #53에 종속되며 독립 배포할 수 없다.
- Merge 순서: 별도 승인으로 PR #53 ship → 합쳐진 main 검증 → 후속 변경만 main 위로 옮김 → 전체 gate 재검증 → 후속 PR 검토.
- 기존 정책이 squash merge이므로 기존1171517이 main 조상이 된다고 가정하지 않는다. 미공개 로컬 후속 commit만 새 브랜치/cherry-pick 또는 rebase --onto로 옮기고 diff에서 inherited Mock 변경이 제외됐는지 확인한다. force push와 현재 PR 변경은 금지.
- 사용자 승인: Provider/test double/OpenAI adapter 코드·원장·Skill 처리·Tool/응답·ADMIN·암호화/worker·additive migration 파일·합성 unit/local gates·독립 QA/Review.
- 여전히 미승인: API 실호출, 고객·카카오 실식별정보, Production 접속정보 사용·DB 접근·migration·배포, merge·운영 활성화·cron·PC 종료. 비운영 Preview 검증은 아래 조건부 승인 checkpoint를 따른다.

## Historical backup-conditioned continuation checkpoint — 2026-10-16

- 사용자 추가 승인: 승인된 비운영 Preview migration 적용, 합성 PostgreSQL 검증·Preview E2E, 검증 후 기존 feature commit/push 및 stacked Draft PR. PR #53은 Draft/OPEN 유지, 자동 merge 금지.
- 현재 실행 조건: 원본 환경변수의 Preview 출처·두 DSN/ref/runtime identity·기존14개 migration checksum은 root가 read-only로 확인했다. 백업/복구 근거가 아직 미확인이다. root의 backup/preflight PASS 신호 전에는 migration/DB integration/E2E/배포를 실행하지 않는다. 이 개발자 continuation은 로컬 준비만 수행했다.
- 기존 Mock/Phase20, 11-table schema 및 승인 migration bytes를 보존한다. 새 migration/DDL/trigger 비활성화/reset/truncate/financial deletion을 추가하지 않는다.
- 신규 고정 AI_SERVICE focus의 9개 E2E는 Preview HMAC proof, exact Git SHA, run lease, global DB lock, 승인 runtime identity 및 run-owned Mock manifest를 재사용한다. Production에서는 body/DB 생성 전에 거부된다. 실제 service/admin BUILD lock은 유지한다.
- 새 diagnostic HTTP adapter는 고정 scenario만 받는다. 외부 Provider는 0회, 주입 test double만 호출한다. 전체 AiService11tables가 비어 있지 않으면 테스트를 시작하지 않는다.
- 합성 service Program/Class·설정·원장·KeyPin·Reconciliation은 하나의 outer PG transaction에서 생성하고 항상 ROLLBACK한다. 실패 때도 잔존 확인을 수행한다. 영구 금융 rows를 commit/delete하거나 기존 rows를 변경하지 않는다. 별도 기존 Mock fixture의 committed run-owned rows만 기존 manifest cleanup으로 정리한다.
- 실제 PG 독립 backend의 동일 domain advisory lock과 owned Program FOR SHARE/FOR UPDATE timeout/release, unique/check/append-only 실패는 준비된 integration 범위다. 금융 core의 상태전이는 outer rollback 안의 serial savepoints로 실행한다. 따라서 commit-mediated 독립 금융 요청 경합·pool maxWait 증거는 제공하지 못하며 UNVERIFIED로 남긴다. 이 한계를 합성 fake race나 lock 진단으로 대체하지 않는다.
- 제약 검증은 모든 오류를 성공으로 보지 않는다. 설치된 Prisma6 raw P2010의 SQLSTATE와 정확한 trigger/constraint target이 함께 일치할 때만 예상 거부로 인정한다. 일반 도메인 거부는 실제 ServiceDenied만 인정한다. 연결·timeout·다른 제약·알 수 없는 wrapping은 고정 오류로 검증 실패하며 raw diagnostics는 출력하지 않는다. 실제 PG wrapping 계약은 백업 이후에 검증한다.
- diagnostic25초/PG transaction20초는 검증 전용이다. 실제 Skill4초 목표와 실제 Provider 지연 검증을 의미하지 않는다.
- source .env.local은 12개 Preview runner 변수와 기존6개 Mock 변수만 strict parsing한다. 다른 env파일·interpolation·중복·placeholder는 허용하지 않는다. process.env 전체에 주입하지 않으며 자식 Playwright/Prisma/Vercel은 OS 실행 whitelist만 추가한다. Production/provider credentials와 NODE_OPTIONS를 전달하지 않는다. 기존 local Playwright loader는 유지한다.
- 실제 Preview deployment는 GitSource SHA/target/READY와 local committed exact SHA를 재확인해야 한다. 파일 deployment의 표시용 metadata만으로 증명하지 않는다. root가 검증용 snapshot과 최종 feature commit/push 순서를 관리한다.

### Historical command prerequisites (superseded by latest Preview maintenance approval)

Root가 승인된 source만 provision하고 다음 값만 지정한다(값/secret 출력 금지): PHASE21_ENV_SOURCE_DIR, PHASE21_APPROVED_PREVIEW_PROJECT_REF, PHASE21_DENIED_PRODUCTION_PROJECT_REF, PHASE21_PREVIEW_MIGRATION_APPROVED=1, PREVIEW_MIGRATION_SCOPE=AI_SERVICE, AI_SERVICE_PREVIEW_MIGRATION_APPROVED=1.

1. `npx tsx scripts/e2e/preview-migration.ts preflight`
2. `npx tsx scripts/e2e/preview-migration.ts deploy`
3. `npx tsx scripts/e2e/preview-migration.ts verify`
4. Preview GitSource/READY + exact SHA +15개 migration 확인 후 `$env:PREVIEW_E2E_FOCUS='AI_SERVICE'; npm run test:e2e:preview` (고정9개).
5. `$env:PREVIEW_E2E_FOCUS='PHASE21'; npm run test:e2e:preview` 및 focus를 제거한 기본 Phase20 regression. 승인된 runner 이외 직접 Preview Playwright 실행 금지.

현재 위 DB/Preview 명령은 모두 NOT RUN이다. actual 금융 commit 경합, 실제 Provider/Kakao/고객·운영 승인, retention scheduler/삭제 지연·backup 정책 및 Production 승인은 별도로 남는다.
## Data Model
별도 AiServiceConfig, ProgramPublication, ClassPublication, KnowledgeEntry, Request, BudgetMonth, QuotaBucket, DailyMetric, RetentionJob, KeyPin, Reconciliation — 총11개. 기존 Mock의 run scope와 SYNTHETIC 제약은 유지한다. 새 publication만 Program/ClassSchedule을 참조하고 Child/Reservation/Payment/Refund 관계는 없다. 비용은 기존 Revenue와 별개다.
신규 additive migration 파일 작성은 완료했다. 최신 사용자 요청은 해당 checksum의 Preview 적용을 승인했지만 백업·복구 확인이 충족되기 전에는 적용하지 않는다. 기존 적용 migration과 신규 승인 SQL을 변경하지 않는다.
DB 제약: 환경별1000/7000 hardcap, 정수/비음수, 상태·TTL·암호문 쌍·FK·unique·불변 생성/만료시각/단가 snapshot·단조증가 사용액/보정액·RLS/revoke.
서버 규칙: ADMIN·공개 승인·본문/도구 검증·인증·원자적 비용 확보/정산·만료 조회 차단.

## API
- 신규 /api/ai-service/v1/skill 및 /retention은 이 BUILD에서 항상503/no-store이다. 환경변수·합성 플래그·NODE_ENV만으로 열 수 없다. 본문/DB/Provider 전에 차단한다.
- 내부 DI 처리 코드는 인증 → body 검증 → 요청hash/subjecthash → 비용예약 → 암호화 → 승인 catalog → Provider1회 → allowlistTool → 새 공개상태 확인 → 서버답변 → 비용정산 순서다.
- Kakao 헤더 secret+허용bot,16KB payload,1000자 발화. callback초기미지원. 안정된 카카오 요청ID/재전송계약 검증은 활성화 gate다.
- Provider 계약: 단일 structured tool call 또는 handoff, normalized usage. OpenAI Responses body store:false/background:false/parallel:false/max_output256, 승인된4custom function만. SDK/기본fetch/credential wiring/재시도 없음. 주입transport로만 unit검증. 최초평가gpt-6-luna, 실제계정품질/지연 미확인.
- 고정4Tool: list_public_programs, list_public_classes, get_class_availability, get_approved_guidance. 서버만 DB에 접근한다. 모델과고객에는capacity/count/remaining 전달금지.
- 환경별advisorytransaction lock으로 모든쓰기 직렬화, 짧은DBtimeout, 외부호출 중DBtransaction 유지금지. 동일request는month/provider와독립; 같은key다른body거부, 처리중/완료재전송은새호출없음. attempt fence와latecompletion거부.
- 전체4초목표. 서버는3초작업deadline과정산/안내여유를유지하며 각단계timeout으로중단한다. Callback실권한/TTL/영속전송/SSRF설계검토전비활성.

## Budget
- 실제청구목표10000KRW(절대초과방지보장아님). 호출승인총8000, Preview1000/Production7000;2000여유.
- 분리DB 각각hardcap; 통합DB원장/Production조회전제없음. 같은환경의모든Provider/모델은같은월bucket사용.
- KST월경계. 과거월행·미확정비용보존. 미확정/이전월예약존재시현재월/Provider변경도신규호출차단.
- integernanoUSD/token×tokens(입력은최대cache-write단가1.25배)×milliKRW/USD×1.10환율×1.10세금×1.05수수료, 원단위올림.
- ADMIN확인환율/출처/시간,72시간유효. 입력6000/출력256최대예산예약. API bodyUTF8byte상한으로입력상한보수검증. cache할인기대없음.
- 호출전unused확실한예약만반환. dispatch후timeout/usage누락은hold와UNKNOWNcircuit. 유효usage가있으면잘못된Tool/거부응답에도과금정산한다.
- 실제사용료가예약보다커도누락없이정산하고다음호출차단한다.
- ADMIN외부invoice증빙ID/금액/버전기록,확정used/correction/billed감소불가. 원문90일삭제로미확정월aggregate지우지않음. 실제Provider청구/세금/카드/충전조건은운영승인전확인.

## Privacy / Retention
암호화AES256GCM와별도HMACkeyring/version,환경·행·생성/만료시각AAD. 원문token/식별정보로그금지.
정확히90일경과시DB조회조건과복호화전후확인으로즉시거부한다.
**초기worker는하루1회기본안**. 현재scheduler는연결/활성화하지않는다. 제한batch,실패시최대3회재시도상태·고정errorcode·ADMIN재시도/만료backlog관리.
물리삭제지연허용치·실스케줄러·백업삭제/복구정책은운영전별도검토/승인. 1분실행/5분삭제SLA/5분workerfreshness차단은적용하지않는다.
만료request/hash/subject/raw삭제,비식별day/category집계와비용월aggregate보존. UNKNOWN의금전의무는개인정보행수명과독립이다.
법적검토문서미확보이므로카카오식별정보/실상담외부전송금지,합성데이터만사용한다.

## UI
독립ADMIN관리화면 /ai-service, server action마다ADMINactive권한/입력/버전검증. 설정·공개·공식원문·비용/청구·유효원문·삭제상태/재시도,loading/empty/error. 현재context는DB/Auth전에failclosed.
비밀값은env전용. 실제운영enable버튼없음. 공개화면/Phase20화면변경없음.

## Tests
요건–테스트상세대응은 AI_SERVICE_TEST_TRACE.md. 새unit은합성데이터·주입transport·Prisma repository double만사용한다. fake직렬화경합은PG실제증거로표시하지않는다.
후속승인후PG:동시claim/마지막예산/settle/reconcile/publication/expiry-delete/rate/locktimeout/rollback; Preview runnerguard/runownership/cleanup준수. 유료원장은fixturecleanup으로소거하지않는다.

## Acceptance Criteria
ACLIVE-01~20 및기존AC21/Phase20회귀보존. tests/lint/typecheck/Prisma validate/build/diff와독립QA/Review를보고한다.
실제API/운영게이트는NOT RUN으로보고한다. 현재 승인된 Preview15적용/nativePG9PASS는 상단의 실제 증거를 따른다. Preview E2E는 실행 승인과 별개로 아직NOT RUN이며 PASS로간주하지않는다.

## Risks
실제카카오ID계약/권한·Provider가격/usage/한국어품질/4초성능·FX청구차이·실제삭제/백업운영은미검증. 배포와DB/실연동은금지상태다.

## Implementation Order
1. 사용자수정조건기록과분리브랜치
2. Provider/cost/guard및합성unit
3. 독립schema·migration FILE·원자ledger/reconcile/quota
4. Skillcore·Tool/응답·crypto/worker
5. ADMIN UI/actions·trace와회귀
6. localgates·독립QA·Review수정반복
7. 결과보고후다음승인대기(DB/Preview/실호출/Production각별도)

### BUILD technical safeguards
AI설정은paused기본true이고실제route는그설정과무관하게불변BUILD lock으로차단된다. HMAC버전은config에누적pin하여키삭제로중복/quota식별을초기화할수없으며키퇴역은별도운영검토가필요하다. OpenAI HTTP요청생성코드는고정ResponsesURL·주입fetch만사용하고기본globalfetch/envcredential연결은없다. migration파일은BEGIN/COMMIT·로컬DDLtimeout으로원자적실행을설계했으나실DB검증은NOT RUN이다.


## Independent QA correction (3 MAJOR, 2026-10-15)
첫QA는테스트1257개PASS와별개로좌석수문구누출·증빙재사용·동일버전HMAC키교체를확인했다. 수정사항:
- public-text 단일검증: NFKC/zero-width정규화,한·영인원/좌석주제및숫자+인/명/자리/좌석/석차단. ADMIN승인·조회projection·최종groundedreply모두적용하며정상날짜/시간/장소숫자는유지한다.
- AiServiceKeyPin: 환경/버전별도메인분리HMAC fingerprint를영구pin. 동일이름다른키·삭제된키는recovery/identitywrite전거부. 새버전은기존키유지시추가가능. pin은원문삭제대상이아니고DB UPDATE/DELETE금지다.
- AiServiceReconciliation: 환경/reference영구unique·payloaddigest·금액·ADMIN·원래budgetversion·coverage generation기록. 동일payload재전송은REPLAY/no-op,변경payload거부. 과거증빙은새UNKNOWN을해제하지않는다.
- dispatchGeneration은서버transaction의월별단조증가카운터이며같은밀리초의요청도구분한다. 전체hold해제에는현재generation까지외부증빙실확인·명시금액·고유reference가필요하며미래/이전cutoff는거부한다. 개인정보행삭제후에도counter/hold/evidence는유지된다.
- 실제외부청구내용은ADMIN이확인한다. 체크값만으로새liability를승인하지않고immutable identity·coverage·version·명시금액을함께검증한다. 자동청구조회는구현/실행하지않는다.

## Review1 correction / BUILD3 (2026-10-16)
QA1 3MAJOR → BUILD2 → QA2 PASS → Review1 2MAJOR → BUILD3 수정 → QA3/Review2 대기 이력을 유지한다.
- 공개 free text의 숫자는 기본 거부한다. 날짜/시간은 달력·범위까지 검증한 **전체 일정 안내 문법**만 허용한다. 위치 숫자는 명시적 LOCATION 필드의 출구/층/도로명 문법만 허용하며 일반 free text로 재사용할 수 없다. 숫자 앞뒤에 예약/참가 문맥을 감싼 문자열은 날짜 모양이어도 거부한다. 승인/write/read/catalog/grounding에 동일 경계를 적용한다.
- 신규 AiServiceRequest.billingUsage는 input/output/cache-read/cache-write/reasoning/total의 **숫자만** 보관한다. 사용자 문구·식별값·Provider 원문은 포함하지 않는다. 테이블은11개 그대로이며 nullable JSON 필드만 이번 미적용 migration에 추가한다.
- 등록된 OPENAI/TEST_DOUBLE 경량 평가 모델 계약만 admission 허용한다. 요청 service_tier는default 고정이다. 단가 snapshot에 billingContract 및 입력 단가5/4를 불변 저장하며 예약과 정산 모두 모든 입력에1.25배 상한을 적용한다. 캐시 읽기 할인은 기대하지 않는다.
- 응답 usage/details는strict 검증한다. cache-read+write≤input, reasoning≤output, total 일치, 정수/비음수 규칙과 미등록 추가 과금 항목/서비스 tier를 검증한다. core usage 누락·불명확 billing 정보는 UNKNOWN hold/circuit이고 자동 반환하지 않는다. 할인 상세가 없더라도 입력 최대 단가를 동일하게 적용한다.
- 이1.25배 계약은 OpenAI 공식 prompt-caching 문서(https://developers.openai.com/api/docs/guides/prompt-caching)를 읽어 기술적으로 반영했다. 실제 계정 과금 계약·성능 검증이나 API 사용 승인은 아니다. 실제 연결 전 가격·usage·서비스 tier 계약을 재확인한다.

## Model and price boundary
최초 gpt-6-luna와입력0.10USD/출력0.50USD per1M은현재공식문서를읽어확인한평가후보/예시일뿐실계정접근·사용량과금계약·한국어품질·지연평가를뜻하지않는다. 공식자료: https://developers.openai.com/api/docs/models/gpt-6-luna 및 https://developers.openai.com/api/docs/pricing . 실제계정단가/usage계약확인과실호출승인전모든운영ingress는불변BUILD lock으로닫혀있다. 단가/설정누락·비양수·FX만료는admission거부,dispatch후usage미확정은hold/circuit을유지한다. unit은명시적인합성가격·usage fixture만사용한다.

## QA3 correction / BUILD4 (2026-10-16)
QA3는 focused187tests PASS와 별개로 Roman numeralⅧ/ⅷ가 NFKC 후VIII/viii가 되면서 Unicode Number 분류가 사라져 승인된 안내를 통과하는1MAJOR를 재현했다. BUILD4는 정규화 전에 원본 Number 코드포인트를 검사하고, NFKC가 해당 숫자 분류를 소실시키면 거부한다. numeric provenance를 최종 문법 검사까지 유지하며, 참가/예약 등 private count 문맥은 ASCII Roman·한글 수사를 포함해 숫자 표기와 무관하게 거부한다. 정상 decimal 날짜/시간 및 typed LOCATION 문법, 서버 availability 안내는 유지한다. 스키마/migration/비용 계약은 변경하지 않는다. 최종 독립 검증 순서는 QA4→Review2이다.

## Review2 correction / BUILD5 (2026-10-16)
QA4 PASS 이후 Review2는「여덟 개의 자리가 있습니다.」「최대 수용량은 여덟입니다.」「현재 참가한 가족은 여덟입니다.」가 실제 승인→Tool→응답을 통과하는1MAJOR를 확인했다. BUILD5는 기존 numeric provenance/검증된 날짜시간/typed LOCATION을 유지하며 다음 제한된 원칙을 공통 경계에 추가한다.
- 명백한 다중음절 한국어 수사와 독립적인 영어 number word는 free text에서 인접 단위·수량 문맥과 무관하게 거부한다. 정규화는 NFKC/Cf 제거/구분자 축약을 공통 적용하며 글자 사이 공백·기호 변형도 검사한다.
- 수용량·모집규모·실제 참가/신청 집단 등 private 수량 개념은 수사 표기·조사·단위와 무관하게 거부한다. 짧은 한/두/세/열 등은 단독 음절로 차단하지 않고 명확한 수량 단위 결합에서만 검사한다. 한낮/두꺼운/세심한/열 안내 같은 정상 문장은 유지한다.
- 이 검사는 유한한 문법·정규화·lexical 경계이며 **모든 자연어의 의미적 비공개를 자동으로 증명하지 않는다**. 미확보인 공식 운영 안내 원문을 실제 운영 전에 확보하고, 수량·개인정보·불필요한 공개 정보가 없는지 수동 검토한 뒤 ADMIN 승인하는 기존 gate를 유지한다. 자동 검사 통과는 실제 원문 승인이나 운영 활성화 승인이 아니다.
- 기존 Tool은 숫자 없는 상태만 노출하고 최종 답변은 서버가 구성한다. 모든 실제 ingress는 여전히 비활성이다. 스키마/migration/비용 계약은 변경하지 않는다. 다음 독립 검증은 QA5→Review3이다.

## Review3 correction / BUILD6 (2026-10-16)
QA5는 독립 focused228tests와 추가 negative/positive·Program 경계 검증에서 PASS했으나, Review3는「쉰 개의 자리가 있습니다.」「두 곳의 자리가 있습니다.」「둘만 신청 가능합니다.」를 실제 승인→조회→응답에서 재현하여1MAJOR로 판정했다. 이 알려진 누출을 자동검사의 한계라는 설명으로 남겨두지 않고 다음 공통 문법으로 수정한다.
- public-numerals.ts는 기본 기수 하나/둘/셋/넷/다섯/여섯/일곱/여덟/아홉, 열/스물/서른/마흔/쉰/예순/일흔/여든/아흔에서 **고유 수사1~99 전체**를 생성한다. 한/두/세/네 관형사형과 스무 및 합성수 표기를 같은 문법으로 처리한다.
- 완성된 수사 토큰·조사 결합·단위(개/곳/명/자리/좌석/가족/팀 등)·조사 뒤 단위·글자 사이 공백과 공백 없는 조사→신청 절을 공통 검사한다. 단위가 없는 명백한 기수도 거부한다. 중의적 단음절은 명확한 토큰/수량/신청 문맥에 묶어서 처리하며 한낮/두꺼운/세심한/열 건강 안내를 보존한다.
- 한자계 한글 수사1~99와 백/천/만/억/조도 단위·명확한 토큰/수량 문맥에서 검사한다. 일반 이곳/일/만 표현을 음절만으로 금지하지 않으며 이곳·일자리의 일반 단어 해석을 구분한다. 기존 영어/Unicode/decimal/date/time/typed LOCATION/availability 경계는 유지한다.
- 독립 기대표 기반 1~99 기수/관형사/합성/조사/분리 단위/공백 및 Sino 계열 검증219cases를 추가했다. 알려진 세 반례와 Program-name 승인/read/modelcatalog/finalreply를 각각 차단한다. 스키마/migration/과금·key/evidence 정책은 변경하지 않는다.
- 완결 범위는 위에 명시한 수사와 수량 문법이다. 모든 언어의 의미적 비공개를 자동 증명하는 시스템은 아니며, 미확보 공식 원문을 확보·수동 검토·ADMIN 승인하고 실제 운영을 별도 승인하는 gate는 유지한다. 다음 독립 검증은 QA6→Review4이다.

## Review4 correction / BUILD7 continuation (2026-10-16)
QA6 PASS 이후 Review4는「현재 자리는 삼입니다.」「현재 자리는 십입니다.」「현재 자리는 백입니다.」가 승인→Tool→reply를 통과하는1MAJOR를 확인했다. 최초 BUILD7 변경 명령은 사용한도 때문에 자동 승인 검토가 완료되지 않아 **실행되지 않았다**. 재개 시 파일을 다시 확인한 뒤 BUILD6 상태에서 남은 수정만 적용했다.
- 인식된 고유/한자계 수사와 명확한 서술격 조사(입니다/이다/이에요/예요/임/이고/이며 등)의 결합은 숫자 서술문으로 공통 거부한다. 짧은 Sino 음절이 일반 문장에서 중의적이라는 이유로 명백한 수량 서술을 허용하지 않는다. 단독 이/일/만 음절을 모든 정상 문장에서 금지하지 않는다.
- raw 공개 원문에서는 정원/좌석/잔여석/수용량/자리 개념을 수사·숫자·서술어와 독립적으로 먼저 거부한다. 자리의 일반 복합어 일자리는 구분한다. 이 보수적인 projection은 다양한 좌석 수량 서술어를 계속 열거하는 설계보다 우선한다. 실제 가능 여부는 typed AVAILABLE/UNAVAILABLE/UNKNOWN만 서버가 구성한다.
- Sino1~99 및 백/천/만/억/조 각각의7서술형을 독립 표로 검증한다. 세 exact guidance/Program approval/read/modelcatalog/finalreply 반례, 숫자 없는 raw capacity·다른 수사 표기, generic 예약 절차·일자리/이곳/일/만과 검증된 날짜시간/LOCATION을 회귀 확인한다.
- 신규 schema/migration/과금/key/evidence 변경은 없다. 실제 DB/API/Preview/Production 및 PC 종료는 금지 상태다. 다음 독립 검증은 QA7→Review5이며 자동 검사의 제한된 언어 범위 및 공식 원문 수동 승인/운영 전환 gate는 유지한다.

## Final independent verification — 2026-10-16

QA7 PASS and Review5 PASS for the approved synthetic local BUILD scope, each Critical0/Major0/Minor0. Full147files/1611tests and focused11files/460tests, lint/typecheck/Prisma validate/final build actualexit0. Detailed independent actual counterexamples and all earlier failures: AI_SERVICE_QA_REVIEW.md. Earlier next/pending statements in checkpoint sections above are historical.

Actual DB/migration/PostgreSQL semantics, Preview/browser E2E, real Kakao/OpenAI/customer data, operational deletion/backups/privacy and Production remain NOT RUN and require separate approval. Original Mock/Phase20 and protected files remain preserved. No Git publication or PC shutdown.
