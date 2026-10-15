# Phase 21 — Approved Mock implementation plan

## Current execution addendum — 2026-10-15
- User-authorized nonproduction-only migration applied and verified on independently approved Preview:14 applied,0 pending. Production DB/migration/deployment and actual integrations/customer processing remain forbidden.
- Latest actual3-case Preview run:HTTP and ADMIN (including guidance/retention) PASS; PostgreSQL harness FAIL; cleanup PASS. Earlier PG passes do not satisfy the latest all-three gate. Fresh independent QA/Review and feature commit/PR remain pending.
- Exact current harness is tests/integration/phase21-postgres.ts invoked by tests/e2e/phase21-ai-consultations.spec.ts. Agent behavior is covered by tests/unit/ai-consultations/handler.test.ts and tools.test.ts; nonexistent planned filenames below were corrected without changing approved requirements.
- WAN harness warms independent connections and applies its own bounded2s transaction acquisition wait; deployed Skill caps, ownership/global-lock checks and audited cleanup budgets remain unchanged. Known PG code/stage/caller diagnostics are fixed and exclude raw errors.

## Continuation approval — 2026-10-15
Latest user approval expands execution only to independently verified, separate nonproduction DB migration, synthetic PostgreSQL integration and Preview E2E, scoped cleanup, fresh local gates and independent QA/Review, followed by existing feature commit/PR. Production DB/access/migration/deployment, real Kakao/OpenAI/customer data, and automatic merge remain forbidden. The additive migration FILE and its explicitly approved Preview-only APPLY are distinct evidence. A temporary exact-content validation snapshot supports preliminary exact-SHA verification before committing the existing feature branch; safety guards are unchanged. Actual test results are tracked in BUILD/QA reports, never inferred from preparation.


## Approval ledger
- Source: user-approved Phase 21 conversation PLAN, ADR-061 Accepted, SPEC AC21-01–17.
- PLAN conditionally approved; four technical boundaries clarified below without changing business policy. BUILD authorized after clarification.
- Authorized: Mock-only code, synthetic tests, additive migration FILE, local non-DB gates.
- NOT authorized: real Kakao/OpenAI connections, customer data, Preview/Production migration application, Production deployment, live activation or merge.
- Source of Truth remains current user request > REQUIREMENTS > DECISIONS > ARCHITECTURE > AGENTS > implementation. Memory is supporting context.

## Goal / Current state
Modular Monolith Next.js/Prisma/PostgreSQL. Existing Phase 20 untouched. Default-private AI publication is independent of reservation application links. No approved operational guidance or Kakao credentials/Callback capability exists. Missing facts produce a fixed human-consultation notice. Mock results do not prove live Kakao timing or OpenAI safety.

## Data model
Add AiProgramPublication, AiClassPublication, AiKnowledgeEntry, AiConsultation, AiQuotaBucket, AiDailyMetric and AiRetentionJob; additive migration only. All data origin SYNTHETIC, scoped to an authenticated Preview run. Generic PreviewE2eRunLease gains a nullable AI fixture manifest; existing Phase 20 guard remains unchanged. No Child/Payment/Refund relationship or write. AI publication defaults false for BOTH Program and ClassSchedule. Explicit owned IDs from a runner-authored manifest restrict every read/write.

## API / UI
- /api/kakao/skill remains disabled; no real transport or Callback.
- /api/ai-consultations/mock-skill accepts bounded signed synthetic fixture requests only, never arbitrary customer text.
- ADMIN-only AI publication, approved synthetic guidance, encrypted consultation list/detail, aggregate metrics and retention/recovery status/actions. No unsupported-runtime DB access.
- Allowlisted tools: list_public_programs, list_public_classes, get_class_availability, get_approved_guidance. Strict Zod arguments and explicit DTO allowlists. No SQL/search/customer/admin tool. Internal capacity/RESERVED count is mapped to AVAILABLE/UNAVAILABLE/UNKNOWN, never passed to provider/customer.
- Model produces structured intent/tool selection; server renders approved facts. Missing/unapproved knowledge, errors, out-of-domain or injection => fixed HUMAN_HANDOFF. No history retransmission.

## Boundary 1 — Runtime isolation
Production rejects before body parsing, auth DB lookup, crypto keys, Prisma or provider creation. Any environment other than exact VERCEL_ENV=preview also rejects in HTTP/UI runtime. NODE_ENV=test and synthetic=true never unlock a deployed route. Preview requires purpose-bound signed request, exact app SHA, timestamp, approved Preview and denied Production refs for both URLs, verified runtime fingerprint, active generic lease, global advisory lock and runner-owned AI manifest. Test core DI is not an HTTP bypass.

