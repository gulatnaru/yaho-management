# Phase21 follow-up — independent QA and Review
## Latest independent snapshot verdicts — 2026-10-16

QA PASS and Review PASS, each Critical0/Major0/Minor0, before Preview execution. QA directly executed95focused tests(exit0); Review directly executed AST/hash and in-memory ingress checks(exit0, Productionbody0/client0, ingress503/no-store, ADMIN denied). Full1667/localgates/nativePG9 are reused BUILD evidence. Initial QA sandbox spawn EPERM and reviewer-only GUIDANCE literal-count expectation error remain failure histories; subsequent actual checks passed. Final source hash and migration hashes match. Actual Preview9/Mock3/regression29/HTTP/pooler/error wrapping/mobile remain NOT RUN and require a final verdict after execution.

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
Date: 2026-10-16 (Asia/Seoul). Branch: feature/phase21-ai-service.
Scope: approved synthetic local BUILD only. No files were edited by the independent QA/Review roles.

## Historical BUILD7 verdicts

- QA7: PASS, Critical0/Major0/Minor0.
- Review5: PASS, Critical0/Major0/Minor0.
- Final BUILD7: full147files/1611tests; focused11files/460tests; lint/typecheck/Prisma validate/diff and final production build all actual exit0.
- Build was completed after NEXT_DEV_PROCESS_COUNT=0, with dummy loopback DB URLs and no copied original env files.
- PostgreSQL/Preview/real-provider/operational validation is NOT RUN and is not covered by these verdicts.

## Independent actual evidence

| Role | Actual execution | Result |
|---|---|---|
| QA7 | Vitest focused11files/460tests | PASS, exit0 |
| QA7 | Exact Review4 guidance and Program approval/read/catalog/reply | All3 count statements denied; model transport0 |
| QA7 | Number-free capacity phrases6; Sino/copula combinations49 | Denied |
| QA7 | Normal notices11; LOCATION2; availability3 | Preserved |
| Review5 | Real modules in memory with repository double | PASS, exit0 |
| Review5 | Previous counterexamples9 across guidance/Program boundaries | Denied; model transport0 |
| Review5 | Number-free capacity phrases6; Sino/copula combinations728 | Denied |
| Review5 | Unicode Number provenance-loss codepoints59 | Denied |
| Review5 | Normal notices11; LOCATION2; availability3 | Preserved |
| Review5 | Public Route3 / ADMIN Context | 503/no-store / access denied |
| QA7 and Review5 | New/applied Mock migration hashes | Match |

Independent roles used existing BUILD evidence for the full1611tests/lint/typecheck/Prisma/build rather than rerunning redundant full gates. Actual focused executions and separate counterexamples above are distinguished from that reported BUILD evidence. Repository doubles do not prove PostgreSQL locking/constraints/rollback.

## Preserved failure and correction history

| Checkpoint | Verdict and evidence | Correction |
|---|---|---|
| BUILD1 / QA1 | Full1257/focused106 PASS, then independent CHANGES_REQUIRED3MAJOR | Public count wording; reused invoice released later UNKNOWN; replaced HMAC material reset identity |
| BUILD2 / QA2 | Full1293; QA2 actual focused142 and counterexamples PASS | Central public guard; immutable invoice generation/evidence; permanent material pins |
| Review1 | CHANGES_REQUIRED2MAJOR | Alternate numeric text; omitted cache-write cost |
| BUILD3 / QA3 | Full1338/focused187 PASS; independent Unicode negative assertion exit1, CHANGES_REQUIRED1MAJOR | Roman Number_Letter became ASCII letters under NFKC |
| BUILD4 / QA4 | Full1349; independent focused198/Unicode counterexamples PASS | Preserve original numeric classification |
| Review2 | CHANGES_REQUIRED1MAJOR | Korean number words with indirect units leaked |
| BUILD5 / QA5 | Full1379; independent focused228 and actual negative/positive flows PASS | Numeral words and private occupancy contexts |
| Review3 | CHANGES_REQUIRED1MAJOR | Missing native cardinal/adnominal/particle forms: 쉰, 두 곳의, 둘만 |
| BUILD6 / QA6 | Full1598; independent focused447 and exact flow checks PASS | Complete bounded native1~99 grammar; contextual Sino forms |
| Review4 | CHANGES_REQUIRED1MAJOR | Short Sino plus copula: 삼입니다, 십입니다, 백입니다 |
| Initial BUILD7 | Usage-limit interruption; mutation command did NOT execute | Re-read actual state on continuation |
| BUILD7 continuation | Full1611/focused460; all final local gates/build actualexit0 | Common copula and raw capacity projection; additional13tests |
| QA7 / Review5 | PASS within approved synthetic local scope | Final independent checks above |

