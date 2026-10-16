# AI service requirement–test trace

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
Historical local-only baseline (before actual15Preview/9nativePG verification above): all tests in this earlier checkpoint use synthetic data, injected transport and repository doubles. Actual PostgreSQL and Preview/browser execution are NOT RUN: latest user authorization is conditional on root backup/preflight PASS.

## Historical local Review correction — 2026-10-16

- Independent Preview-preparation Review: CHANGES_REQUIRED, Critical0/Major1/Minor0. The former denied() accepted any exception; unrelated DB failures could report three constraint checks and rollbackVerified as PASS. This failed review remains part of the history.
- Domain rejection assertions now require actual ServiceDenied with its fixed code/message. Generic Error lookalikes fail. INTEGRITY uses fixed parameterized synthetic raw DML inside serial savepoints, restricted to the new fixture's pin and an invalid new config row; no DDL/delete/migration change.
- Installed Prisma6 raw failures must be actual PrismaClientKnownRequestError P2010 with expected meta.code and exact target-bearing meta.message: P0001/AI_SERVICE_FINANCIAL_APPEND_ONLY,23505/AiServiceKeyPin_environment_version_key,23514/ai_service_config_environment. Unknown metadata/connection/timeout/other constraint/no exception abort validation. Raw diagnostics never leave the error boundary or logs.
- New actual-module-composition regressions exercise runRollbackValidation→runScenario(INTEGRITY), accepting only all three expected structured failures. Each operation rejects generic DB failure, P1001, statement/lock timeout, wrong SQLSTATE, wrong target, missing metadata, plain-object spoof and no exception; failure rollback and no raw logging are checked. A domain fixed-message lookalike is also rejected.
- Focused regression: tests/unit/ai-service/preview-validation.test.ts56tests PASS, exit0 (29new). Final full148files/1667tests PASS, exit0; lint/tsc/Prisma validate/diff exit0. Next dev count0 before final build; final build actualexit0 after static generation, optimization, traces and routes.
- Migration hash remains BACD02B4A1C69E19C891D0C122F08BF9F715B6D0B2E43F5899D92C329FEE1B7F; existing applied Mock26DC71BB2A44BB15F6DD3FD83ACEB3FA109E84D29275BECCC4F82D05F787026C unchanged. No original protected file, Mock/Phase20 source or root-owned LAST_RUN_REPORT edited.
- These are injected structured-error/repository tests, not actual PostgreSQL error wrapping/constraint proof. Unsupported actual wrapping fails closed and requires investigation after backup authorization. Backup remains pending; DB/migration/PG/Preview/browser/Provider/deploy/Git execution0. Financial commit-mediated races remain UNVERIFIED. Independent QA→Review rerun is required before treating this new scope as PASS.
## Initial Preview preparation checkpoint — 2026-10-16 (historical)

이전 QA7/Review5 PASS는 기존 합성 로컬 BUILD7 판정이다. 최신 사용자 승인으로 Preview migration/PG/합성 E2E는 허용됐으나 backup 조건이 아직 충족되지 않아 실제 실행은 0회다. 아래 로컬 준비 변경은 새 독립 QA/Review 대상이며 이전 PASS를 승계하지 않는다.

| Requirement / boundary | Prepared coverage | Actual evidence |
|---|---|---|
| ACLIVE18–20 / Preview-only | Production before-client deny, purpose/body proof, approved ref, lease/global lock/exactSHA, both runtime identities | tests/unit/ai-service/preview-validation.test.ts; unit only |
| ACLIVE02–05/17 | real Prisma core scenario for opt-in/withdrawal/ADMIN role/injection/no-count DTO | tests/e2e/phase21-ai-service.spec.ts PUBLICATION/SECURITY; NOT RUN |
| ACLIVE06–11/13 | synthetic single-call/charge-once/UNKNOWN/evidence replay/key pin within rollback | FLOW/BUDGET/INTEGRITY; NOT RUN; serial savepoints are not financial commit races |
| ACLIVE14–16 | exact90day denial and owned expiry deletion while metric/money/pin retained | RETENTION; NOT RUN |
| PG constraints/locks | independent backend domain advisory + owned-source row lock timeout/release; check/unique/immutable pin rejects | LOCKS/INTEGRITY; NOT RUN |
| Cleanup | refuse nonempty11tables, intentional rollback on success/failure, zero service rows/source residue; existing Mock owned cleanup | local repository doubles PASS; real rollback NOT RUN |
| Environment / migration | strict12+6 whitelist/no interpolation/no process mutation, minimal child env, fixed focus/branch, exact15th hash/defaultMock | preview-validation.test.ts27cases; existing runner/migration regressions |
| Mobile/public HTML | anonymous admin redirect/no raw DTO/no horizontal overflow; actual ingress still503 | fixed E2E9selected; NOT RUN |

