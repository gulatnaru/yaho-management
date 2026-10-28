# Phase21 — Independent QA and Review result

## Current verdict

- Date:2026-10-15 (Asia/Seoul). Branch:feature/phase21-kakao-ai-consultation; existing feature HEAD/index remain at base1fb8c77 and uncommitted. Tested validation-only candidate:1db777a4929f5ac684a54520cfd8fa4cae252b4e.
- Current user authorization: verified separate nonproduction DB migration and synthetic PostgreSQL/Preview verification, then existing feature commit/push/PR. Production DB/access/migration/deployment, real Kakao/OpenAI/customer data and automatic merge remain prohibited.
- Source of Truth, approved SPEC/PLAN, ADR-061 and AC21-01–17 are preserved. No new business/privacy/payment policy was introduced.
- Independent root QA:PASS across AC21-01–17 for approved Mock/nonproduction scope. Sequential independent Review:PASS, final Critical0/Major0/Minor0. This records the independent verdict; BUILD did not self-approve.

## Actual verification

| Check | Actual final result |
|---|---|
|Full local unit suite|136 files / 1,151 PASS, exit0|
|Independent root focused suite|34 files / 261 PASS, actual exit0 (704050)|
|lint / standalone typecheck / Prisma validate / diff check|PASS, actual exit0|
|Production build|PASS actual exit0; session74084/chunkd0733a, compile/static generation completed; port-independent Next dev count0 before build|
|Latest Phase21 Preview|3 selected / 3 PASS / 0 fail, skip or unexecuted; wrapper/child0; cleanup PASS (38511/a7d80c,b39095)|
|Complete existing Preview regression|29 selected / 29 PASS / 0 fail, skip or unexecuted, including PostgreSQL12/12 and core3/3; wrapper/child0; cleanup PASS (90529/b36bf3,e5fb3e)|
|Fixed diagnostic subset|3/3 PASS, cleanup PASS (58501/c84565,dd03f7)|
|Manual synthetic browser artifact proof|2/2 PASS: deliberate test failure and reporter exception both really executed; retained raw artifacts0. Separate manual integration script, not npm test/CI E2E|
|Independent QA / sequential Review|PASS for authorized Mock/nonproduction scope, AC21-01–17; final Critical0/Major0/Minor0 (source reviewfac43c)|
|Secret/file review|79 source files reviewed, no env files/actual secrets (46a7be); placeholder detection literals are not secrets|

## Migration and DB evidence

- Only prisma/migrations/20261014090000_phase21_ai_consultations_mock/migration.sql was applied, only to the independently verified approved Preview DB, using Prisma migrate deploy after both endpoint/runtime/checksum and global-lock guards. Preflight/deploy/verify PASS:14 applied,0 pending/failed.
- Additive migration checksum:26dc71bb2a44bb15f6dd3fd83aceb3fa109e84d29275beccc4f82d05f787026c. Applied migration bytes were not edited. No reset/truncate/db push/seed/manual schema operation or Production access.
- Actual read-only catalog audit:all7 AI tables have RLS enabled; anon/authenticated have no SELECT/INSERT/UPDATE/DELETE grants. No customer rows were queried for this audit.

## Acceptance trace — current evidence

Locations below are relative to the project; U=tests/unit/ai-consultations, P=tests/integration/phase21-postgres.ts through E=tests/e2e/phase21-ai-consultations.spec.ts. PASS always means the approved synthetic Mock scope.

