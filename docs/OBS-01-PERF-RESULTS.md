# Iteration 6B — OBS-01 Performance Results

Measurement status: **NOT RUN locally**. This VM has no PostgreSQL or Docker. Calibration and all primary calls, warmups, replays, real database invariant checks, independent-session checks and run-owned cleanup execution are **NOT RUN**. The first calibration/measurement execution is planned in CI through the approved A2 job; no CI run was triggered in this session. No numerical benchmark result exists.

Approved scope: A1 + A2 + A4. A3/A5/A6 remain excluded. The implementation is test-only; product code, finance/locking/transaction semantics, schema/migrations, dependencies, existing tests and ordinary Vitest configs are unchanged. No staging, commit or push was performed.

## Local verification identity

- Checked-out SHA: f8a4ecf0986dd2224925870bb109182dc78c10da; branch: feature/phase21-ai-service; PR: 54 Draft.
- Audited unchanged product source: 3e9fef51d1ff912c055ff7e7226dfc607c601ca9.
- Initial harness/config content digest: 66b1f66218140f7cb59ccd0f9c1618ff3bfebe3c128a998b0dde945e7ffabd54; source before this report: DIRTY (uncommitted approved harness/workflow).
- Verification route: LOCAL. CI run/attempt, PR event head SHA and integration checked-out SHA: N/A.
- Actual local environment: Linux 7.0.0-39-generic; AMD EPYC model 9D25; 2 CPUs; approximately 8 GiB memory; Node 24.22.1; Prisma CLI/client 6.19.3. These describe verification tooling, not a PostgreSQL measurement environment.
- Actual PostgreSQL version, applied migration verification and server identity: N/A / NOT RUN. Migrations remain unchanged.
- Planned topology: dedicated loopback direct PostgreSQL; no pooler or remote service. Three pools/clients (setup 1, measured 2), connection_limit 1 each, pool_timeout 10 seconds. Core maxWait 10000ms / timeout 20000ms; default isolation unchanged.
- Planned matrix: 50 cells, including 6 race cells, 22 NEW and 28 EXISTING; device ONE 48 / NONE 2. Deposit profiles: EXACT 20 / ALL_QUOTES 12 / FRAGMENTED 6 / MINUS_ONE 12; holds NONE 38 / FUNDED 6 / PARTIAL_RETURN 6.
- Fixed profile/order revision: 1; scenario order follows SPEC/PLAN, then N 2/4/8, then NEW/EXISTING; NORMAL N=2 device ONE then NONE per mode. Five excluded warmups and thirty measured fresh fixtures per cell/pair are configured.
- Planned totals: 250 warmup fixtures/pairs and 1500 measured fixtures/pairs; 280 warmup and 1680 measured primary core calls. Actual primary core calls: 0.

## Initial build checks (before independent QA)

- Before implementation: full unit suite PASS, 206 files / 2557 tests / 0 skipped.
- After implementation: full unit suite PASS (exit 0), 206 files / 2557 tests / 0 skipped, unchanged from baseline.
- Full repository lint PASS (exit 0): 0 errors, 1 pre-existing unused-variable warning in tests/unit/ai-service/selection-safety.test.ts:40.
- Production build PASS (exit 0), including type validation. The port-independent Next-dev process check immediately before build found no dev server.
- TypeScript after the final lifecycle fix: PASS (exit 0). Focused performance ESLint after that fix: PASS (exit 0).
- Harness self-checks: 98 PASS, including 42 output/guard checks, 17 reduced-Snapshot invariant mutation/baseline checks, missing-invariant gates, counter and nearest-rank checks. These are test-harness checks, not calibration or benchmark samples.
- Discovery: exact baseline file lists preserved; unit 206 files / perf 0, integration 6 files / perf 0, performance 1 file / unit 0 / integration 0. Integration execution NOT RUN (no PostgreSQL).
- Direct perf config without opt-in: exits 1 with fixed OPT_IN_REQUIRED, clients_constructed=0, fixture_writes=0. Additional 0/invalid/unsafe/Preview/Vercel guards fail safely.
- Workflow YAML parses; existing integration job definition is unchanged. New job has its own PostgreSQL service, needs integration, exact approved PR/head/repository/events condition, explicit head checkout, PR-specific non-cancelling concurrency and 60-minute cap. Install is plain npm ci with a 10-minute cap. Only preparation/collection opt in; summary output is aggregate-only and no artifact upload exists.

## D1/D2 fix cycle