Earlier PASS counts are retained as historical evidence; they did not prove the subsequently discovered counterexamples absent. No failed run was relabeled as PASS.

## Security and cost assessment

- Public raw capacity/seat concepts are rejected before numeric parsing; typed availability is the only reservation-availability result.
- Provider gets four approved read tools and approved public fields. Numeric/date/location grammar, source digest checks, server grounding and unconditional deployed BUILD locks remain.
- Permanent HMAC material pins and immutable invoice evidence/dispatch coverage protect request identity and held costs after raw privacy deletion.
- Admission caps remain Preview1000/Production7000KRW, with actual-billed10000KRW target and approved FX/tax/fee buffers. No absolute actual-billing guarantee.
- Cache-write premium is covered consistently in reservation/settlement by a registered maximum-input contract; unknown usage/tier retains hold. Contract reference: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
- AES-GCM and separate versioned HMAC keys; exact90day query/decrypt cutoff; daily worker code. No actual scheduler or live consultation processing is activated.

## Historical BUILD7 NOT RUN gates (current DB/PG evidence above)

- Any DB connection or migration application; actual PostgreSQL constraints, RLS, locks, races, rollback and timeouts.
- Preview E2E, browser/mobile/RSC runtime workflows. Prior PR53 Mock Preview results are historical and cannot replace these follow-up checks.
- Actual OpenAI/Kakao calls, account pricing/usage/quality/4second latency, channel/request-ID/authentication/Callback rights.
- Actual customer/Kakao identifiers or consultation processing, privacy/foreign-transfer/provider retention/legal approval.
- Daily operational scheduler, allowed physical deletion delay, deletion recovery, backup deletion and restore purge.
- Production access/migration/deployment/activation, PR53 merge or new PR merge.

Automatic text validation has a bounded formal/lexical scope, not a proof of every natural-language meaning. Official operational source text is still missing; obtain it, manually review for PII/counts/unnecessary disclosure, and require ADMIN approval before activation. Conservative false rejections must be assessed against that future official text.

Preview planning must verify approved DB identity and migration state, serialize one E2E per DB, use synthetic run-owned fixtures and clean only that run's rows. Permanent financial aggregates/key pins/evidence must not be deleted or reset to make tests pass; define isolated/rollback fixture handling and preserve existing settings/data before approved DB tests.

## Preserved state

PR53 remains a dependency to ship only under separate approval. Follow-up working changes are uncommitted/unpushed. Original root .gitignore/LAST_RUN_REPORT and existing Mock worktree files remain protected. No shutdown is scheduled; latest user instruction explicitly forbids PC shutdown.

## Historical Preview-preparation independent verification — 2026-10-16

Local scope only: initial independent QA PASS(8files78tests) → Review CHANGES_REQUIRED(Critical0/Major1/Minor0), unrelated DB errors falsely passed three INTEGRITY checks → developer correction(+29regressions; full148files1667PASS; final build actual0) → revised QA interrupted by usage limit(NO PASS) → user continuation → independent QA PASS → independent Review PASS. Earlier failure/interruption history above remains unchanged.

- Final QA:Critical0/Major0/Minor0; actual56unit and separate actual-module runRollbackValidation→runScenario positive expected-error flow plus12generic/timeout/wrong-target/no-exception counterexamples all fail+rollback. Production body0/client0; scoped parameterized owned-pin update; diff and migration checksum PASS.
- Final Review:Critical0/Major0/Minor0; independent expected-error flow and12counterexamples fail+rollback; raw diagnostics0; Production503/body0/client0; fixed synthetic DML targets. No file/env/Git edits, DB connections or network calls by either role.
- Full1667/lint/typecheck/Prisma/build actualexit0 are BUILD evidence reused by independent roles; they did not redundantly execute all gates. Final source is frozen.
- Actual task has only root's separately approved read-only Preview preflight2connections and source/config checks. Backup/recovery remains unverified. Migration/PG integration/actual rollback/constraints/RLS/locks/Preview/browser E2E/deploy/publication NOT RUN; whole requested task remains BLOCKED.
- Actual Prisma6 PG wrapping is unobserved; unsupported errors fail closed. Commit-mediated financial races/pool maxWait UNVERIFIED. No real API/customer/Production/cron/merge/shutdown.