Local focused AI+runner:38files/659tests PASS(exit0). Final full:148files/1638tests PASS(exit0). All actual PG/Preview/browser/Provider/Production execution remains NOT RUN; only local tests, lint/typecheck/Prisma validate/build are executed. Commit-mediated financial races remain UNVERIFIED even if the prepared lock diagnostics later pass. Historic failures and independent verdicts below remain preserved.


| Requirement / ADR | Required result | Normal / rejection / race | Level | Test location |
|---|---|---|---|---|
| ACLIVE01/12,ADR062 | Authenticate before persistence/cost | valid header, wrong secret/bot, callback and oversize rejection | unit | tests/unit/ai-service/handler-runtime.test.ts |
| ACLIVE02–05 | Approved facts only, no counts/private DTO | approval, withdrawal, same-timestamp source edits, full/cancelled schedule, malicious guidance, extra DTO | unit | tests/unit/ai-service/privacy-tools.test.ts |
| ACLIVE06 | Replaceable single-call Provider and safe HTTP construction | strict4tools, invalid/multiple/prose calls preserve usage, no retries, abort/fixedURL | unit | tests/unit/ai-service/cost-provider.test.ts; openai-transport.test.ts |
| ACLIVE07/08/10 | Conservative fixed environment caps | KST boundary/FXexpiry/rounding, lastcap race, higher actual cost, invoice consistency | unit | tests/unit/ai-service/cost-provider.test.ts; ledger.test.ts |
| ACLIVE09 | Request and charge idempotency | simultaneous claim/settle, differentbody, HMACrotation, rollback/stale attempt | unit | tests/unit/ai-service/ledger.test.ts |
| ACLIVE11 | Deadline and rate control | slow model abort, uncertain held cost, acceptedquota notrefunded | unit | tests/unit/ai-service/handler-runtime.test.ts; ledger.test.ts |
| ACLIVE13 | Separate versioned crypto keys | normal read, badkey/config, tamper/wrongbinding, rotation | unit | tests/unit/ai-service/privacy-tools.test.ts; keys.test.ts |
| ACLIVE14/15 |90day read cutoff and scoped daily worker | expiry before/after decrypt, retained expired row, envscoped purge, failed retry, monetary hold preserved | unit | tests/unit/ai-service/privacy-tools.test.ts; ledger.test.ts |
| ACLIVE16 | Nonidentifying metrics survive deletion | day/category count preserved, ciphertext doesnot expose utterance | unit | tests/unit/ai-service/privacy-tools.test.ts; handler-runtime.test.ts |
| ACLIVE17 | ADMIN-only settings/actions | MANAGER/TEACHER/anonymous denial beforeDB, versionrace, safe form metadata mapping | unit | tests/unit/ai-service/privacy-tools.test.ts; actions.test.ts |
| ACLIVE18–20 | Isolation and release gates | unconditionallyclosed routes/context, additive RLS/constraints, unchangedMock, inherited regression | unit/static | tests/unit/ai-service/handler-runtime.test.ts; migration.test.ts; complete inherited suite |
| Actual PG semantics | Real advisory/rowlocks, constraints and rollback | competing claims/settle/invoice/publication/purge, timeout/partialfailure | integration NOT RUN | Future approved nonoperational PG suite |
| Admin/mobile/publicRSC and Preview lifecycle | Actual UI/authorization/no leakage/runcleanup | disabled view builds; live synthetic workflow and browser checks pending | E2E NOT RUN | Future approved Preview-safe suite |

BUILD2 focused9files/142tests and full145files/1293tests PASS, exit0. BUILD3 focused10files/187tests and final full146files/1338tests PASS, exit0. Lint/typecheck/Prisma/diff and final production build also exit0. Previous144files/1257PASS missed3independent QA counterexamples; that history is retained. Existing Phase20/Mock tests and code are unchanged. Repository-double races are not reported as PostgreSQL proof.