| AC | Evidence and tested invariant | Verdict / limit |
|---|---|---|
|01|U/runtime.test.ts,handler.test.ts; E signed valid request, forged proof/body mismatch refusal without new consultation|PASS; no real Skill authentication claimed|
|02|U/tools.test.ts,handler.test.ts; E approved facts, missing guidance/out-of-scope/injection handoff|PASS; official live guidance unavailable|
|03|U/tools.test.ts,admin.test.ts; E explicit opt-ins, publication revocation/replay and mobile CAS toggles|PASS; existing link settings independent|
|04|U/tools.test.ts,handler.test.ts; E provider/reply allowlist excludes count fields and owned internal IDs|PASS; no capacity/count disclosure|
|05|U/tools.test.ts available/unavailable/unknown/error mapping; E actual DB-backed available result|PASS; no seat guarantee|
|06|U/tools.test.ts,handler.test.ts strict tool/argument allowlist and injection denial; existing financial regression|PASS; no SQL/search/customer/admin/mutation tool|
|07|U/ledger.test.ts,handler.test.ts,runtime.test.ts; P independent-client duplicate/quota/settle/fencing/recovery|PASS; real model cost0, four-second HTTP limits unchanged|
|08|U/admin.test.ts,admin-form.test.ts roles/inactive/foreign ID/stale version/strict form denial; E authenticated ADMIN mobile controls|PASS; MANAGER/TEACHER direct denial covered by server unit tests|
|09|U/crypto.test.ts,retention.test.ts; P actual owned physical expiry deletion and preserved metrics|PASS; live90day scheduler/backups not verified or enabled|
|10|U/retention.test.ts,admin.test.ts failed deletion/expiry reads/retry model; P purge; E retention action|PASS; operational failure monitoring remains live gate|
|11|U/retention.test.ts,ledger.test.ts; P post-purge anonymous aggregate unchanged and recovery counted once|PASS; aggregates contain no subject/plaintext/reconnection key|
|12|U/handler.test.ts,runtime.test.ts deadline/provider/grounding failures; E fixed handoff|PASS; no false human-delivery confirmation|
|13|U/runtime.test.ts,handler.test.ts; E Callback-free synthetic Skill and real Skill/cron503|PASS; actual Kakao/Callback capability remains unverified|
|14|U/runtime.test.ts,admin.test.ts and E forged proof denial; environment/owner guards|PASS; Production/real customer/provider processing blocked|
|15|U/crypto.test.ts,admin.test.ts,ledger.test.ts; E confidential proof/no public count/ID fields; fixed safe reporter and artifact policy|PASS; manual artifact2/2 and source secret scan PASS; legal/live logs not claimed|
|16|Existing1,011 unit tests retained within1,151; unchanged Phase20 domain and complete29/29 Preview regression, PG12/12|PASS; no test assertion/timeout relaxation|
|17|Actual unit/integration/Preview/local build evidence above and independent QA/Review; unexecuted live actions listed explicitly|PASS for current authorized scope; commit/PR/exact-feature-head run still pending|

Additional safety locations:tests/unit/e2e/phase21-cleanup.test.ts (including foreign ClassTeacher refusal), preview-cleanup-phases.test.ts, phase21-invocation.test.ts, phase21-client.test.ts, preview-migration.test.ts, phase21-preview-recover.test.ts, phase21-safe-reporter.test.ts, preview-regression-diagnostics.test.ts and preview-artifact-privacy.test.ts. Actual manual browser artifact proof:tests/integration/preview-artifact-privacy.ts; it is not part of CI automatic E2E.

## Remaining limits and SHIP state

- Approved implementation and nonproduction verification are complete; feature commit/push/PR, PR CI and final exact-feature-head Preview verification are pending SHIP. No commit SHA or PR URL is invented. Validation-only branch commits are not the feature commit.
- No automatic merge, Production schema gate approval/application, Production deployment/release, live cron or service activation is authorized or claimed.
- Real Kakao channel/Skill authentication/Callback capability, official operational guidance, privacy notice/external LLM legal review, real OpenAI access and live retention cadence/backups/monitoring remain separate operational approval gates. Synthetic fake-clock physical deletion does not prove live scheduled retention operations.
- Original C:/projects/yaho-management unstaged .gitignore and LAST_RUN_REPORT.md were not edited/stashed/restored/staged. Environment files/secrets are ignored and excluded from source snapshots. No Windows shutdown is scheduled.

## Historical findings and execution history

Earlier formal findings were repaired before this independent final PASS. The earlier default26/29 failure was not reproduced in fixed diagnostic3/3 or full29/29; cause remains unconfirmed and no Phase20 domain fix is asserted. Earlier local-only PASS/UNAPPLIED/NOT RUN sections below record their own checkpoints and are superseded by the current verdict/evidence above.

