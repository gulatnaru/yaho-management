# Phase21 BUILD report — 2026-10-15

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

## Continuation checkpoint — approved nonproduction verification (2026-10-15)
- Latest user authorization permits only independently verified nonproduction DB migration/application, synthetic PostgreSQL/Preview E2E, fresh local gates and independent QA/Review, then existing feature commit and PR. No automatic merge. Production DB/access/migration/deployment, real Kakao/OpenAI/customer data remain forbidden.
- Approved Preview identity and environment provenance rechecked independently; both connection endpoints match the existing approved runtime fingerprint. Original protected worktree/env files preserved.
- Phase21 additive migration applied ONLY to the approved Preview DB via Prisma migrate deploy under the existing global advisory lock. Preflight PASS (exactly Phase21 pending,13 applied); deploy PASS; verify PASS (14 applied,0 pending). No reset/push/seed/manual schema changes.
- Current local full suite PASS:130 files/1125 tests, lint/typecheck PASS, Prisma validate PASS via explicit Next env loader, diff check PASS. Final build actual exit0 (Next dev count0; full compile/static output observed).
- Three guarded actual Preview scenarios prepared: real PostgreSQL invariants; grounded HTTP/privacy/replay/revocation; authenticated ADMIN mobile controls. Actual PostgreSQL/Preview execution remains PENDING at this checkpoint; no new independent QA/Review execution claim yet.
- Separate exact-content validation snapshot is used before committing the existing feature branch, preserving the runner's exact-SHA/clean-migration guard. Snapshot contains no env/secrets/dependencies. Mock keys are separated and reused only across the two approved Preview feature branches.
- Earlier report sections below are historical local-only evidence and prior approval state, not current migration status.


## Current status
- Branch:feature/phase21-kakao-ai-consultation. Base HEAD:1fb8c77. Isolated phase21-kakao-ai-spec/yaho-management worktree; uncommitted candidate.
- Approved local Mock implementation and optional test-preparation code: **COMPLETE**.
- Final independent root QA and sequential Review: **PASS for authorized local Mock/test-preparation scope**. No unresolved implementation findings in this scope.
- Actual PostgreSQL semantics, Preview/browser/mobile, migrations/deployment/release: **NOT RUN / UNVERIFIED**. Preparation completion is not execution/deployment readiness; migration remains unapplied.
- PC shutdown: **NOT SCHEDULED**. Explicit DB/migration/PG/Preview approvals and required actual verification remain incomplete.

## Changed
- Approved PLAN, ADR-061 and AC21-01–17 retained. No new business/privacy/payment policy or Open Question. Existing Phase20 domain behavior/data/policy preserved.
- Mock intake/context/actions/domain processing rejects Production/ambiguous environments before body/keys/domain auth/Prisma. General ADMIN-page authentication/account lookup remains before a disabled banner; zero auth/account reads for all page rendering is not claimed.
- Preview Mock requires purpose/body/SHA/time-bound signature, approved URLs/refs/runtime fingerprint, active generic lease/global lock and run-owned synthetic manifest. Arbitrary real utterances/Callback payloads are refused. No real Kakao/OpenAI provider or customer/reservation/payment/refund tool.
- Separate default-private program/class publication, ADMIN version checks and synthetic approved guidance. Both AI opt-ins are required; existing application-link settings remain independent.
- Four strict allowlisted tools return only approved fixed synthetic facts/run handles and AVAILABLE/UNAVAILABLE/UNKNOWN. Private seat counts and actual IDs never reach model/customer DTOs. Cached replays revalidate current facts without model reprocessing/quota charge.
- Atomic request/body idempotency, sorted quota locks, rotation-safe subject aliases, reserved calls, fenced dispatch/settlement/recovery and conservative unknown usage. Accepted burst counters never refund; actual OpenAI cost0.
- Versioned separate AES256-GCM/HMAC/signing keys; AAD-bound raw storage; immutable created+90d expiry with query/decrypt/return checks and fixed error diagnostics. ADMIN raw validation never exposes supplied text/Zod details.
- Scoped purge/retry/failure status and fake-clock automatic synthetic scheduler. No live cron/global deletion. Anonymous day/category statistics survive purge, including exactly-once stale recovery counts; unknown usage stays0 in statistics and reservations remain conservative.
- ADMIN UI includes publication/guidance/consultation/detail/retention/recovery/statistics with loading/empty/error states. Secrets/proof are never Client props.