## Boundary 2 — Idempotency / quota
Unique(scope,requestKey) plus immutable keyed body digest. One short transaction locks scoped request and sorted quota buckets. Same key/body DONE returns only unexpired cached synthetic result; PROCESSING returns fixed pending handoff; FAILED/UNCERTAIN has no implicit retry. Same key with different body is refused. Rotation dual-reads approved HMAC versions and uses stable logical bucket ID; request digest version remains stored. Accepted burst counters never refund. Model/cost reservation is atomic. Settlement is attempt-CAS fenced and happens at most once; known unused pre-dispatch reservation can refund; dispatched unknown usage remains reserved until bounded recovery. No DB transaction spans model call. Actual OpenAI expense is zero, simulated usage explicitly synthetic. Negative counters/overshoot disallowed. Real PostgreSQL races require separate execution approval; in-memory tests are not PG proof.

## Boundary 3 — Record security / TTL
AES-256-GCM versioned encryption keys, separate versioned HMAC pseudonym/request digest keys and separate request signing secret; reject reused/missing/malformed keys. AAD binds ID, run, created/expiry dates and version. Unknown version/tamper/decrypt failure => fixed refusal, no plaintext fallback. expiresAt=createdAt+90 days, immutable. Query filters expiry and decryption rechecks current time immediately before return. No plaintext/user identifiers in metrics/logs. Delete raw row, pseudonym and idempotency together; preserve only day/category anonymous aggregates. Retention is bounded, serialized per owned run, retryable; expired raw never becomes readable after a failed purge. Cron disabled for deployed live data; fake-clock automatic job and scoped Preview adapter only. Physical deletion cadence, backups, monitoring and recovery operations remain live-activation gates.

## Boundary 4 — Four-second budget
Whole handler uses monotonic 4,000ms deadline: authentication/validation600, claim/quota400, agent/tools2200, settlement500, response reserve300. Each stage is min(stage cap,remaining minus response reserve). AbortSignal propagated; timers cleared; bounded DB transaction/statement/lock waits. Late provider completions cannot trigger tools, append raw data or settle a newer attempt. Deadline before dispatch refunds only confirmed unused reservation; after dispatch/commit uncertainty preserves recovery obligation. Fixed HUMAN_HANDOFF on timeout; no raw provider/DB errors. No promise of real Kakao SLA before actual integration verification.

## Tests — acceptance trace
| Requirement / ADR | Invariant | Positive / denial / race | Level | Location |
|---|---|---|---|---|
| AC21-01/13/14 ADR061 | Mock-only authenticated owned requests | valid, bad signature, Production, flag spoof, size | unit/route | tests/unit/ai-consultations/runtime.test.ts |
| AC21-02/03/06/12 ADR061 | default private, approved tools/facts | both opt-in, unpublish, injection, absent guidance | unit | tests/unit/ai-consultations/tools.test.ts, tests/unit/ai-consultations/handler.test.ts |
| AC21-04/05 ADR061 | no seat numbers, status only | full, available, DB failure, changing publication | unit + guarded PG rerun pending | tools.test.ts |
| AC21-07 | atomic claim/quota/fenced settle | concurrent claim, retry, processing, refund, unknown | unit/PG pending | ledger.test.ts, tests/integration/phase21-postgres.ts (through guarded Preview E2E) |
| AC21-08 | server ADMIN-only | ADMIN versus MANAGER/TEACHER/invalid | unit | admin.test.ts |
| AC21-09/10/11/15 | encrypted TTL, purge and anonymous stats | 90d boundary, tamper, key rotation, deletion failure | unit/PG pending | crypto.test.ts, retention.test.ts |
| AC21-16 | Phase20 and financial rules preserved | reuse existing application/reservation/payment tests | unit | existing tests/unit |
| AC21-17 ADR059 | actual evidence, own fixtures | safe Preview integration, cleanup | E2E latest2/3,rerun pending | tests/e2e/phase21-ai-consultations.spec.ts |

## Acceptance / risks / order
AC21-01–17 in SPEC remains authoritative. Runtime guards -> schema/migration file -> tools/agent -> ledger/crypto/retention -> ADMIN UI/routes -> unit and authored guarded integration/E2E -> lint/typecheck/validate/build -> separate QA/Review. New code contains no real model provider, deployment cron schedule or real Skill connection. DB tests/migration application/Preview E2E require separate approval and must be reported NOT RUN. No code/DB rollout automatically follows PLAN approval.

## Approved-scope implementation refinement — optional test preparation
- Fixed optional PHASE21 selection/config/reporter/counts and reusable wrapper/fixture cleanup are prepared without executing a DB/Preview run. Default Phase20 selection is unchanged.
- IDs are run-bound; malformed/foreign/missing ownership or residuals retain lease and fail closed. Cleanup retains anonymous metrics and always attempts old phases before deciding success. Lease release shares the global-lock transaction.
- Global lock26m explicitly covers new bounded cleanup/acquisition time; browser22m/intake24m unchanged.
- Authored PG scenarios use independent owned subjects and baseline global deltas. Preparation is not migration/execution/deployment approval.
- Production Mock processing/context/actions are blocked; existing general ADMIN page authentication remains before disabled rendering.