# Phase21 — Final local Mock / test-preparation QA and Review

## PostgreSQL harness readiness checkpoint — 2026-10-15
- Latest actual Preview run:2PASS/1FAIL with cleanupPASS. HTTP/privacy and ADMIN mobile publication/guidance/retention PASS, confirming the explicit state wire works in that run. PostgreSQL verification failed behind the ledger's fixed denial; the whole gate remains NOT PASS.
- Candidate warms two independent PG clients before timed concurrent assertions and uses a non-mutating harness-only Prisma Proxy with bounded2s acquisition/8s transaction timeout. The original fixture client is unchanged, so audited cleanup1s/15s budgets, deployed Skill4s caps, SQL locks and all ownership/quota/fencing assertions remain unchanged. Connection/acquisition readiness is a hypothesis until actual rerun.
- Fixed PG stage/observed Prisma code/bounded integration caller line now survive safe reporting; raw diagnostics, SQL, URLs, keys and body data remain unrecorded.
- Current local gates PASS:134 files/1146 tests,lint,typecheck,Prisma validate,diff; full build actual exit0 with Next dev0. New exact-SHA rerun and fresh independent QA/Review remain PENDING. PLAN test filename references corrected to actual handler/tools units and guarded integration entry point; approved design/policies unchanged.

## Explicit ADMIN state wire checkpoint — 2026-10-15
- Latest actual Preview run still2PASS/1FAIL with cleanupPASS:PG physical TTL/concurrency and HTTP passed; ADMIN re-enable left DB enabled=false despite matching DOM version/true submitter value and HTTP200. The action previously coerced an absent enabled field tofalse; submitter omission is a consistent inference, not a proven general React bug.
- Candidate uses explicit hidden enabled/approved fields independent of submitter serialization and strict Zod form parsing. Missing/invalid/duplicate/File booleans and invalid CAS versions fail closed with fixed errors; expectedVersion/auth/runtime limits remain strict. Actual E2E additionally checks FormData without a submitter and one synthetic guidance approval.
- Current local gates PASS:133 files/1143 tests,lint,typecheck,Prisma validate,diff; full production build actual exit0 with Next dev0. New exact-SHA Preview rerun and fresh independent QA/Review remain PENDING. No feature commit or PR yet.
- Independent root read-only approved Preview catalog verification PASS:all7 AI tables found,RLS enabled,no anon or authenticated SELECT/INSERT/UPDATE/DELETE privileges. No customer rows,Production query or DDL.

## ADMIN rework checkpoint — 2026-10-15
- Second actual guarded Preview run:2PASS/1FAIL,cleanupPASS. Actual PostgreSQL concurrency/fencing/physical90day owned-row purge and HTTP/privacy/replay passed. ADMIN mobile second publication toggle failed; the whole suite is NOT PASS. No stale lease required recovery.
- Candidate rework keeps strict expectedVersion CAS and remounts publication/guidance forms by version, refreshes the existing short-lived owned proof per ADMIN mutation, and asserts actual submitted DOM properties against DB state plus HTTP and resulting UI separately. Stale form state is a hypothesis to be verified, not a conclusively identified cause. No Skill four-second or ADMIN timeout/authorization relaxation.
- Additional cleanup review finding closed in code: lock owned ClassSchedule rows FOR UPDATE in ID order, then reject any ClassTeacher dependency before deletion; this blocks concurrent FK KEY SHARE insertion and prevents foreign cascade deletion. Unit denial proves no delete and manifest preservation; no real foreign Teacher/customer fixture was created. Applied migration unchanged.
- Current local gates PASS:132 files/1132 tests,lint,typecheck,Prisma validate,diff; rebuilt production build exit0 with Next dev0. New exact-SHA Preview rerun and fresh independent QA/Review remain PENDING.
- Safe failure diagnostics include only fixed ADMIN operation names and approved relative source/line fields; no body/HTML/header/key/raw error or arbitrary test title.

