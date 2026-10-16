# Phase21 follow-up AI service BUILD report

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
Historical checkpoint (before the latest explicit Preview approval). Date: 2026-10-16 (KST). Status: revised Preview preparation local BUILD/QA/Review PASS; actual DB/Preview/publication BLOCKED by missing backup/recovery evidence. Earlier checkpoints below are historical; latest independent verdicts:AI_SERVICE_QA_REVIEW.md.

## Historical local Review correction — 2026-10-16

- Independent Preview-preparation Review: CHANGES_REQUIRED, Critical0/Major1/Minor0. The former denied() accepted any exception; unrelated DB failures could report three constraint checks and rollbackVerified as PASS. This failed review remains part of the history.
- Domain rejection assertions now require actual ServiceDenied with its fixed code/message. Generic Error lookalikes fail. INTEGRITY uses fixed parameterized synthetic raw DML inside serial savepoints, restricted to the new fixture's pin and an invalid new config row; no DDL/delete/migration change.
- Installed Prisma6 raw failures must be actual PrismaClientKnownRequestError P2010 with expected meta.code and exact target-bearing meta.message: P0001/AI_SERVICE_FINANCIAL_APPEND_ONLY,23505/AiServiceKeyPin_environment_version_key,23514/ai_service_config_environment. Unknown metadata/connection/timeout/other constraint/no exception abort validation. Raw diagnostics never leave the error boundary or logs.
- New actual-module-composition regressions exercise runRollbackValidation→runScenario(INTEGRITY), accepting only all three expected structured failures. Each operation rejects generic DB failure, P1001, statement/lock timeout, wrong SQLSTATE, wrong target, missing metadata, plain-object spoof and no exception; failure rollback and no raw logging are checked. A domain fixed-message lookalike is also rejected.
- Focused regression: tests/unit/ai-service/preview-validation.test.ts56tests PASS, exit0 (29new). Final full148files/1667tests PASS, exit0; lint/tsc/Prisma validate/diff exit0. Next dev count0 before final build; final build actualexit0 after static generation, optimization, traces and routes.
- Migration hash remains BACD02B4A1C69E19C891D0C122F08BF9F715B6D0B2E43F5899D92C329FEE1B7F; existing applied Mock26DC71BB2A44BB15F6DD3FD83ACEB3FA109E84D29275BECCC4F82D05F787026C unchanged. No original protected file, Mock/Phase20 source or root-owned LAST_RUN_REPORT edited.
- These are injected structured-error/repository tests, not actual PostgreSQL error wrapping/constraint proof. Unsupported actual wrapping fails closed and requires investigation after backup authorization. Backup remains pending; DB/migration/PG/Preview/browser/Provider/deploy/Git execution0. Financial commit-mediated races remain UNVERIFIED. Independent QA→Review rerun is required before treating this new scope as PASS.
## Initial continuation — Preview validation preparation (historical checkpoint)

- New server/ai-service/preview/{handler,rollback,scenarios,locks}.ts and app/api/e2e/ai-service-validation/route.ts: fixed7scenario diagnostic endpoint, Preview-before-client guard, existing HMAC purpose/body proof/run lease/global ownership, exact applied migration checksum, both pooled/direct runtime identities, always-rollback fixtures and post-rollback zero-row checks.
- tests/e2e/phase21-ai-service.spec.ts prepares9guarded synthetic tests (live entry point lock, anonymous mobile HTML, seven service scenarios). No actual OpenAI/Kakao call path is wired. Existing live Skill/retention/admin locks remain unchanged.
- Runner/focus/invocation/Playwright config add AI_SERVICE without changing default7sources or PHASE21 selection. scripts/e2e/ai-service-preview-migration-policy.ts permits exactly the existing approved15th checksum after all14prior checksums; old Mock migration policy remains default. Env helper allows exact follow-up feature branch.
- lib/e2e/preview-environment.ts strictly selects12runner+6Mock values from only .env.local; no interpolation/process.env injection. Child environments exclude unrelated Production/provider/Auth credentials and NODE_OPTIONS. No original env file was read/copied during developer local work.
- Existing11table schema/new migration bytes and applied Mock bytes are unchanged. No new DDL, financial delete, trigger bypass, copied schema, external API, DB connection, migration application, Preview E2E, deployment, Git commit/push/PR or shutdown occurred.
- Financial/key/evidence synthetic rows never commit: all scenarios run within outer rollback. Existing run-owned Mock Program/Class fixtures keep existing manifest cleanup. Any nonempty service table prevents validation. The handler returns only fixed checks/synthetic counts, never raw consultation/IDs/keys/capacity.
- LOCKS uses independent PG connections for actual domain advisory and owned-source row lock timeout/release. INTEGRITY prepares immutable-pin update/unique/environment-check failure checks. Both are NOT RUN. Serial savepoint core transitions do not prove commit-mediated independent financial races or pool maxWait; these remain UNVERIFIED. Diagnostic25s/PG20s budgets do not change actual Skill4s contract.

