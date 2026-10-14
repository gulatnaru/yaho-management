# Phase21 BUILD report — 2026-10-15

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