## Actual Preview failure and scoped recovery — 2026-10-15
- Initial exact-SHA/sin1 Preview run executed3 scenarios:0PASS/3FAIL; it is not counted as successful verification. First ledger claim and cleanup hit Prisma P2010 because queryRaw attempted to deserialize PostgreSQL void from advisory-lock SELECTs. Read-only queryRaw-vs-executeRaw confirmation reproduced the defect without customer access.
- Corrected ledger/cleanup use executeRaw for void lock SELECTs, following existing Prisma convention. Regression fixtures reject queryRaw void. Applied migration bytes are unchanged.
- Exact failed-run scoped recovery passed under approved endpoint/ref/runtime/migration/global-lock guards:AI/program/class residuals0 and exactoldlease released only after all cleanup phases succeeded. No foreign Preview data or Production access.
- New candidate local gates:132 files/1130 tests PASS; lint/typecheck/Prisma/diff PASS; rebuilt production build actual exit0,Next dev0. Actual rerun and fresh independent QA/Review remain PENDING.
- Actual PG harness additionally verifies sequential post-race quota denial and physical owned-run90day expiry deletion with anonymous metrics preserved. Optional WAN budgets do not relax HTTP four-second runtime defaults. Safe reporter persists only allowlisted relative source/line/stage, never raw errors/body/absolute paths.

## Continuation verification checkpoint — 2026-10-15
The user now explicitly authorizes isolated nonproduction migration and synthetic DB/Preview verification. The reviewed Phase21 migration was applied only to the independently confirmed Preview DB: preflight/deploy/verify PASS,14 applied migrations,0 pending. Local suite130 files/1125 tests, lint/typecheck/Prisma validate/diff checks PASS; full build exit0. Three actual guarded Preview scenarios are prepared but not yet executed at this checkpoint. Fresh independent QA/Review after actual verification remains PENDING. Prior PASS findings below apply only to their historical local Mock/preparation scope. Production, real integrations/customer processing and automatic merge remain forbidden.


- Date:2026-10-15. Branch:feature/phase21-kakao-ai-consultation. Base HEAD:1fb8c77; uncommitted isolated feature candidate.
- Approved scope:ADR-061,AC21-01–17,PLAN and four refined boundaries. Synthetic Mock only; optional test-preparation code COMPLETE.
- Final independent root QA: **PASS for authorized local Mock/test-preparation scope**. Independent npm test -- tests/unit/ai-consultations tests/unit/e2e:26 files/229 PASS,actual exit0 (chunk571f5d),without DB/Preview execution. Developer full128 files/1119 tests,lint/typecheck/Prisma/final build evidence accepted.
- Final sequential root Review: **PASS for authorized scope**. Strict cleanup ownership/orphan refusal/metrics retention,selection/config/reporter,all-phase cleanup,same-lock lease release,26m budget and three-subject/baseline preparation reviewed. No unresolved implementation findings.
- One prior rework round closed1 MAJOR +1 MINOR. These verdicts are not actual PostgreSQL/Preview/browser/deployment/release PASS.

## Acceptance evidence