### Actual local gates

- New unit file:27synthetic tests. Focused AI+runner:38files/659tests PASS, exit0.
- Final entire suite:148files/1638tests PASS, exit0 (1151inherited +487new).
- Final `npx tsc --noEmit`: PASS exit0; `npm run lint`: PASS exit0, no warnings.
- `npx prisma validate`: PASS exit0, installed engine/dummy loopback URLs; `git diff --check`: PASS exit0.
- Final `npm run build`: PASS actual exit0, full optimization/static generation/traces/routes finished. NEXT_DEV_PROCESS_COUNT=0 immediately before build. No env files loaded; dummy loopback DATABASE_URL/DIRECT_URL only.
- Preserved migration SHA256: BACD02B4A1C69E19C891D0C122F08BF9F715B6D0B2E43F5899D92C329FEE1B7F. Applied Mock:26DC71BB2A44BB15F6DD3FD83ACEB3FA109E84D29275BECCC4F82D05F787026C.
- Initial preparation gate failures are retained: unused ValidationResult lint warning and implicit-any test parameter; later env-helper type errors from Next ProcessEnv.NODE_ENV augmentation and conditional empty-map inference. Fixed before the final gates; early failed tsc runs are not counted as PASS. Vite CJS/Prisma package config notices remain inherited.
- New local preparation needs independent QA→Review; earlier QA7/Review5 do not approve these additional changes. Root owns LAST_RUN_REPORT. Backup confirmation is pending; DB/PG/Preview/browser/provider execution counts are0. Commands and current approval boundary are in the PLAN.
## Changed

- Worktree: C:/Users/gulat/.codex/worktrees/phase21-ai-service/yaho-management
- Branch: feature/phase21-ai-service; base HEAD: 117151772552b16b6e81e3bbba23bb50e0826f0e (PR53).
- Approved PLAN persisted in AI_CONSULTATION_LIVE_PLAN.md; copied SPEC/REQUIREMENTS/ADR062 reflect current conditional authorization. ADR061 and existing Mock implementation remain unchanged.
- Isolated server/ai-service modules implement Provider contract/test double, injected Responses transport, authenticated Skill core, four read tools, grounded answers, Prisma repository/atomic quota and cost ledger, ADMIN management, encryption/key pins, daily retention and retry.
- Isolated app/(admin)/ai-service pages/actions include settings, publication, approved guidance, invoice reconciliation, consultation viewing, retention status/retry, loading/empty/error states.
- New /api/ai-service/v1/skill and /retention always return503/no-store before body/DB/Provider. ADMIN service context is likewise locked before Auth.js/Prisma. No env flag, synthetic flag or NODE_ENV bypass opens service.
- Program/Class approval binds updatedAt AND allowed-field SHA256 under FOR SHARE; same-millisecond source edits invalidate older approval. Capacity/counts remain internal and only availability state is projected.
- Existing Phase20 logic, Payment/Refund/Revenue and applied Mock migration were not edited. No commit/push/PR/merge occurred. Parent owns new LAST_RUN_REPORT.

## Migration — initial FILE-only checkpoint (historical; current APPLIED_PREVIEW above)