- Independent QA returned NOT READY with two MAJOR harness defects: runner timeout bypassed stop/drain/owned cleanup (D1), and consent expectations trusted mutable post-call application fields (D2).
- D1 now tracks outstanding callback work and every owned manifest, stops subsequent cells/samples on runner timeout, drains before cleanup/disconnect, and derives cleanup status from verified fixture cleanup. DB-free real-Vitest probes cover shortened cell/setup timeouts, deferred operations and failed cleanup; timeout reports remain INCOMPLETE.
- D2 derives submitted time/version from the pre-call snapshot and checks stored application fields remain unchanged. Five added mutations cover each stored field and coordinated application/consent corruption.
- Fix verification: unit suite PASS, 206 files / 2557 tests / 0 skipped; harness self-checks **109 PASS** (22 invariant baseline/mutation checks, 6 lifecycle/runner checks, existing guard/output/counter/gate checks preserved). Typecheck, full lint and production build PASS; lint retains the same one pre-existing warning. The port-independent dev-server check found none before build.
- Exact discovery lists remain unchanged: unit 206 / integration 6 / performance 1, with no cross-discovery. Direct no-opt-in execution still exits 1 with OPT_IN_REQUIRED, clients_constructed=0, fixture_writes=0. Workflow and all configs are unchanged by this fix.
- Fixed harness/config digest: 847adf038a1806179936ccf5a1ace56a5c9f19dad16b7bcbd3cf63cf8b659740. HEAD remains f8a4ecf; no stage/commit/push. Independent QA rerun remains pending. PostgreSQL measurement and real fixture cleanup remain NOT RUN locally; the initial NOT RUN aggregate below is retained as historical output.

## CI handoff and trial removal

Before an independently authorized Git/SHIP trigger, verify Actions quota/storage allowance and queued runs. Quota remains UNVERIFIED here. Existing integration normally uses a PR merge ref; performance explicitly checks out the PR head. The new job records both requested head and integration event SHA and the harness verifies its actual checkout. No dispatch was requested or attempted.

After the first complete trial and QA/Review report, remove the temporary job and job-level concurrency before closing 6B. Concrete removal recipe: delete the obs01-perf mapping from jobs in phase2-integration.yml; retain the preceding integration job byte-for-byte. Record the trial head SHA/run/attempt and review that removal diff. A failed trial is reported before any further run.

## Limitations and output discipline

Real PostgreSQL calibration, commit/rollback event coverage, late delivery, independent backend sessions, fixture validity, invariants and manifest cleanup remain unverified until CI. COMPLETE requires every warmup/sample, per-code execution gate, environment/calibration and cleanup check to pass. There is no latency threshold, extrapolation to production, outlier removal or overhead correction. Physical table/index growth, cache warming, autovacuum and shared-runner noise can affect observations.

One ad hoc workflow-verification command outside the harness inadvertently serialized existing synthetic service connection metadata in its diagnostic output. No real credentials or fixture data were involved; no raw value is reproduced here. The guarded harness output probes pass.

The aggregate table below explicitly records every planned outcome row with n=0 and N/A statistics; race calls and pair rows remain separate. Self-check counts are separate from real-database assertions.

# OBS-01
status: NOT RUN
primary_counts_known: true
utc_started: 2026-10-23T08:19:30.550Z
utc_finished: 2026-10-23T08:19:30.550Z
failure: DATABASE_UNAVAILABLE
cleanup: UNKNOWN
self_checks: 98
pool topology: dedicated loopback direct PostgreSQL; isolation unchanged default; event counters and clocks; no overhead correction
query event coverage: observed events only; extra transaction events unclassified; unexposed engine commands excluded
contention: simultaneous start; lock overlap and lock wait duration unmeasured
physical table/index growth, cache warming and autovacuum may affect observations

| Client | Calibration | Explicit | Repetitions | Events min/max | Verified | Attribution | Late events |
| --- | --- | --- | --- | --- | --- | --- | --- |