| AC | Actual evidence | Verdict / limit |
|---|---|---|
|01/13/14|runtime.test.ts,handler.test.ts:early Production/ambiguous-env denial,purpose/body/SHA/time signature,lease/runtime/fixed synthetic input;real Kakao route disabled|Local Mock PASS;actual Kakao/auth/Callback/OpenAI NOT RUN|
|02/03/06/12|tools.test.ts,admin.test.ts,handler.test.ts:both opt-ins,default-private filters,independent link settings,strict tools/facts,injection/out-of-scope/missing-guidance handoff,current-fact replay|Local Mock PASS;actual DB/publication races and browser UX NOT RUN|
|04/05|tools.test.ts,handler.test.ts:seat counts/internal IDs absent from provider/DTO/reply,status-only availability,UNKNOWN/errors/current replay|Local Mock PASS;actual DB availability/timing NOT RUN|
|07|ledger.test.ts,handler.test.ts:concurrent request/quota model,retry/body mismatch,rotation,reservations,attempt fencing,timeout/cancellation|Local model PASS;not actual PostgreSQL locking proof|
|08|admin.test.ts:ADMIN-only core/context/actions,inactive/MANAGER/TEACHER/foreign-ID/expired denial,explicit opt-in/stale version checks|Local Mock PASS;browser access E2E NOT RUN|
|09/10/11|crypto.test.ts,retention.test.ts,ledger.test.ts:90d/AAD/key/tamper boundary,own purge/retry/scheduler,anonymous metrics and one-count recovery|Local Mock PASS;physical DB deletion/operational scheduler/backups NOT RUN|
|15|crypto.test.ts,admin.test.ts,ledger.test.ts,handler.test.ts:separate keys,fixed DB/provider/decrypt/validation errors,no raw submitted sentinel in serialized error|Local Mock PASS;external/legal/Production logging verification NOT RUN|
|16|Existing1011 tests retained;Phase20 domain/data behavior unchanged;old default/focus tests pass|Unit regression PASS;Phase20 actual Preview/browser regression NOT RUN|
|17|Full1119,independent229,lint/typecheck/Prisma/final build/diff;runner preparation tests below|Authorized local QA/Review PASS;actual execution/release NOT VERIFIED|

Domain locations:tests/unit/ai-consultations. Authored actual PG candidate:tests/integration/phase21-postgres.ts. Authored Preview candidate:tests/e2e/phase21-ai-consultations.spec.ts and support fixtures/scenarios. Those actual suites were NOT executed.

## Runner/test-preparation evidence
- phase21-cleanup.test.ts:15 exact ownership,foreign/malformed/null-manifest/orphan,rollback/residual and anonymous-metric preservation cases.
- preview-cleanup-phases.test.ts:6 ordered cleanup,all old-phase attempts after failure,no release on failure,global-lock commit rollback and budget invariants.
- phase21-scenarios.test.ts:2 trusted distinct-subject mapping and baseline-global assertions. Last quota uses distinct keys on a fresh owned subject;full manifest unchanged.
- phase21-invocation.test.ts:3 invalid selection/config before client preparation and default-no-AI-key cases.
- phase21-safe-reporter.test.ts:2 optional source/count and metadata non-disclosure cases;preview-focus/counts each add one selection-bound regression.
- PHASE21 optional selection/fixture-wrapper cleanup wiring is COMPLETE. Default7 files/29cases and old focus semantics remain unchanged. Local preparation is not actual execution readiness:changes are uncommitted,migration unapplied and real verification unexecuted.

## Closed findings
- R21-01 MAJOR,AC15:external ADMIN publication/guidance/detail-ID safeParse throws fixed AiDenied;three sentinel cases show no supplied text/raw Zod issues or DB reads on rejection.
- R21-02 MINOR,AC11:stale PROCESSING recovery count commits anonymously once with the fenced terminal state;concurrent/repeated recovery,late settle and later purge preserve one count. Unknown model calls/cost0;dispatched reservations remain conservative.

## Safety and remaining gates
- Production rejection evidence concerns Mock intake/context/actions/domain operations. Normal ADMIN page authentication/account lookup remains before disabled rendering;zero general auth/account reads is not claimed.
- Migration FILE only,UNAPPLIED everywhere. Actual PG semantics/concurrency,Preview E2E,browser/mobile and Production smoke/release:NOT RUN / UNVERIFIED.
- Separate explicit approvals remain necessary for the user-gated actual integrations/customer data,DB/migration application,PG/Preview execution,merge,Production deployment and live activation. Subsequent SHIP awaits required verification; no additional per-commit/push/PR approval gate is introduced.
- Real Kakao/OpenAI/customer data,official guidance/privacy/external-transfer review and operational retention/backups are unapproved/unverified. No env toggle activates them.
- No commit/push/PR/merge/deployment/live service. Original unstaged files preserved.
- **PC shutdown NOT SCHEDULED:** overall approval-gated verification/release remains incomplete.