- FILE: prisma/migrations/20261015090000_ai_service_followup/migration.sql
- SHA256: BACD02B4A1C69E19C891D0C122F08BF9F715B6D0B2E43F5899D92C329FEE1B7F
- Eleven isolated AiService tables: Config, ProgramPublication, ClassPublication, KnowledgeEntry, Request, BudgetMonth, QuotaBucket, DailyMetric, RetentionJob, KeyPin, Reconciliation.
- Additive FKs/indexes/unique, hardcaps, state/money/TTL checks, immutable financial/source snapshots, pinned HMAC material, append-only invoice evidence, monotonic dispatch counters, RLS/revoke.
- BUILD3 adds nullable Request.billingUsage JSON for validated numeric usage only, within the same11tables.
- Generated by schema-to-schema diff with dummy loopback URLs; BEGIN/COMMIT and local DDL timeouts. No DB query or migration application.
- Applied: NO. Developer DB connection/migration/integration/E2E: NOT RUN. Preview user authorization is now conditional on backup/preflight PASS, still pending. Production remains forbidden. Root performed separate read-only preflight only.
- Existing Mock migration SHA256: 26DC71BB2A44BB15F6DD3FD83ACEB3FA109E84D29275BECCC4F82D05F787026C, unchanged.

## Security / cost controls

- Actual billed goal10000KRW is not an absolute spending guarantee. Admission caps remain Preview1000/Production7000 in separate DB ledgers, with2000headroom.
- Integer nanoUSD and milliKRW, FX10%/tax10%/fee5%, upward rounding,72hour FX validity. KST months retain old obligations; Provider/model/month changes cannot reset spend/holds.
- Immutable priceSnapshot now includes registered billingContract and maximum input rate5/4. Reserve and settlement both charge every input token at1.25base rate; no cached-read discount is assumed.
- OpenAI request service_tier is fixeddefault. Usage/details are strictly validated: integers/nonnegative, cached+write≤input, reasoning≤output, consistenttotal, no unrecognized billing fields/tier. Known valid usage is settled even for invalid semantic output; dispatched missing/ambiguous usage keeps UNKNOWN hold and blocks admission.
- Numeric billingUsage stores no user text, identifier, Provider response body or secrets. Higher-than-reserved valid cost is settled truthfully and blocks future calls as needed.
- Reference identity, payload digest, explicit amounts, ADMIN/version and monotonic dispatch generation protect reconciliation; exact evidence replay is no-op, altered payload/old coverage denied. Evidence/financial aggregates outlive privacy rows.
- Permanent domain-separated HMAC material fingerprints prevent same-version replacement/removal before recovery or identity writes. Normal new-version rotation retains old keys and dedup/quota.
- Advisory-locked short transactions cover claim/quota/dispatch/settle/reconcile; network requests never run under DB transaction. Recovery commits independently before rejected admission; late results cannot undo UNKNOWN.
- Numeric arbitrary public free text is denied. Only an entire validated schedule-notice grammar is permitted; explicit LOCATION projection permits bounded exit/floor/road forms. Count-context wrapped dates fail. BUILD4 preserves original Unicode Number provenance before NFKC; Roman/annotation transformations losing numeric classification are denied, and private count context is rejected regardless of ASCII Roman/Korean numeral notation. Approval/write/read/catalog/final grounding share the boundary.
- AES256GCM and separate HMAC keyrings, bound AAD, exact90day read cutoff before/after decrypt. Daily worker code scopes expired privacy deletion; metrics/financial evidence/pins remain. No real scheduler is activated.
- ADMIN authorization/version checks, masked fixed errors and no original env reads. Only synthetic local data used.

## BUILD7 baseline tests (historical)

