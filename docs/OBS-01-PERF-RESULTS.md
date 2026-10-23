# Iteration 6B — OBS-01 Performance Results

Measurement status: **NOT RUN locally**. This VM has no PostgreSQL or Docker. Real-database calibration and all primary calls, warmups, replays, invariant checks, independent-session checks and owned cleanup are **NOT RUN locally**. The latest supplied CI attempt **39959078879** ended **INVALID / ATTRIBUTION / BOOTSTRAP**, client **A**, condition **MISSING**, expected **2**, observed **1**, late **0**. Source identity, **184 self-checks** and cleanup passed; calibration and sampling never started. The earlier supplied attempt **39947005784** reached calibration and ended INVALID / ATTRIBUTION with cleanup PASS, 109 self-checks and zero measurements. No numerical benchmark result exists; no CI run was triggered in this final calibration-fix session.

Approved scope: A1 + A2 + A4. A3/A5/A6 remain excluded. The implementation is test-only; product code, finance/locking/transaction semantics, schema/migrations, dependencies, existing tests and ordinary Vitest configs are unchanged. No staging, commit or push was performed.

## Local verification identity — initial build (historical)

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

## Attempt history — 2026-10-23 ATTRIBUTION diagnosis and fix

### Evidence and identity

- Starting HEAD: `1ab5c8f41a9c21ae2aaa85070531896e307c6da1`; branch `feature/phase21-ai-service`; PR #54 Draft. The worktree was clean before this fix. No stage, commit, push or CI trigger is authorized or performed.
- User-supplied evidence from CI run `39947005784`, `obs01-perf`: full checkout history and checked-out SHA == PR head passed source identity; the run then ended within approximately five seconds, `INVALID`, `ATTRIBUTION`, cleanup `PASS`, 109 self-checks, zero measurements. These aggregate facts identify the failed gate, **not the exact failed predicate**. This session has no raw real-DB reproduction.
- Local installed Prisma CLI/client: **6.19.3**, generated engine revision **c2990dca591cba766e3b7ef5d9e8a84796e47ab7**. The new client-construction guard requires that client/engine pair before relying on its exact event model. Runtime event delivery on PostgreSQL 16 remains **NOT RUN** here.

### Every former direct ATTRIBUTION path

| Former predicate in `measurement.ts` | What it actually established / possible failure |
| --- | --- |
| `connect`: two backend PID results have length one and unequal values | Checks backend-session distinction. Same URL does not imply a shared pool, but different client objects alone are insufficient proof. Equal/malformed PID results fail. There is no evidence the supplied CI failed this predicate. |
| Sequential calibration: inactive counter's events/late unchanged and inactive flag false | Detects delivery on the idle client during someone else's work. A delayed callback from that idle client's earlier bootstrap/calibration can also trip it, despite correct event ownership. A previously unwatched client's events were silently discarded, creating an additional blind spot. |
| Concurrent calibration: all `capture` promises fulfilled | This wrapper converted **any** capture rejection into ATTRIBUTION, hiding underlying LATE_EVENT, CALIBRATION, CLIENT_BUSY or database errors. A correctly attributed terminal callback delivered after transaction settlement could fail capture's one-turn drain and appear only as ATTRIBUTION. |
| Concurrent calibration: each count equals that client's sequential COMMIT minimum | Sequential transaction calibration accepted any reproducible total >=2. It could accept only the two explicit statements while transaction-control callbacks were still pending, then reject a concurrent capture that received all four. Equal work/counts also failed to distinguish a complete swap of two event streams. |

The supplied aggregate cannot distinguish these four sites. **Proven code defects:** unaccounted bootstrap events, incomplete transaction baselines, no native-delivery fence, masked concurrent rejection detail and symmetric-only attribution evidence. **Hypotheses about this CI attempt:** delayed bootstrap/terminal events or a sequential/concurrent count discrepancy could explain ATTRIBUTION; neither is claimed as the observed root predicate until a real-DB rerun returns the new fixed diagnostic.