| Scenario | N | Selected | Mode | Device/consent/deposit/hold | Outcome/metric | Status | Warmups | Attempted/settled/valid | Wall p50/p95/max ms | Query min/p50/p95/max | Fulfilled/rejected | Effects | Invariant scope | Expected/executed/pass/fail | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NORMAL | 2 | 2 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 2 | 2 | NEW | NONE/NONE/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 2 | 2 | EXISTING | NONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 4 | 4 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 8 | 8 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| NORMAL | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SUBSET | 2 | 1 | NEW | ONE/NONE/ALL_QUOTES/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SUBSET | 2 | 1 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/ALL_QUOTES/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SUBSET | 4 | 3 | NEW | ONE/NONE/ALL_QUOTES/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SUBSET | 4 | 3 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/ALL_QUOTES/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SUBSET | 8 | 7 | NEW | ONE/NONE/ALL_QUOTES/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SUBSET | 8 | 7 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/ALL_QUOTES/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| FRAGMENTED | 2 | 2 | NEW | ONE/NONE/FRAGMENTED/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| FRAGMENTED | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/FRAGMENTED/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| FRAGMENTED | 4 | 4 | NEW | ONE/NONE/FRAGMENTED/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| FRAGMENTED | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/FRAGMENTED/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| FRAGMENTED | 8 | 8 | NEW | ONE/NONE/FRAGMENTED/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| FRAGMENTED | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/FRAGMENTED/NONE | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| RETURN-HOLD | 2 | 1 | NEW | ONE/NONE/ALL_QUOTES/PARTIAL_RETURN | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| RETURN-HOLD | 2 | 1 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/ALL_QUOTES/PARTIAL_RETURN | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| RETURN-HOLD | 4 | 3 | NEW | ONE/NONE/ALL_QUOTES/PARTIAL_RETURN | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| RETURN-HOLD | 4 | 3 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/ALL_QUOTES/PARTIAL_RETURN | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| RETURN-HOLD | 8 | 7 | NEW | ONE/NONE/ALL_QUOTES/PARTIAL_RETURN | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| RETURN-HOLD | 8 | 7 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/ALL_QUOTES/PARTIAL_RETURN | SUCCESS/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | COMMIT | SAMPLE | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 2 | 2 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/WINNER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 2 | 2 | NEW | ONE/NONE/EXACT/NONE | ApplicationNotPendingError/LOSER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 2 | 2 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/PAIR | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/WINNER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | ApplicationNotPendingError/LOSER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/PAIR | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 4 | 4 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/WINNER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 4 | 4 | NEW | ONE/NONE/EXACT/NONE | ApplicationNotPendingError/LOSER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 4 | 4 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/PAIR | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/WINNER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | ApplicationNotPendingError/LOSER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/PAIR | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 8 | 8 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/WINNER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 8 | 8 | NEW | ONE/NONE/EXACT/NONE | ApplicationNotPendingError/LOSER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 8 | 8 | NEW | ONE/NONE/EXACT/NONE | SUCCESS/PAIR | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/WINNER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | ApplicationNotPendingError/LOSER | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | SHARED_PAIR | 0/0/0/0 | UNKNOWN |
| SAME-SUBMISSION RACE | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | SUCCESS/PAIR | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | SINGLE_COMMIT | PAIR | 0/0/0/0 | UNKNOWN |
| INSUFFICIENT | 2 | 2 | NEW | ONE/NONE/MINUS_ONE/NONE | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| INSUFFICIENT | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/MINUS_ONE/NONE | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| INSUFFICIENT | 4 | 4 | NEW | ONE/NONE/MINUS_ONE/NONE | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| INSUFFICIENT | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/MINUS_ONE/NONE | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| INSUFFICIENT | 8 | 8 | NEW | ONE/NONE/MINUS_ONE/NONE | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| INSUFFICIENT | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/MINUS_ONE/NONE | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| HELD-FUNDS INSUFFICIENT | 2 | 1 | NEW | ONE/NONE/MINUS_ONE/FUNDED | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| HELD-FUNDS INSUFFICIENT | 2 | 1 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/MINUS_ONE/FUNDED | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| HELD-FUNDS INSUFFICIENT | 4 | 3 | NEW | ONE/NONE/MINUS_ONE/FUNDED | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| HELD-FUNDS INSUFFICIENT | 4 | 3 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/MINUS_ONE/FUNDED | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| HELD-FUNDS INSUFFICIENT | 8 | 7 | NEW | ONE/NONE/MINUS_ONE/FUNDED | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| HELD-FUNDS INSUFFICIENT | 8 | 7 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/MINUS_ONE/FUNDED | InsufficientApplicationDepositError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| DUPLICATE UNPAID | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | DuplicateReservationError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| DUPLICATE UNPAID | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | DuplicateReservationError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| DUPLICATE UNPAID | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | DuplicateReservationError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| DUPLICATE PAID | 2 | 2 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | ApplicationPaymentAlreadyExistsError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| DUPLICATE PAID | 4 | 4 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | ApplicationPaymentAlreadyExistsError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
| DUPLICATE PAID | 8 | 8 | EXISTING | ONE/PRIOR_OPTIONAL_AGREED/EXACT/NONE | ApplicationPaymentAlreadyExistsError/CALL | NOT RUN | 0/5 | 0/0/0/30 | N/A | N/A | 0/0 | ROLLBACK | SAMPLE | 0/0/0/0 | UNKNOWN |
SELF_CHECK/LEDGER: 3/3/3/0
SELF_CHECK/AVAILABLE_BACKING: 3/3/3/0
SELF_CHECK/EXACT_LINKAGE: 3/3/3/0
SELF_CHECK/SELECTION_ISOLATION: 3/3/3/0
SELF_CHECK/FIXED_QUOTES: 3/3/3/0
SELF_CHECK/NO_RECONFIRMATION: 3/3/3/0
SELF_CHECK/HELD_FUNDS: 3/3/3/0
SELF_CHECK/CHILD_STATE: 3/3/3/0
SELF_CHECK/CONSENT_APPEND: 3/3/3/0
SELF_CHECK/DEVICE_SCOPE: 3/3/3/0
SELF_CHECK/NO_REFUND: 3/3/3/0
SELF_CHECK/ROLLBACK_STATE: 3/3/3/0
SELF_CHECK/FIFO: 3/3/3/0
SELF_CHECK/RACE_SINGLE_WINNER: 3/3/3/0