- Final focused:11files /460tests PASS, exit0 (86 earlier Review/QA regressions plus232Korean grammar/boundary cases).
- Final complete suite:147files /1611tests PASS, exit0 (1151inherited +460new).
- Final lint: PASS, exit0, no new warnings. Final typecheck: PASS, exit0.
- Prisma validate: PASS, exit0, dummy loopback URLs only. git diff --check: PASS, exit0.
- Full suite includes the inherited local-origin Playwright guard checks; it does not execute Preview E2E or connect to remote targets.
- Repository doubles prove application transitions, serialization assumptions and rollback behavior; they do NOT prove real PostgreSQL locks/constraints/races.
- Actual PG integration/concurrency, Preview E2E, browser/mobile/RSC runtime checks: NOT RUN / separate approval.
- Existing Prisma package-config and Vite CJS deprecation warnings are inherited tooling notices.
- Requirement–test mapping: AI_SERVICE_TEST_TRACE.md.

## BUILD7 baseline build (historical)

- Final npm run build: PASS, actual exit0 after all static pages, optimization, build traces and full route summary.
- NEXT_DEV_PROCESS_COUNT=0 before build (node/bun process command lines, no port assumption).
- No original env file loaded/copied; DATABASE_URL/DIRECT_URL were dummy loopback values. Build neither applies schema nor deploys.

## Independent QA / Review history

1. BUILD1:144files/1257tests PASS locally.
2. QA1: CHANGES_REQUIRED,3MAJOR — public count phrase leakage; invoice replay released later UNKNOWN; same-version HMAC material reset.
3. BUILD2: fixed all3 with regression tests and immutable key/evidence tables;145files/1293tests PASS.
4. QA2: PASS.
5. Review1: CHANGES_REQUIRED, Critical0/Major2/Minor0 — alternate numeric count text; cache-write premium usage discarded.
6. BUILD3: exact repros and adversarial/normal forms covered; numeric default-deny projection and consistent maximum-input billing contract implemented.146files/1338PASS.
7. QA3: CHANGES_REQUIRED, Critical0/Major1/Minor0. Focused10files/187PASS did not cover the separate failed Unicode assertion: RomanⅧ/ⅷ lost Number classification after NFKC and leaked through actual approved guidance.
8. BUILD4: original numeric provenance checked before normalization, Number→nonNumber compatibility transformations rejected; private count context denied independently of ASCII Roman/Korean number words.11new regressions include the Unicode scalar sweep, normal decimal dates/locations and fixed availability.146files/1349tests PASS.
9. QA4: PASS.
10. Review2: CHANGES_REQUIRED, Critical0/Major1/Minor0. Natural Korean quantity phrases passed actual guidance approval/read/reply, and the Program-name path:「여덟 개의 자리가 있습니다.」「최대 수용량은 여덟입니다.」「현재 참가한 가족은 여덟입니다.」. Previous numeric/Unicode and billing controls independently passed.
11. BUILD5: canonical unambiguous numeral words rejected without requiring adjacent units; normalized private occupancy concepts/actual participant populations rejected regardless of notation. Ambiguous short Korean syllables remain allowed outside clear quantity contexts.30new cases;146files/1379PASS, all local gates/build exit0.
12. QA5: PASS, Critical0/Major0/Minor0. Independently reran focused10files/228tests exit0 plus8negative/8positive and Program transport0. Prior full1379/build were distinguished as reported evidence.
13. Review3: CHANGES_REQUIRED, Critical0/Major1/Minor0. Separate actual-flow counterexamples「쉰 개의 자리가 있습니다.」「두 곳의 자리가 있습니다.」「둘만 신청 가능합니다.」exposed missing native numeral/inflection coverage; previous controls and normal values passed.
14. BUILD6: common native1~99 cardinal/adnominal/composite/particle/unit/spacing grammar, contextual Sino alternatives,219independent-table and actual-boundary regressions.147files/1598tests PASS; all local gates and final build exit0.
15. QA6: PASS.
16. Review4: CHANGES_REQUIRED, Critical0/Major1/Minor0. Actual approved guidance「현재 자리는 삼입니다.」「현재 자리는 십입니다.」「현재 자리는 백입니다.」passed because short Sino+copula was not considered numeric outside the earlier privateContext.
17. Initial BUILD7 mutation did not execute: automatic approval review could not complete due usage limit. On user continuation, file state was re-read and confirmed unchanged from BUILD6 before remaining edits.
18. BUILD7 continuation: shared explicit numeral+copula assertion handling; raw capacity/seat topics rejected independently of number spelling/predicate; Sino99+5large forms each tested with7copulas,13new actual-flow/raw-capacity/process/normal cases.147files/1611tests PASS, all local gates and final build actual exit0.
19. QA7: PASS, Critical0/Major0/Minor0; actual focused460 and separate real-module boundary checks.
20. Review5: PASS, Critical0/Major0/Minor0; actual previous9/rawcapacity6/Sinocopula728/Unicode59 and normal flows checked. Full evidence: AI_SERVICE_QA_REVIEW.md. Actual DB/Preview/provider/operations remain NOT RUN.