## Test preparation
- Optional fixed PHASE21 selection is wired into runner/config/safe reporter/counts; arbitrary focus fails before client preparation. Default7-file/29-case selection and all old focus semantics stay unchanged; default runs need no AI keys/limits.
- Reusable cleanup is called by fixture finally and outer wrapper. It validates run/SHA/manifest, run-prefixed IDs, synthetic facts/origin/references; rejects malformed/foreign/null-orphan ownership, checks zero residuals, preserves anonymous metrics and rolls back on failure.
- Wrapper attempts AI -> Phase20 -> legacy cleanup even after an earlier failure. Lease release occurs only after every phase succeeds and shares the global advisory-lock transaction; session/commit failure rolls release back.
- Lock26m covers browser22m+startup1m+two70s old cleanup windows including waits+16s AI cleanup, with24s margin. Browser22m/intake24m unchanged; budget invariant tested.
- Authored HTTP/duplicate/fresh-last-quota scenarios use three distinct manifest-owned subjects. Two distinct keys compete for one fresh quota acceptance; global assertions use baseline deltas without narrowing/re-hashing the manifest.
- Actual PostgreSQL/Preview execution is still NOT RUN and requires separate approval. No deployment/execution readiness claim from local tests.

## Migration / files
- Additive FILE only:prisma/migrations/20261014090000_phase21_ai_consultations_mock/migration.sql. Seven new AI tables, nullable generic lease manifest, indexes/FK/checks, synthetic-only origin,90d identity immutability and deny-by-default RLS/no anon/authenticated grants.
- No existing migration edits; no migration application anywhere, db push/reset/seed/resolve.
- Main additions:lib/ai-consultations;server/ai-consultations;ADMIN AI screens/actions/navigation;disabled real Kakao/cron routes;Mock Skill route;lib/e2e optional selection/invocation/cleanup/budgets;authored PG/Preview scenarios;unit tests and SPEC/PLAN/QA reports.
- Original C:/projects/yaho-management unstaged .gitignore/LAST_RUN_REPORT were not edited/stashed/restored/staged. No env copied,shared node_modules junction or Memory write by developer.

## Actual verification
| Check | Result / evidence |
|---|---|
|Full local tests|PASS,128 files/1119 tests (1011 existing+108 new),actual exit0|
|Independent root local Mock/preparation tests|PASS,26 files/229 tests,actual exit0 (chunk571f5d); no DB/Preview execution|
|lint/typecheck|PASS actual exit0; final lint no warnings|
|Prisma validate/generate|PASS actual exit0,isolated client only; schema unchanged by preparation|
|Final production build|PASS actual exit0,session20063; complete compile/types/static/routes output observed; NextDev process count0 precheck|
|Whitespace|Tracked diff check exit0; all46 new files clean before this documentation-only update|
|QA / Review|Final independent root PASS for authorized local Mock/test-preparation scope only|
|Actual PG/Preview/browser/mobile/release|NOT RUN / UNVERIFIED|

In-memory transaction/cleanup tests do not prove actual PostgreSQL semantics. AC21-01–17 mapping and limits are in PHASE21_QA_REVIEW.md.

## Review history
- One rework round: R21-01 MAJOR external ADMIN validation diagnostics; R21-02 MINOR missing anonymous recovery count. Both fixed/tested/closed; no unresolved findings in approved scope.
- Subsequent authorized preparation completion added fixed runner wiring/cleanup and guarded scenario tests, followed by fresh independent QA/Review PASS. This was code preparation, not actual DB/Preview approval.

## Environment / remaining approval gates
- Mock keys only:AI_ENCRYPTION_KEYS,AI_ENCRYPTION_ACTIVE,AI_HMAC_KEYS,AI_HMAC_ACTIVE,AI_MOCK_REQUEST_SECRET. Distinct purposes/retained prior versions required. Values never logged.
- AI_MOCK_LIMITS has positive bounded subjectPerMinute/globalPerMinute/dailyCalls,dailyCost0. Missing/invalid optional config fails closed. OPENAI_API_KEY is not used/needed and cannot activate a real provider.
- Reuse approved Preview project/runtime/exact-SHA/handshake/lease/global-lock guards; no new env file created.
- Separate approval is required for migration target/application and actual PostgreSQL/Preview execution. Actual browser/mobile evidence remains outstanding.
- Real Kakao channel/Skill/authentication/Callback capability,official guidance,privacy/external-transfer review and operational deletion cadence/backups are unverified or unavailable. No actual customer data or live service activation.
- No commit/push/PR/merge/Production deployment performed; no SHIP/release PASS. Subsequent SHIP awaits required verification; this does not add separate user approval requirements for each commit/push/PR. Only the user-gated actual integrations/customer data,DB application/PG/Preview execution,merge,Production deployment and live activation require their respective explicit approvals. PC remains on because overall verification/release is incomplete.