## Independent QA regression coverage (QA1 → BUILD2 → QA2 PASS)
Tests: tests/unit/ai-service/qa-regressions.test.ts (36syntheticcases).
- ACLIVE02–05: exact모집인원8인누출,한/영별칭·인/명/자리/좌석·full-width/NFKC/zero-width/combiningvariants,정상시간/날짜/장소숫자,승인write와최종projection.
- ACLIVE07–10: A→invoiceA→B→A replay,변경payload거부,A/B/A재사용,같은timestamp의새dispatchgeneration,새증빙coverage,동시정산once,증빙생성실패rollback,90daypurge후hold/counter/evidence.
- ACLIVE09/13: 같은v1이름으로키material교체거부와no-write,기존키를유지한v2정상rotation/dedup/quota,키제거거부,claim실패pinrollback,expiryworker후permanentpins.
- SQLstatic: KeyPin/Reconciliation RLS·unique·append-onlytrigger,dispatch/budget불변제약존재확인. 실제PG의trigger/lock/constraint실행은NOT RUN이다.

## Independent Review regression coverage (Review1 → BUILD3)
History: QA1 CHANGES_REQUIRED3MAJOR → BUILD2 → QA2 PASS → Review1 CHANGES_REQUIRED2MAJOR → BUILD3 → pending QA3/Review2.
Tests: tests/unit/ai-service/review-regressions.test.ts (45synthetic cases).
- ACLIVE02–05: exact「현재 예약된 건은 3건입니다.」「참가 가능 수: 8」, NFKC/zero-width variants and date-shaped count-context rejection, approval/write/read/modelcatalog/finalgrounding. Numeric free text is denied except whole validated schedule notices; typed LOCATION permits bounded physical-location forms. Normal「10월 15일 오전 10시 준비 안내」flows through saveGuidance→createTools→groundedReply unchanged.
- ACLIVE06–11: full/mixed/missing cache details, strict invalid/negative/noninteger/overreported/mismatched/unknown usage rejection; default tier only, numeric usage JSON, maximum input5/4 snapshot applied to reserve and settlement, exact4000cache-write/200output→2KRW, lastcap serialized race, UNKNOWN hold blocks subsequent request.
- Actual PostgreSQL/Provider billing contracts/Preview/browser execution remain NOT RUN. Static migration now includes nullable billingUsage JSON in the same11tables; no existing applied migration change.

## QA3 regression coverage / BUILD4
QA3: CHANGES_REQUIRED, Critical0/Major1/Minor0. Focused10files/187PASS와 별도 Unicode negative assertion 실패 및 실제 승인→Tool→groundedReply 재현을 모두 이력으로 보존한다.
- tests/unit/ai-service/review-regressions.test.ts에11cases 추가(총56): Ⅷ/ⅷ, annotation numerals㆒/㆓, Hangzhou〸/〹, ASCII VIII·한글 여덟의 count 문맥을 승인/write/read/catalog/grounding에서 차단한다.
- Unicode 전체 코드포인트 중 Number→NFKC 비Number 변환을 전수 합성 검사하고, 해당 문자가 typed LOCATION prefix에 숨어도 거부한다.
- 정상 decimal/full-width 날짜시간과 LOCATION, AVAILABLE/UNAVAILABLE/UNKNOWN 안내를 보존한다.
- BUILD4 focused10files/198tests 및 full146files/1349tests PASS, exit0. 실제 PG/Preview/Provider 호출은 NOT RUN. QA4/Review2는 독립 판정 대기다.