## Natural-language validation boundary

- This is a bounded lexical/formal projection guard, not automatic proof of every natural-language meaning. Unambiguous Korean numeral words and bounded English number tokens are rejected independently of units; private occupancy/actual participant population concepts are checked after common normalization.
- Existing validated decimal schedule/location fields and fixed availability replies remain allowed. Short ambiguous 한/두/세/열 syllables are not blanket blocked; normal preparation/health guidance is regression-tested.
- Official operational guidance is still unavailable. Before live use, obtain official source text, manually review it for capacity/counts/PII/unnecessary disclosure, and require ADMIN approval. Passing automated guards does not authorize that text or service activation.
- BUILD6 replaces the incomplete native-word examples with public-numerals.ts: full native1~99 cardinal/adnominal series and composites, suffix particles/copulas, quantity units, split characters and compact particle→admission clauses. Sino1~99/백/천/만/억/조 are checked with explicit units or clear token/private contexts. Ambiguous 이곳/일자리 and short heat/normal-word uses are distinguished.
- Independent expected tables cover every native1~99 number, cardinal/adnominal forms,9particles/7units/spacing plus Sino series and exact Review3 flows. Known leaks are fixed and tested; they are not deferred as a semantic limitation.
- BUILD7 adds common explicit copula assertions for every recognised native/Sino numeral, including short Sino forms, plus raw capacity projection before numeric parsing. 정원/좌석/잔여석/수용량/자리 prose is refused independently of number notation; ordinary 일자리 compound is distinguished. Availability is returned only through its typed server result.
- Sino1~99 and 백/천/만/억/조 each assert7declarative forms against generic non-capacity test text, proving the common copula rule independently of the raw-topic guard. The exact Review4 guidance and Program/catalog/reply boundaries are regression-tested.
- Generic reservation-process guidance, ordinary 이곳/일/만/일자리 and validated date/time/LOCATION/availability remain allowed. Conservative projection may reject other ambiguous 자리 prose; official source review and activation approvals remain required.
- BUILD7 changed isolated public-text/numeral modules, synthetic regressions and documentation only; schema/migration/billing/key/evidence contracts remain unchanged. PC shutdown is explicitly forbidden and was not executed.

## Evaluation / operational gates

- gpt-6-luna, public input0.10USD/output0.50USD per1M and prompt-caching1.25input premium are documentation-based evaluation references, not actual-account billing or quality proof. Official model/pricing/prompt-caching links are in PLAN.
- Actual Provider access, quality, usage/tier/billing contract and4second real latency remain unverified. Unregistered/missing pricing contracts fail admission; uncertain dispatched usage staysheld.
- Actual Kakao stable request ID/retries/authentication/rights and Callback contract remain unverified; Callback disabled.
- Privacy/foreign-transfer/provider retention/backups approval documents remain missing. No live customers, Kakao identifiers or actual consultation were processed/transmitted.
- Daily scheduler, physical deletion lag, backup deletion and restore purge need separate operational approval.
- Nonoperational Preview migration/PG/synthetic E2E are now user-authorized subject to backup/preflight PASS. Backup evidence is pending; no actual run occurred. Rollback-only verification preserves permanent obligations/pins/evidence and all existing data/settings; financial commit-mediated races remain UNVERIFIED.
- PR53 remains Draft and must ship first only under separate approval. After its squash merge, transplant only follow-up changes onto verified main, exclude inherited Mock from diff and rerun gates. No automatic merge/deployment/activation.