### Prisma source and event model

1. **Clients/pools/registration:** `clients()` constructs three fresh base PrismaClient objects from the same guarded direct-loopback URL; `poolUrl()` forces each pool's connection_limit=1 and pool_timeout=10. There is no `$extends`, shared/default client or async-context attribution. Each measured listener registers synchronously before `$connect`. Installed `node_modules/@prisma/client/runtime/library.js.map` (`getPrismaClient.ts`) shows a fresh EventEmitter and engine per constructor; `LibraryEngine.ts` closes its native logger over that engine instance and emits on that instance's emitter. Wrong-object delivery is not documented expected behavior; bootstrap or health-check activity on the correct idle object must not be mislabelled cross-client routing.
2. **Historical bootstrap assumption — superseded by the final cycle below:** the pinned native engine's [connect implementation](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/query-engine-node-api/src/engine.rs#L200) obtains a connection and asks its version. PostgreSQL's [version/raw-query implementation](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs#L670) contains a metrics query, but this did not establish delivery of a query event during real `$connect()`. That attempt required exactly **2** delivered events per client, including the harness PID probe. CI 39959078879 disproved that required event-delivery model. No fixed internal-emission expectation remains in the final implementation.
3. **Inactive events:** PostgreSQL's [pool configuration](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/connectors/sql-query-connector/src/database/native/postgresql.rs#L50) enables a check on checkout after 15 seconds; [manager.check](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/pooled/manager.rs#L161) emits a numeric health query. The engine locks mobc 0.8.5: [fresh connections skip checkout checks](https://github.com/importcjj/mobc/blob/0.8.5/src/lib.rs#L376), and [last_checked_at starts at creation time](https://github.com/importcjj/mobc/blob/0.8.5/src/conn.rs#L129). This is checkout activity, **not an autonomous idle health-query timer**. Merely rejecting observed extras would be insufficient: a delayed extra could substitute for a missing expected callback. Therefore the exact model is accepted only if bootstrap and the entire calibration finish within **10 seconds of a monotonic start before fresh measured-client connect**, leaving five seconds before any checkout health check can become eligible. Entry/completion guards fail ATTRIBUTION / MODEL_EXPIRED otherwise; repeated connect cannot refresh the model age. Protocol/setup commands not wrapped in metrics are not claimed covered by query events.
4. **Normal calibration totals:** the pinned [transaction implementation](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/transaction.rs#L88) routes BEGIN, COMMIT and ROLLBACK through logged raw commands. Numeric raw SELECT and the rollback UPDATE each produce one metrics event through the [native query/execute/raw-command implementation](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs#L663). Therefore standalone SELECT=**1**, commit with two explicit statements=**4**, rollback with two explicit statements=**4**. Concurrent equal-work transactions require **4 per own client**, not eight per client or a learned >=2 baseline. Additional asymmetric probes require **4 vs 5**, then **5 vs 4**, to detect swapped streams. These are source-backed expectations, **not observed real-DB totals in this session**.
5. **Promise settlement is not delivery:** the [native logger](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/query-engine-node-api/src/logger.rs#L145) queues a thread-safe callback with Blocking mode. [Node-API documentation](https://nodejs.org/api/n-api.html#calling-a-thread-safe-function) defines Blocking in terms of queue capacity; it does not wait for JS execution, and permits zero or more callbacks per event-loop tick. Prisma QueryEvent types and the logging API provide no transaction-promise delivery guarantee. Consequently one setImmediate is not a delivery barrier. `LibraryEngine.ts` also sets QueryEvent.timestamp to `new Date()` **inside the JS logger callback**: it records delivery time, so it cannot identify an old callback that arrives during a later operation.

### Fix and remaining fail-closed boundary

- Counters observe continuously from construction; no startup event is discarded. Every known-work window stays owned after its work promise settles until its own **exact expected total** is delivered and unchanged for 25ms, with a **1000ms** delivery timeout. A missing/extra callback, idle-client change or callback after closure invalidates the run; an exact total arriving too late to establish stability fails UNSTABLE. The separate **10-second lifetime guard** excludes checkout health checks from the exact-count model; it is a calibration-validity bound, not a latency target or a change to core transaction timeouts. Quiet time is an additional observation period; known totals under that fresh-connection model establish coverage. Quiet time does **not** prove that an unknown total has finished delivering.
- Both clients are audited between bootstrap/calibration windows, before primary work, and before/after disconnect. Cleanup still attempts all client disconnects when an attribution audit fails. Session identity remains based on distinct valid backend PIDs, with added rejection of aliased client/counter objects.
- Sequential commit/rollback checks and rollback-state validation are preserved. Original eight calibration aggregate rows remain; three asymmetric repetitions in both directions add attribution evidence without changing the sample matrix, finances, transaction options, assertions or ordinary discovery.
- The sanitized report now preserves the exact failure sub-condition as fixed stage/client/condition labels and bounded numeric repetition/expected/observed/late counts. No SQL, parameters, target, identifiers, event payloads or exception details are captured or output. Unknown labels/fields and invalid numbers fail the strict report schema. Concurrent failure detail is preserved rather than flattened into a bare ATTRIBUTION.
- **Primary reuse remains fail closed pending a scoped decision.** Its physical event total is unknown. After any finite quiet interval, a callback from completed sample 1 could arrive while sample 2 is active and be indistinguishable from sample 2's own event. Timestamp cannot solve this; no operation/transaction identity is exposed. Timing-only draining would silently reassign an old event. PLAN calibration rule 7 explicitly forbids inspecting event SQL to classify control commands, so this fix does not silently introduce a terminal-command classifier. The setup hook aborts **after successful calibration and before primary fixtures/attempts**, with `ATTRIBUTION`, stage SAMPLE, condition UNPROVEN. Direct `measureCore` and race calls retain the same pre-invocation guard. A narrowly approved delivery fence or another proven attribution mechanism is required before sampling can resume; calibration success alone does not authorize unsafe reuse.

### Local verification for this attempt

- DB-free emitter regressions cover deferred native-style callbacks after work settlement, exact bootstrap/control-event totals, missing/extra callbacks and timeout, pre-window contamination, inactive-client delivery, both shared-client/shared-counter and equal-backend independence failures, swapped equal-work streams exposed by asymmetric probes, cross-window extras, late delivery during final cleanup/disconnect, preserved diagnostic detail and diagnostic privacy rejection. Model regressions reject expiration during bootstrap, before calibration and at final calibration completion, plus repeated-connect attempts to refresh its lifetime. Unknown-total primary and race entry points remain INVALID before executing work, including an adversarial deferred callback intended for a later window. A real-Vitest DB-free setup-hook probe verifies INVALID / ATTRIBUTION / SAMPLE / UNPROVEN, zero primary fixtures/calls/attempts/warmups, and roots/disconnect lifecycle cleanup PASS.
- Full unit suite: **PASS, 206 files / 2557 tests / 0 skipped**. Harness self-checks: **149 PASS**, retaining all previous 109 and adding 39 attribution/model/diagnostic checks plus one real-Vitest pre-sampling gate probe. Typecheck: **PASS**. Full repository lint: **PASS**, 0 errors and the same pre-existing unused-variable warning in `tests/unit/ai-service/selection-safety.test.ts:40`.
- Production build: **PASS** (exit 0); port-independent process checks found no Next dev server before both build executions. The final performance-only age-model guard was subsequently typechecked/linted/self-checked; production bundle inputs remain unchanged.
- Actual discovered file sets match HEAD exactly: unit **206**, integration **6**, performance **1**, no cross-discovery. Normal integration execution: **NOT RUN** (no PostgreSQL). Direct performance execution without opt-in still exits 1 with fixed OPT_IN_REQUIRED, clients_constructed=0, fixture_writes=0.
- Final harness/config digest: `0821a3ce381b8ae04bfd85831dc3c160b644c651cbaea4b48e94b12cf1579208`. HEAD remains `1ab5c8f`; index is empty. Product code, finance/locking/assertions, schema/migrations, dependencies, ordinary tests, all Vitest configs and workflow remain unchanged. No stage/commit/push or CI trigger occurred.
- **Real PostgreSQL calibration, real backend independence, primary measurement and real fixture cleanup: NOT RUN locally.** No mock/emitter result is reported as a PostgreSQL measurement. The exact predicate that failed CI remains unconfirmed; no complete performance baseline is claimed.

## Attempt history — 2026-10-23 approved terminal-command FENCE implementation

### Approval and exact exception

- 흥영's just-approved scope, dated **2026-10-23**, verbatim: **"예외 승인 — BEGIN/COMMIT/ROLLBACK fence만 허용"**. See ADR-065. This is a narrow exception to PLAN calibration rule 7 solely to prove delivery completion of one transaction's event stream; every other output/privacy rule remains in force.
- The listener may test `event.query` **in memory only**, for exact equality with `BEGIN`, `COMMIT`, or `ROLLBACK`. It does not trim, case-fold, remove semicolons, use prefix/substring matching, infer user-statement types, store query strings/event objects, log them, put them in diagnostics/reports, or output hashes derived from them. Nonmatches are discarded after equality comparisons. Only counts, booleans and an internal numeric terminal marker survive the callback.
- Starting identity: HEAD `1ab5c8f41a9c21ae2aaa85070531896e307c6da1`, branch `feature/phase21-ai-service`, PR #54 Draft, with the preceding ATTRIBUTION diagnosis/calibration fix already uncommitted. That fix is preserved. No stage/commit/push/CI trigger is performed.

### Pinned emitted-form and delivery-order evidence

- Prisma CLI/client remains **6.19.3**, engine **c2990dca591cba766e3b7ef5d9e8a84796e47ab7**. [Queryable::begin_statement](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/queryable.rs#L88) returns exactly `BEGIN`. [DefaultTransaction](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/transaction.rs#L88) passes that to `raw_cmd`, and its commit/rollback methods pass exact `COMMIT` / `ROLLBACK` constants at lines 104–115. The [PostgreSQL native raw_cmd](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs#L663) supplies `cmd` to metrics without adding whitespace or a semicolon.
- [metrics.rs](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/metrics.rs#L89) awaits the database command before tracing `query=%query`. Its default path passes the string unchanged. The optional `fmt-sql` / `FMT_SQL` branch (lines 41–58) is not a reason to accept alternate forms: this implementation performs **no normalization**, and a differing runtime terminal form cannot establish the fence. Actual emitted form and default-path behavior on the CI service still require real-DB confirmation.
- The [native logger](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/query-engine/query-engine-node-api/src/logger.rs#L143) serializes each trace field and queues delivery synchronously on that engine's thread-safe callback. Installed `node_modules/@prisma/client/runtime/library.js.map`, embedded `LibraryEngine.ts` lines 341–353, forwards `query: event.query` without string normalization. Each client has its own engine/emitter, as established in the preceding attempt.
- The CI Node 20 [ThreadSafeFunction implementation](https://github.com/nodejs/node/blob/v20.19.5/src/node_api.cc) enqueues with `queue.push(data)` and dispatches with `queue.front()` / `queue.pop()` under its mutex. Sequential transaction commands log before returning, so earlier transaction events are queued before the terminal event on the same engine callback. Terminal **delivery**, rather than transaction-promise settlement or quiet time alone, therefore fences the preceding stream. The existing post-terminal quiet check remains additional contamination detection. These are source-backed properties, not a claim that PostgreSQL event delivery has been measured locally.

### Implementation and fail-closed behavior

- Primary samples now open a fenced counter before the unchanged core invocation. Each race contender uses its own client's fenced counter. All observed events, including control commands, contribute to totals; no transaction-control subtraction is introduced. Wall time stops at business-call settlement; fence/quiescence/drain waiting does not inflate either call or pair wall time.
- Completion requires exactly one observed BEGIN before an outcome-matching terminal (fulfilled → COMMIT; rejected → ROLLBACK), followed by the existing **25ms** count stability check within the existing **1000ms** delivery bound. Missing terminal/transaction evidence stays `ATTRIBUTION / SAMPLE / UNPROVEN`; wrong order/repeated BEGIN and wrong outcome have fixed `FENCE_ORDER` / `FENCE_OUTCOME` subconditions. A late terminal that cannot establish count stability remains UNSTABLE.
- Terminal delivery closes event ownership immediately, including during quiescence. A subsequent callback with no open event window increments contamination, fails LATE and cannot be discarded to recover. Race waits for both contenders and preserves their sanitized failure detail rather than masking it with a bare raw drain error. Idle/between-window and disconnect audits remain active.
- Exact bootstrap/calibration totals, asymmetric probes, fresh-model lifetime guard, strict diagnostics, D1 lifecycle cleanup and D2 consent/snapshot expectations, all financial/selection invariants, environmental opt-in, discovery isolation and product transaction semantics remain intact. The former blanket pre-primary UNPROVEN gate is replaced by per-invocation proof; an invocation whose proof is absent still invalidates collection.
- DB-free emitter checks cover immediate and delayed-before-fence delivery with exact totals, reuse, commit and rollback, missing and wrong-outcome fences, near-miss whitespace/case/semicolon/containing-word strings, missing/repeated BEGIN, no-transaction prevalidation, unstable late fence, post-terminal/between-window/post-race contamination, and independent race fences including wrong/missing/stray contender B. Query/error canaries are checked against counter/call/error/diagnostic/report structures, serialized JSON/Markdown, and captured stdout/stderr with a strict single-aggregate protocol parse. A real-Vitest missing-fence warmup probe verifies INVALID/ATTRIBUTION/SAMPLE/UNPROVEN and owned cleanup PASS; it is a simulation, not a DB measurement.

### Local verification for the approved fence session

- Full unit suite: **PASS, 206 files / 2557 tests / 0 skipped**, exit 0. Perf self-checks: **184 PASS**. Relative to the preceding 149-check attempt, the three superseded blanket pre-invocation rejection checks are replaced by **37** fenced-primary/race checks and **one** additional captured-stream privacy check. Existing calibration/model, output/opt-in, lifecycle/timeout, invariant and D1/D2 checks remain covered.
- Standalone TypeScript: **PASS**. Full repository lint: **PASS**, 0 errors and the same pre-existing unused-variable warning in `tests/unit/ai-service/selection-safety.test.ts:40`. The final performance-only late-drain diagnostic changes and explicit near-miss fixtures were subsequently typechecked, performance-linted and self-checked; no production bundle input or ordinary unit test/discovery input changed.
- Production build: **PASS**, exit 0. Immediately before it, the port-independent `pgrep -af '[n]ext dev'` check found no running dev server. Full unit and production build passed before the final performance-only late-drain diagnostic coverage described above.
- Actual Vitest discovery: exact file sets match HEAD, **unit 206 / integration 6 / performance 1**, pairwise disjoint; no test modules were executed for discovery. Normal integration execution remains **NOT RUN** without PostgreSQL. Direct no-opt-in performance execution exits **1** with only `OBS01 failure=OPT_IN_REQUIRED clients_constructed=0 fixture_writes=0`. The self-check suite also verifies missing/0/invalid opt-in, unsafe URL and Preview/Vercel guards and captures both process streams.
- Product source, finance/locking/transaction semantics, schema/migrations, ordinary unit/integration tests, fixtures/invariant logic, dependencies, all Vitest configs and workflow remain unchanged. HEAD remains `1ab5c8f`; the index remains empty. No stage/commit/push or CI trigger occurred.

**Real PostgreSQL bootstrap/calibration, emitted event confirmation, backend independence, primary/race sampling, warmups, replays, invariant verification and real fixture cleanup remain NOT RUN locally. No numerical benchmark result is claimed; CI confirmation remains pending.**

## Attempt history — 2026-10-23 FINAL approved bootstrap calibration fix

This is 흥영's explicitly **last approved query-event calibration cycle**, based on the supplied sanitized failure from CI **39959078879**, starting at HEAD **d7e46e9** on **feature/phase21-ai-service**, PR **54 Draft**. The failure proves that the former fixed bootstrap total was not reached; it does not prove which individual callback was absent. No internal SQL execution or event is inferred from an unobserved callback. Earlier attempt descriptions above are historical; their exact bootstrap-total assumption is superseded here.

### Bootstrap baseline and attribution soundness

- Each measured counter owns bootstrap before `$connect()` starts. After connect settles, the harness issues one PID SELECT per client, with distinct fixed A/B comments. The listener compares only the two exact harness constants, without normalization or retaining/outputting SQL, parameters, event payloads or backend PID values. Its only exact bootstrap expectation is **one actually observed own-client probe event**. A missing callback fails ATTRIBUTION / BOOTSTRAP / **PROBE_MISSING**; a foreign client's probe fails **PROBE_CLIENT**, and duplicate own probes fail **PROBE_EXTRA**. Two swapped probe streams cannot satisfy one another.
- Other callbacks during bootstrap are an owned-but-uncounted initialization class. Their observed delivery increments a separate diagnostic and never a calibration/sample total. There is no expected internal count, estimated count or subtraction. Strict aggregate `bootstrapObserved` records only numeric A/B observed totals, including the probe, even on bootstrap failure; Markdown prints `bootstrap_observed_A/B`. These counts are diagnostics, never internal-emission pass/fail constants.
- The observed probe follows connect completion and fences preceding initialization callbacks under the already pinned per-engine FIFO delivery model. Bootstrap then requires **25ms with zero further events on each client**, resetting stability on any callback, within a **1000ms** delivery bound. Continuous trickling or a scheduler/clock jump past the bound fails closed. Both clients are subsequently audited with their bootstrap windows closed; calibration opens only after that audit and the unchanged **10-second fresh-connection model guard**.
- This baseline does not establish attribution accuracy by waiting alone. Accuracy still requires the unchanged exact standalone SELECT=1 and BEGIN/two statements/COMMIT-or-ROLLBACK=4 suite, concurrent and bidirectional asymmetric probes, and outcome-matching terminal fences for primary/race calls. All of those operate after the probe-fenced, quiescent baseline. No finite silence interval claims to prove arbitrary unseen future delivery.
- Any post-baseline stray remains invalid through the existing inactive/late, exact calibration-total and terminal-fence contamination rules. Additionally, an exact bootstrap probe arriving during an active later window is known to belong to bootstrap and becomes late contamination; it cannot replace a missing calibration callback. Late counters are never reset to recover. Distinct valid backend PIDs are still compared from probe **results**, without outputting their values.

### Regression coverage and local verification

- Perf self-checks: **209 PASS**, up from **184** (net **25** added checks). Internal-emission simulations of **0, 1, 2 and 7** callbacks before the probe all reach quiescent baselines and pass exact calibration. Coverage also includes delayed internal delivery resetting stability, missing probes even with many internal callbacks, wrong-client and simultaneous two-way swapped probes, duplicate probes, exact-match lookalikes, post-closure internal delivery both idle and during calibration, sustained trickling, a deadline clock jump, and an old probe arriving with or without a genuine calibration callback. Existing missing/extra/delayed calibration, asymmetric, model-expiry, fence, timeout/lifecycle, invariant and privacy negatives remain covered. The old bootstrap-extra rejection is intentionally superseded by arbitrary observed internal-emission acceptance; explicit extra probes still fail.
- The DB-free timeout probe's dummy counter now declares its actual bootstrap observed count **0** because its connect function is mocked and emits no bootstrap events. All its timeout/cleanup assertions are unchanged. Strict output checks reject nonnumeric, negative, fractional, oversized or unknown query/parameter/PID fields in the new diagnostic. Captured stdout/stderr checks exercise bootstrap and fence listeners and retain the one-aggregate privacy protocol.
- Full unit suite: **PASS, 206 files / 2557 tests / 0 skipped**, exit 0. Standalone TypeScript: **PASS**. Full lint: **PASS**, 0 errors and the same pre-existing unused-variable warning in `tests/unit/ai-service/selection-safety.test.ts:40`.
- Production build: **PASS**, exit 0. No dev server was found by the port-independent `pgrep -af '[n]ext dev'` check immediately before it. Actual Vitest file discovery matches HEAD exactly, **unit 206 / integration 6 / performance 1**, pairwise disjoint, without executing test modules or constructing DB clients. Discovery used synthetic dedicated-loopback URLs for config guards; normal integration execution remains NOT RUN. Direct no-opt-in performance execution exits **1** with only `OBS01 failure=OPT_IN_REQUIRED clients_constructed=0 fixture_writes=0`; missing/0/invalid opt-in, unsafe URL and Preview/Vercel guards also pass in the full self-check suite.
- Product code, finance, schema/migrations, ordinary unit/integration tests, dependencies, every Vitest config and workflow are unchanged. No stage, commit, push, CI trigger or Memory edit was performed; HEAD remains **d7e46e9**.

**Real PostgreSQL outcome for this final fix: NOT RUN until CI.** Actual emitted probe forms, real bootstrap quiescence, exact calibration, session independence, sampling and real fixture cleanup remain unverified locally. No benchmark or successful real-DB outcome is claimed.

## CI trial result — 2026-10-24 run 39983585312 (COMPLETE)

The final approved calibration cycle **SUCCEEDED**. This section records the orchestrator-verified CI evidence supplied for finalization. It supersedes the earlier pending/NOT RUN statements as the current trial result; the attempt histories and initial local NOT RUN aggregate remain unchanged as historical records.

- Run **39983585312**, job **obs01-perf**, conclusion **success**; PR **#54**, checked-out PR head **37e7db4**, checkout **fetch-depth: 0**. The source-identity check passed.
- Measurement environment: GitHub-hosted **ubuntu-26.04** runner, **PostgreSQL 16.15** service, dedicated loopback direct connection, **3 clients** (setup + measured A/B), **connection_limit 1 each**. Measurements use synthetic fixtures and do not establish production latency.
- Published report header: **status COMPLETE**, **failure N/A**, **cleanup PASS**, **self_checks 209**, **bootstrap_observed_A 1 / bootstrap_observed_B 1**; **utc_started 2026-10-23T16:05:53Z**, **utc_finished 2026-10-23T16:12:55Z**.
- Calibration: **8/8 rows**, both clients **A/B**, **3 repetitions each**, all **verified=true**, **attribution=true**, **late events 0**. SELECT has **explicit=1**, observed events **1/1** (min/max); COMMIT, ROLLBACK and INDEPENDENT each have **explicit=2**, observed events **4/4** (min/max).

### Completion and evidence boundary

The published **COMPLETE** status proves completion of all **50 cells / 62 report rows**: **44 single rows + 6 race cells × 3 rows** (WINNER, LOSER, PAIR). The report schema's strict `superRefine` in `contract.ts` requires exactly this matrix and exact planned cell/metric/outcome/effects/invariantScope values for every row. It also requires every row COMPLETE, warmups **5/5**, attempted/settled/valid **30/30/30**, exact planned fulfilled/rejected counts, cleanup **PASS**, wall and query statistics present, and every invariant **expected=executed=pass**, **fail=0**. The environment must have **databaseVerified=true**, **migrationVerified=true** and **independentSessions=true**. A violation throws **PROTOCOL → INVALID**, so this proof follows from the published report status, not merely the job's success conclusion.

**Eyeball-visible evidence:** the GitHub job-log display exposed detailed statistics for **44/62 rows**, all COMPLETE with cleanup PASS and invariant failures 0. **Schema-proven evidence:** the remaining **18 rows** were cut off by the display: INSUFFICIENT **6**, HELD-FUNDS INSUFFICIENT **6**, DUPLICATE UNPAID **3**, DUPLICATE PAID **3**. Their completion and required statistics are proven by the strict schema and COMPLETE header; their detailed numbers were not eyeball-visible and are not reconstructed here.

### Summary of eyeball-visible statistics

Wall p50 ranges below span the individual visible rows' p50 values for each scenario and n; they are not pooled percentiles or sample min/max values. Query ranges span those rows' observed query-event counts per call. Rows COMPLETE counts only the rows summarized in that table entry.

| Scenario | n | Wall p50 range (ms) | Query events per call | Rows COMPLETE (visible) |
| --- | --- | --- | --- | --- |
| NORMAL | 2 | 26.683–30.133 | 44–49 | 4/4 |
| NORMAL | 4 | 48.204–51.854 | 76–83 | 2/2 |
| NORMAL | 8 | 87.096–93.382 | 136–151 | 2/2 |
| SUBSET | 2 | 19.439–20.413 | 31–32 | 2/2 |
| SUBSET | 4 | 38.152–40.799 | 61–66 | 2/2 |
| SUBSET | 8 | 79.722–87.874 | 121–134 | 2/2 |
| FRAGMENTED | 2 | 30.258–31.664 | 47–50 | 2/2 |
| FRAGMENTED | 4 | 49.566–52.599 | 77–84 | 2/2 |
| FRAGMENTED | 8 | 86.703–93.057 | 137–152 | 2/2 |
| RETURN-HOLD | 2 | 20.616–22.255 | 32–33 | 2/2 |
| RETURN-HOLD | 4 | 39.241–41.315 | 62–67 | 2/2 |
| RETURN-HOLD | 8 | 81.023–83.692 | 122–135 | 2/2 |
| SAME-SUBMISSION RACE WINNER | 2 | 28.410–33.528 | 46–49 | 2/2 |
| SAME-SUBMISSION RACE WINNER | 4 | 49.799–50.417 | 76–83 | 2/2 |
| SAME-SUBMISSION RACE WINNER | 8 | 85.617–92.112 | 136–151 | 2/2 |

The table summarizes **32** visible rows. The other **12** visible rows are the six race LOSER and six PAIR rows, all COMPLETE. Each LOSER row reports **ApplicationNotPendingError**, **5 query events per call**, and fulfilled/rejected **0/30**; PAIR is a separate metric and is not presented as a per-call query count above.

### Observed scaling and remaining risks

For the successful-call and race-WINNER rows summarized above, wall p50 and per-call query-event counts grow as n increases from **2 → 4 → 8**. These are observations only: **no latency or query-count threshold was set, and no optimization work was entered**. The fixed five-event LOSER path is reported separately rather than generalized into that scaling observation.

- The log display truncated the 18 rows' detailed statistics. Their COMPLETE status is schema-proven; direct visual review of those numbers remains unavailable in the supplied evidence.
- Shared-runner noise, physical table/index growth, cache warming and autovacuum can affect observations. No overhead correction or production extrapolation is claimed.
- Synthetic fixtures on a dedicated loopback PostgreSQL service do not represent production workloads or production latency.

This finalization removes the temporary `obs01-perf` job, including its job-level concurrency, from `.github/workflows/phase2-integration.yml` while preserving `integration` byte-for-byte. The handoff/removal instructions below describe the historical trial procedure; the authorized removal is now applied in the worktree. No staging, commit, push or CI trigger is performed in this finalization.

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