## Review2 regression coverage / BUILD5
QA4 PASS 이후 Review2 CHANGES_REQUIRED, Critical0/Major1/Minor0: 자연어 수사와 수용량·실제 참가 가족 문구가 승인 후 공개됐다. 기존 숫자/Unicode 및 비용 계약 독립 검증 PASS 이력은 유지한다.
- tests/unit/ai-service/review-regressions.test.ts에30cases 추가(총86): 세 exact guidance 반례, Program-name 승인/기존 승인 projection/model catalog/final reply, 간격/조사/zero-width/eight/e-i-g-h-t, 인접 단위가 없는 명백한 수사.
- 한낮/두꺼운/세심한/열·일반 영문 안내 정상 보존. 짧은 중의적 한국어 음절을 모두 숫자로 취급하지 않는다. 기존 날짜시간/LOCATION/availability 및 비용 회귀도 전체 재검증했다.
- BUILD5 focused10files/228tests, full146files/1379tests PASS, exit0. 실제 PostgreSQL/Preview/Provider는 NOT RUN. QA5/Review3는 독립 판정 대기다.
- 자동 lexical 검증은 모든 자연어의 의미를 증명하지 못한다. 실제 공식 원문 확보·수동 보안 검토·ADMIN 승인 및 운영 전환 gate를 따로 검증해야 하며, 합성 테스트를 그 증거로 대체하지 않는다.

## Review3 regression coverage / BUILD6
History: QA5 PASS(Critical0/Major0/Minor0; independently focused10files228tests exit0 +8negative/8positive +Program transport0), then Review3 CHANGES_REQUIRED(Critical0/Major1/Minor0) from the separate 쉰/두곳의/둘만 actual-flow counterexamples. QA5 used prior full1379/build results as reported evidence, not its own rerun.
- New tests/unit/ai-service/korean-quantity.test.ts:219synthetic cases. Independent expected tables cover native1~99 cardinal/adnominal/composites,9particles,7units, per-character spacing, particle→separated unit, and no-space particle→admission clause. The expected tables do not import the source grammar.
- Sino1~99 and 백/천/만/억/조 explicit-unit forms; normal 이곳/일/만 and 한낮/두꺼운/세심한/열 health guidance. Exact Review3 guidance and Program approval/read/catalog/finalreply rejection; no-digit private quantity concepts still denied.
- Final BUILD6 focused11files447tests and full147files1598tests PASS, exit0. Existing English/Unicode/billing/key/evidence/Phase20/Mock regressions remain included. Actual PG/Preview/provider/browser execution remains NOT RUN.
- Automated validation has a declared bounded grammar; official source collection/manual security review/ADMIN approval and actual activation are separate requirements. Known Review3 leaks are regression-tested as fixed, not deferred under that limitation. QA6/Review4 independent verdicts remain pending.

## Review4 regression coverage / BUILD7 continuation
QA6 PASS → Review4 CHANGES_REQUIRED(Critical0/Major1/Minor0): current-seat short Sino+copula statements passed the actual approval→Tool→reply boundary. BUILD7 initial mutation was not executed because usage limit interrupted automatic approval review; continuation re-read and preserved existing changes before applying remaining correction.
- tests/unit/ai-service/korean-quantity.test.ts now232cases: prior219 +13new normal/exact-flow/raw-capacity/process cases. Existing Sino99 and5large numeral table cases each assert7copulas without relying on capacity keywords, proving shared numeric declaration handling.
- Exact「현재 자리는 삼/십/백입니다」guidance and Program approval/persisted projection/model catalog/final grounding reject. Raw seat/capacity topics are denied independently of numeric spelling, including no numeral and 三/quotative alternatives.
- Generic reservation steps pass saveGuidance→createTools→groundedReply. Normal 이곳/일/만/일자리, prior native/English/Unicode, validated datetime/LOCATION/availability, money/evidence/key invariants remain in the suite.
- Focused11files460tests and full147files1611tests PASS(exit0). Lint/typecheck/Prisma validate/diff and final build actual exit0 (Next dev count0). DB/PG/Preview/Provider/browser remain NOT RUN. QA7/Review5 require independent verdicts.

## Historical BUILD7 independent verification — 2026-10-16

QA7 PASS and Review5 PASS for the approved synthetic local BUILD scope, each Critical0/Major0/Minor0. Full147files/1611tests and focused11files/460tests, lint/typecheck/Prisma validate/final build actualexit0. Detailed independent actual counterexamples and all earlier failures: AI_SERVICE_QA_REVIEW.md. Earlier next/pending statements in checkpoint sections above are historical.

Actual DB/migration/PostgreSQL semantics, Preview/browser E2E, real Kakao/OpenAI/customer data, operational deletion/backups/privacy and Production remain NOT RUN and require separate approval. Original Mock/Phase20 and protected files remain preserved. No Git publication or PC shutdown.
