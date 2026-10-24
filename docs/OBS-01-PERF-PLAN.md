# Task

Iteration 6A — OBS-01 Performance Verification: execution plan for Iteration 6B.

- Date: 2026-10-23. Role: `$yaho-plan` only. Status: **awaiting 흥영's approval of SPEC + PLAN; implementation is not authorized by this document's creation**.
- Audited HEAD: `3e9fef51d1ff912c055ff7e7226dfc607c601ca9`, branch `feature/phase21-ai-service`; PR #54 Draft (PR context supplied by the user).
- Governing input: [OBS-01-PERF-SPEC.md](OBS-01-PERF-SPEC.md), especially Approval List A1–A6; [historical OBS-01](OBS-01-batch-confirm-perf.md) is supporting history with UNMEASURED estimates.
- This session delivers only this document. No implementation, DB access, tests/lint/build, workflow changes, staging, commit, push or CI invocation.

## Goal

Enable a `$yaho-build` developer subagent to measure the unchanged `confirmApplicationSubmissionCore` against a dedicated synthetic local PostgreSQL 16 database, with per-call wall time and observed Prisma query-event counts, while asserting every outcome and financial/selection invariant. Report descriptive aggregates; do not infer production latency, exact phase timings, optimization priority, an SLA or an improvement percentage.

6B starts only after 흥영 approves A1's SPEC and this PLAN. CI execution additionally requires an explicit **A2 or A3** choice and A4 publishing approval. With no CI approval, A1 permits the guarded local route only. A5 product instrumentation remains excluded; A6 expansion remains separately gated.

## Current State

- The core accepts an injected `$transaction` client and retains `maxWait: 10000`, `timeout: 20000`. It owns the measured transaction, including acquisition, waits, commit/rollback and JavaScript between queries. ADMIN action validation, its outer transaction, refresh, HTTP/RSC and rendering are outside this boundary.
- Device lookup is already outside the application loop. Source-operation counts and the old 200–600ms estimate are not measured SQL/latency results. No performance result exists in 6A.
- `vitest.config.ts` discovers only `tests/unit/**/*.test.ts`; `vitest.integration.config.ts` discovers only `tests/integration/reservation-applications/**/*.test.ts`. Neither discovery config, existing test file nor package script needs modification.
- Installed/locked Prisma CLI and client are 6.19.3; use existing dependencies. The product singleton has no query-event instrumentation and must remain unchanged.
- `.github/workflows/phase2-integration.yml` currently has default `pull_request` activities and `workflow_dispatch`, a single `integration` job, Node 20, `postgres:16` on loopback port 55432, dedicated synthetic DB/role, `npm ci`, Prisma generation, DB verification/role preparation, existing migration deployment and the normal integration command. It has no perf opt-in or dispatch input and no `workflow_call`.
- Current Git baseline has only modified `docs/OBS-01-batch-confirm-perf.md` and untracked `docs/OBS-01-PERF-SPEC.md`, with an empty index. Preserve both inputs byte-for-byte in this planning session.

## Data Model

No schema, migration, dependency, business-price, refund-policy or personal-data-field changes. Apply **existing** migrations only to the verified disposable service; never `db push`, `migrate reset`, global delete or truncate.

Use existing `User`, `Program`, `ClassSchedule`, `Child`, `ChildConsent`, `ReservationApplicationSubmission`, `ReservationApplication`, `ApplicationDevice`, `DeviceSubmission`, `DeviceChild`, `ApplicationDeposit`, `ReturnObligation`, `ApplicationReturn`, `FundAllocation`, `Reservation`, `Payment`, `PaymentItem` and `ReservationApplicationPaymentMapping` relationships.

DB FK/unique/CHECK constraints continue to enforce row relationships, required acknowledgments, Child/class uniqueness and one-to-one mapping uniqueness. They do not establish full ledger conservation, available-fund protection, selection isolation or correct concurrent outcomes: those remain unchanged server rules and explicit harness assertions. The harness neither weakens these constraints nor treats a constraint rejection as proof of a different expected domain error.

## API

No Route Handler, Server Action or public API changes. Invoke the real exported core directly with harness-owned Prisma clients and existing `ConfirmChoice` inputs. Use existing finance cores for deposit, resolution and return setup; direct Prisma writes are limited to owned synthetic prerequisites. No ADMIN-action or HTTP timing, production singleton replacement, transaction wrapper that changes semantics, mocked locks or mocked finance writes.

## UI

No UI or Server/Client Component changes. This is a Node-only test harness; no dev server, browser, app HTTP workload or Playwright installation is part of the benchmark.

## Implementation Order

The developer owns only the files below and, **only if chosen**, one CI route. Ordinary suites, product files (`app/`, `components/`, `lib/`, `server/`), schema/migrations, lockfile and scripts outside performance support stay untouched. Existing helpers may be imported read-only; do not extract helpers by editing integration tests. Each task has a verification gate before its dependents run.

| Order / dependency | Concrete 6B file task | Independently verifiable completion |
| --- | --- | --- |
| B1 / approval | `tests/performance/support/contract.ts`: typed scenario matrix, fixed safe labels/failure codes, aggregate/environment schema, nearest-rank aggregation and completeness accounting. Omit optional logical-operation and query-duration diagnostics from baseline. | Matrix enumeration is exactly 50 cells; pure checks cover p50/p95/max, separate outcomes, missing samples and aggregate-schema rejection. No raw samples in serialized types. |
| B2 / B1 | `tests/performance/support/sanitized-reporter.ts` and `run-guarded.ts`: a standalone Vitest reporter and guarded subprocess launcher, as specified below. | Deliberate assertion diff, query-shaped exception, uncaught rejection, startup/config failure and console canaries yield only fixed safe failures and nonzero exit. No default reporter or raw stream forwarding. |
| B3 / B2 | `vitest.performance.config.ts` and `tests/performance/support/environment.ts`: fail-closed gate, safe environment loading, URL/actual-server checks, metadata, three dedicated clients, serial config. | Missing/incorrect opt-in fails before constructing a client; unsafe/Preview/Vercel settings fail before fixtures; metadata exposes no URL or identity. |
| B4 / B3 | `tests/performance/support/fixtures.ts`: run manifest, deterministic prerequisites, per-fixture snapshots and dependency-ordered cleanup. | Each scenario fixture has the specified initial state; setup and cleanup use only the unmeasured client. A partial setup failure cleans everything already owned. |
| B5 / B3–B4 | `tests/performance/support/measurement.ts`: event-only counters, call/pair clocks, connection/event calibration and error classification. | Known commit/rollback calibration, independent-client attribution and absence of late events pass before any warmup. |
| B6 / B1, B4–B5 | `tests/performance/support/invariants.ts` and `self-checks.ts`: exact owned-row assertions, replay/rollback checks, assertion-execution counters and privacy/calibration negative probes. | Corrupted reduced facts fail each invariant with its fixed code. Removing one required assertion makes the sample fail completeness. Self-check failures abort measurement. |
| B7 / B1–B6 | `tests/performance/reservation-applications/obs-01.perf.ts`: sequential matrix runner, 5 warmups + 30 measured fresh fixtures per cell, intentional two-client race, stop/cleanup/report lifecycle. | Single-cell development verification is explicitly NOT RUN for the remaining matrix, never a full result. Final collection runs the complete fixed matrix without filters/retries. |
| B8 / local safety gates; chosen A2/A3 approval | Implement exactly the chosen workflow route below, if any. | Conditions, checkout SHA evidence, service isolation, install failure ownership and no unintended perf invocation are inspected before an authorized trial. |
| B9 / collection, QA and Review | Create `docs/OBS-01-PERF-RESULTS.md` and deliver a chat completion report. | Aggregate-only report includes completeness, environment, calibration evidence, correctness, regression counts, CI route/run context and limitations. No rewrite of the historical analysis or unsupported measured claim. |

### Config, connections and measurement calibration

1. Before loading env files or importing anything that constructs Prisma clients, require exact `YAHO_OBS01_PERF === "1"` and reject Vercel/Preview settings. Repeat gate/exclusion checks after `loadEnvConfig`; inherited and file-loaded `VERCEL_ENV` or `PLAYWRIGHT_PREVIEW_E2E=1` must fail. Catch existing guard errors and replace them with fixed codes: the reused URL guard's error messages can contain parsed host/database/user values and must never escape.
2. Reuse `assertSafeE2eDatabaseUrls` from `tests/e2e/support/db-safety.ts` for **both** variables. Require the existing dedicated loopback host/port/database/role policy. Before fixture writes, verify actual server major 16, expected database and current role using the same checks as `scripts/ci/verify-e2e-db.ts`; compare identity privately, publish only boolean verification and numeric version. Verify existing migrations are fully applied and nonfailed; pending/unknown migrations stop collection.
3. Dedicated config includes exactly `tests/performance/reservation-applications/obs-01.perf.ts`, Node environment, existing resolve aliases, one worker (`minWorkers=maxWorkers=1`), `fileParallelism: false`, no concurrent tests, no shuffling, no retries, no coverage/snapshot/default JSON/JUnit/blob output. Use the custom reporter exclusively, `silent: true`, and suppress intercepted user-console logs. Set outer per-cell timeout 1,200,000ms and hook timeout 120,000ms; these are harness limits, never latency acceptance thresholds. Core transaction budgets/options remain unchanged, including no new isolation override.
4. Construct three base clients after guards: one unmeasured setup/assertion/replay/cleanup client with `log: []` and two event-instrumented contenders. Pin each harness-only pool to `connection_limit=1`, `pool_timeout=10` seconds using a privately parsed guarded URL; recheck the derived URL. Record these numeric settings, not URLs. Ordinary cells use one contender; the second remains idle. Register `$on("query", ...)` on each measured base client before connecting, with only `log: [{ level: "query", emit: "event" }]`. Do not enable stdout Prisma query/error logs, DEBUG output or `$extends` in this baseline.
5. `$connect` all three before warmups. Use untimed numeric probes to verify the two contenders actually use different PostgreSQL backend sessions; retain only a boolean, never backend IDs. Record three clients/pools and one active measured call per client. A process/port-independent preflight must find no Next dev server, app server or other local test workload; otherwise do not benchmark until the conflicting workload ends. Do not kill unrelated processes.
6. Calibrate each measured client outside sampling: an explicit single raw numeric SELECT outside a transaction (one statement), a successful interactive transaction with two explicit numeric SELECTs, and a deliberately rolled-back transaction containing one raw update to an owned calibration Program and one numeric SELECT. Throw only a fixed calibration sentinel; privately verify the update rolled back with the unmeasured client. Repeat each calibration sequence three times, using unchanged transaction options. Count all emitted events; single SELECT must produce one event and transaction cases must cover at least their two explicit statements with reproducible totals.
7. While calibrating one contender, the other's active counter must remain zero. Also run a known pair of independent calibration transactions to verify attribution under concurrency. Record explicit-statement counts, observed min/max event totals, commit/rollback result, independent-session/counter pass and late-event check as aggregate evidence. Never inspect/log event SQL/params/target to classify transaction commands. Extra events above the known explicit statements are unclassified; do not claim a particular BEGIN/COMMIT/ROLLBACK was observed without evidence. Engine commands not exposed as query events remain outside coverage. This is **observed Prisma query-event count**, not a complete server statement audit.
8. For each primary invocation: enable/reset only its client counter, take `performance.now()` immediately before direct core invocation, settle fulfillment/rejection, then stop wall time and counter in `finally`. Count every event received during that window; no fixed transaction-control subtraction. Discard event payloads immediately without retaining SQL/params/target. Check for events arriving after settlement through the next event-loop turn before reusing that client; unexplained late events/missing coverage invalidate calibration/collection rather than being reassigned to another call.
9. Start both race calls through one external promise gate after both clients are ready. Pair wall time starts when the gate releases and stops after both settle; contender clocks each enclose their own full core call. Use `Promise.allSettled` and drain both calls before checks/cleanup. No sleeps, held locks, observers or barriers inside timed calls. Do not claim exact lock-wait duration or guaranteed overlapping lock acquisition. No optional pause-based overlap experiment is planned in baseline.

### Fixtures, matrix and bounded database state

Use two run-owned ADMIN actors and one run-owned Program (`defaultPrice=999999`, deliberately distinct from quotes). Every fixture has a new Submission, N applications, one future SCHEDULED class per child, capacity 8, distinct identities and deterministic zero-padded IDs ordered identically by the core and fixture builder. Use one captured run time and classes in the future relative to it; record no fixture dates/identities in output.

Quotes alternate **40,000 / 60,000** starting with 40,000, as the spec's existing test vectors. Required acknowledgments are valid; both optional submitted consent choices are false. NEW has no prior Child/consent; EXISTING has matching active/unpurged Children, requestedChildId binding and one older AGREED record for each optional consent type. Expected new records are PRIVACY/AGREED plus optional DECLINED in NEW and optional REVOKED in EXISTING, using stored submittedAt/version/actor. Preserve the prior records exactly. Primary fixtures have one device associated with the Submission, zero prior DeviceChild links; the extra NORMAL profile has no device. No token value/hash is ever output.

After capturing saved quotes, deliberately change live class prices to different valid positive fixture values before invocation (quote + 1,000); the stored quote remains authoritative. Deposit/hold/return prerequisites are committed before timing, using existing finance cores. Deposit ordering uses fixed strictly increasing confirmedAt values and IDs, independent of setup speed. Snapshot owned business fields and exact relevant child/consent/device/payment/ledger relationships in memory before timing. Exclude timestamp-derived UI projections from equality checks.

Run this fixed scenario order, then N ascending (2, 4, 8), then NEW followed by EXISTING where applicable. For NORMAL at N=2, run device-present then no-device for each mode. Do not rotate/randomize order or combine distributions.

| Scenario | Modes / N / profiles | Selected / expected primary outcome and fixture requirement | Cells |
| --- | --- | --- | --- |
| NORMAL | Both / 2,4,8 / one device, one exact-total deposit, no hold | N; committed success. Extra no-device NORMAL only at N=2 in both modes, separately reported. | 6 + 2 |
| SUBSET | Both / 2,4,8 / one device, deposit for all N, no hold | First N−1; success; last sibling SUBMITTED, wholly untouched, remaining A equals last quote. | 6 |
| FRAGMENTED | Both / 2,4,8 / one device, two deposits, no hold | N; success; first deposit 30,000 then remaining total; first 40,000 charge spans both, exact FIFO backing asserted. | 6 |
| RETURN-HOLD | Both / 2,4,8 / one device, deposit for all N | Last sibling REJECTED, hold funded for its full quote and actual 20,000 partial return already recorded. Select N−1; success, A=0, existing R/T protected. N=2 ends D100000=A0+P40000+R40000+T20000. | 6 |
| SAME-SUBMISSION RACE | Both / 2,4,8 / NORMAL device-present profile | N, identical choices, independent ADMIN actors/clients; exactly one success and one `ApplicationNotPendingError`; one Payment/set of links. | 6 |
| INSUFFICIENT | Both / 2,4,8 / one device, no hold | N; deposits = quote total − 1; `InsufficientApplicationDepositError`, full rollback. | 6 |
| HELD-FUNDS INSUFFICIENT | Both / 2,4,8 / one device, funded hold, no actual return | Last sibling REJECTED, D = all N quotes − 1; select N−1. Gross D covers selected charges but A = selected total − 1; `InsufficientApplicationDepositError`, full rollback. | 6 |
| DUPLICATE UNPAID | EXISTING only / 2,4,8 / one device, sufficient exact-total deposit | N; last ordered selected Child/class has a prior RESERVED Reservation without PaymentItem. `DuplicateReservationError`; preserve that reservation and roll back earlier work. | 3 |
| DUPLICATE PAID | EXISTING only / 2,4,8 / one device, sufficient exact-total deposit | N; last selected Child/class has a prior paid reservation; `ApplicationPaymentAlreadyExistsError`; original Payment/Item preserved, no new success effects. | 3 |

Total **50 cells**, including six race cells. Every cell has exactly **5 warmups + 30 measured fresh fixtures**; races use pairs instead of single calls. Thus a complete baseline has 250 warmup fixtures/pairs and 1,500 measured fixtures/pairs; primary core calls are 280 warmup and 1,680 measured because each race pair calls twice. Replay probes, calibration and self-checks are additional **unmeasured** operations. No primary sample reuses a confirmed submission. Warmups execute all applicable assertions but never enter measured statistics.

Every sample follows `prepare → snapshot → invoke → assert/replay → cleanup → verify cleanup`. Retain only shared run roots (two admins/one Program) between fixtures. In-memory manifests register every root before creating dependent rows and discover core-created rows through exact owned submission/class/child relationships. Never use broad prefix cleanup of potentially unowned rows or global counts as the only proof.

Cleanup in FK order: owned FundAllocations, ApplicationReturns, ReturnObligations, ApplicationDeposits; mappings; ChildConsent and device links; applications; any owned Refunds, PaymentItems and Payments (including duplicate-paid prerequisites); reservations; submissions/devices; Children; classes. Clean run Program/admins last after all fixtures. Filter every delete by manifest ownership and validate no owned rows remain. Inspect schema FKs while implementing, preserving this dependency order. There are no Refund fixtures in baseline; assert the core creates none.

Run cleanup in `finally` for setup failures, expected rejections, unexpected errors and invariant failures. Stop subsequent cells if cleanup fails. Drain outstanding race calls first. If the process/runner is terminated before cleanup, report cleanup UNKNOWN and INCOMPLETE; do not resume on a possibly contaminated DB. A fresh disposable service is required for a later full run. Physical table/index growth, cache warming and autovacuum can still affect timings despite row cleanup; disclose them without global resets/vacuum tweaks.

### Sanitized aggregate reporter and guarded launcher

The reporter must implement the installed Vitest reporter interface directly, without inheriting a default reporter that prints diffs/stacks. The perf suite sends only a typed aggregate record through task metadata; individual timing arrays and raw database snapshots stay in worker memory. Use fixed safe test titles, invariant codes and allowlisted outcome labels. Match expected errors by real exported classes; unexpected exceptions become `UNKNOWN_INFRASTRUCTURE`, never `.message`, `.stack`, `.meta`, `.cause` or constructor text.

`run-guarded.ts` is an output-safety boundary within the approved support directory. It checks opt-in/exclusions, suppresses verbose Prisma DEBUG settings and launches the spec's Vitest command as a child with stdout/stderr pipes, no shell interpolation and no raw stream forwarding. Its fixed child argv is `vitest run --config vitest.performance.config.ts` through the locally installed executable. A startup/config error can occur before a custom reporter loads; the launcher therefore drains both streams privately, accepts only the versioned aggregate protocol from the custom reporter, validates all keys/labels/types/finite numeric bounds, and emits newly serialized allowlisted aggregates only. Unknown/malformed output, missing final record or nonzero child status produces a fixed safe failure and nonzero launcher exit. Bounded buffers must never spill to disk or a console fallback.

The same launcher has one fixed `--prepare-db` mode for the new perf setup: after opt-in/exclusions and both URL guards, invoke the existing verify, role-preparation and migration-deploy commands in that order through private child pipes. Verify actual identity before either mutation command. Forward only fixed per-step status/counts; suppress existing scripts' identity-bearing success/error text and migration diagnostics. No arbitrary command argument is accepted. Use `YAHO_OBS01_PERF=1 npx --no-install tsx tests/performance/support/run-guarded.ts --prepare-db` for these steps locally and in the chosen new perf job, after install/generate. The existing integration job and scripts themselves are unchanged. Preparation does not create performance samples; collection independently revalidates identity/migrations.

Reporter and launcher both prohibit SQL, parameters, event payloads, exception serialization, fixture row IDs/snapshots, Child/guardian data, capability/idempotency tokens or hashes, bank/account fields, usernames, URLs/credentials and env dumps, including synthetic values. Filter arbitrary environment strings to expected OS/version/CPU/runner metadata; do not serialize an environment object. No raw samples, traces, snapshots, default Vitest output files, log uploads or raw JSON fallback. A failure remains a failing exit even if a safe partial aggregate is available. Privacy self-checks inspect both process streams in memory and expose only pass/failure counts; a privacy failure blocks collection/publication.

## Execution Procedure

### Guarded local route — A1

1. Recheck source SHA/branch/diff, approval record and absence of out-of-scope changes. Record audited source SHA separately from the **new harness SHA/revision actually executed**. Capture normal unit/integration baseline counts before adding the harness during 6B; no such executions occur in 6A.
2. Provision the same dedicated disposable PostgreSQL 16 service as the integration workflow with port 55432. Populate the two guarded URL variables privately; no remote, Preview or Production fallback. Verify actual identity before preparation. Install existing locked dependencies, generate Prisma, prepare existing NOLOGIN roles and run only `prisma migrate deploy` against that guarded service, following the existing integration recipe. Setup output must use fixed status labels without connection data; unsafe guard diagnostics must be sanitized as above. No new product seed or migration.
3. Verify no competing dev/app/test workload and record allowed environment metadata. Run harness self-checks/calibration before warmups. Missing tooling/DB or a failed install/migration means NOT RUN for all untouched cells; do not substitute mocks for measured results.
4. Use the **guarded publishing entrypoint**:

   ```sh
   YAHO_OBS01_PERF=1 npx --no-install tsx tests/performance/support/run-guarded.ts
   ```

   The child executes the spec's measurement command, `YAHO_OBS01_PERF=1 npx vitest run --config vitest.performance.config.ts`, with the same boundaries, matrix and repetitions. The wrapper adds output protection for Vitest startup failures; it changes no measured core behavior. Bare Vitest invocation must also fail closed without opt-in, but use the wrapper for collection/publishing so pre-reporter errors cannot leak. Do not add this to `npm test` or normal integration discovery.
5. One complete fixed-order run; no automatic retries, outlier trimming or merging samples across invocations. Preserve slow valid samples. If interrupted/invalid, retain safe partial status and actual counts, stop and report; an explicit later rerun is a new run, never a patch to an old cell.

### CI routes — 흥영 must choose A2 or A3, or local-only

**Recommendation: A2, add a separate opt-in `obs01-perf` job to the existing workflow.** It can depend on the existing integration result while getting its own clean service and runner. This reuses the established event/setup pattern and avoids a second workflow's registration and trigger lifecycle. It does duplicate dependency/setup work for isolation, and the temporary job must be removed after trial. A3 offers a separate visible workflow/lifecycle, at the cost of duplicated recipe maintenance and an additional normal integration run. This recommendation is not approval.

**Common approved trial envelope for either CI route:** only PR **#54**, exact head branch **`feature/phase21-ai-service`**, head repository equal to the current repository, and only `pull_request` **opened / reopened / synchronize**. Draft PRs are eligible; no ready-for-review, label, `pull_request_target`, schedule, push-to-every-branch or automatic default-branch perf run. No new dispatch input is proposed in either trial. A branch push can trigger synchronize, but this session/plan approval does not grant stage/commit/push authority.

Use this job condition (A2 additionally requires successful `integration` via `needs`):

```yaml
if: >-
  github.event_name == 'pull_request' &&
  (github.event.action == 'opened' || github.event.action == 'reopened' || github.event.action == 'synchronize') &&
  github.event.pull_request.number == 54 &&
  github.event.pull_request.head.ref == 'feature/phase21-ai-service' &&
  github.event.pull_request.head.repo.full_name == github.repository
```

Do not add `branches:` as a head-branch filter: it filters the PR base. The exact head/PR/repository job condition is the trial opt-in. Use `permissions: contents: read`, a standard `ubuntu-latest` runner, no paid runner/service, a 60-minute perf-job resource cap and a PR-specific concurrency group with `cancel-in-progress: false` so new pushes do not intentionally truncate an active sample run. Jobs use their own ephemeral `postgres:16`, existing synthetic service credentials supplied only to the environment, port 55432 and existing health check. No browser installation, APT, app server, artifact upload or new cache system.

Before an authorized trigger, verify Actions minutes/storage allowance and existing queued runs read-only. Quota is **UNVERIFIED in 6A**; inability to verify available allowance stops CI, with local-only as the approved A1 fallback. No paid overage is approved. Do not trigger repeated runs to diagnose installation/mirror problems silently.

| Decision detail | A2 — existing workflow, recommended | A3 — alternative new workflow |
| --- | --- | --- |
| File / event changes | Edit only `.github/workflows/phase2-integration.yml`. Retain existing `pull_request`/`workflow_dispatch` declarations and ordinary integration job/command; add no activity types or inputs. Add `obs01-perf` with `needs: integration` and the exact condition above. Failed/skipped integration means no perf collection. | Add only `.github/workflows/obs-01-performance.yml`, named `OBS-01 PostgreSQL Performance Trial`. Declare `pull_request.types: [opened, reopened, synchronize]`, no paths/base-branch filter, and the exact job condition above. Leave `phase2-integration.yml` unchanged. No `workflow_call` refactor. |
| Setup / sequence | New job repeats checkout, Node 20/npm cache, locked `npm ci`, Prisma generate and the guarded launcher's `--prepare-db` mode on **its own** service. Then run the guarded collection command; opt-in is scoped to these two explicit preparation/collection steps. No ordinary integration workload on this runner. | One dedicated job copies the same service/setup recipe including guarded preparation, then runs the unchanged normal integration command to completion before guarded perf. Opt-in is scoped only to preparation/collection. This duplicates normal integration CI work, but ensures it precedes collection without a cross-workflow dependency. The benchmark gets no concurrent workload on its runner/DB. |
| Install behavior | Existing integration `Install dependencies` remains plain `npm ci` with no ignored failure. In the new perf job bound its separate `npm ci` step to 10 minutes, with no retry/continue-on-error; failure stops setup and marks perf NOT RUN. | Same bounded plain `npm ci`, no ignored failure/retry; no Playwright or APT recipe. Failure/timeout is setup infrastructure, never a financial/invariant failure or latency sample. |
| Perf checkout | New perf job explicitly uses `actions/checkout@v4` with `ref: ${{ github.event.pull_request.head.sha }}`. Existing integration checkout is unchanged. | Dedicated job explicitly checks out the same PR head SHA before its integration precheck and perf. |
| Publishing | A4: guarded launcher appends aggregate Markdown to `GITHUB_STEP_SUMMARY` and prints the same allowed status/aggregate content. No uploads. | Same A4 behavior; no artifact step. |
| End of trial | After the first complete trial and QA/Review report, developer removes the temporary `obs01-perf` job and its new concurrency configuration; ordinary integration is restored to its previous behavior. Record trial SHA/run and removal diff. If trial fails, report before any subsequent run; removal remains required before closing 6B. | After the same trial/report, delete the temporary workflow in the proposed removal diff. No permanent PR trigger is implied. Keeping it for future use requires a separate explicit decision. |

The **merge-ref caveat is part of result identity**: existing PR checkout without `ref` normally uses the synthesized merge ref. A2's integration prerequisite may therefore test a merge SHA, while its perf job intentionally measures the exact PR head. Record both job SHAs when available; never describe merge-ref results as pure audited `3e9fef5` results. For every perf run record PR head SHA from the event, actual checked-out SHA from `git rev-parse HEAD`, checkout mode (`HEAD` or `MERGE_REF`), audited source SHA, harness/config revision and clean/dirty flag **before result-file writes**. Verify actual perf checkout equals requested head or stop as source mismatch. Local uncommitted harness runs require a content digest of harness/config plus dirty flag, not a misleading clean-HEAD claim.

`workflow_dispatch` availability is not inferred from a YAML declaration. CLI/API dispatch requires default-branch workflow registration; that registration has not been checked here. A new PR-only A3 file cannot be dispatched simply with `--ref`. A3 intentionally uses approved PR events before merge and proposes **no dispatch in the temporary file**. Any later permanent workflow/manual-dispatch registration must first be approved, land on the default branch through authorized SHIP, and have registration verified read-only. A2's existing dispatch remains integration-only under the PR-only job condition. Do not create both routes, add a perf dispatch input or change default-branch triggers implicitly.

CI trial publication, an actual trigger and later removal publication require the independently authorized Git/SHIP actions; prepare those concrete diffs without committing/pushing in this planning session or treating plan approval as Git permission. Neither option changes E2E/Preview/Production workflows.

## Tests

These are **planned 6B checks**, not executions or QA/Review verdicts in this session. Build implements/tests the harness; `$yaho-qa` and `$yaho-review` subsequently inspect without edits, one role at a time. Their issues return to `$yaho-build`.

### Requirements → assertion coverage

| Requirement / ADR basis | Required result | Normal / rejection or contention case | Level | Planned location / existing evidence |
| --- | --- | --- | --- | --- |
| SPEC invariants; Phase 20 funds; ADR-060 | D=A+P+R+T, all nonnegative; each deposit's allocations ≤ its amount; exactly one target per allocation; mapped funding exact | Every warmup/measured success and rejection; FRAGMENTED and RETURN-HOLD make backing/protection non-vacuous | Direct-core integration on real PG | `invariants.ts`, importing `validateLedgerAllocations` from `lib/reservation-applications/ledger.ts` and `summarizeDetailLedger` from `ledger-summary.ts`; reference existing `confirmation-atomicity.test.ts` ledger/FIFO/hold assertions |
| Phase 20 actual deposits / returns; ADR-060 | New P equals selected saved quotes and does not exceed prior A; existing holds/returns unchanged | INSUFFICIENT and HELD-FUNDS INSUFFICIENT refuse with exact class and unchanged state; RETURN-HOLD protects R/T | Integration | `fixtures.ts`, `invariants.ts`, perf matrix; existing atomicity sufficient-D/insufficient-A and return cases |
| REQUIREMENTS 10.1/10.4, Phase 20; ADR-001/003/060 | One Payment per batch; exactly one distinct Reservation/Item/Mapping per selected app, all correct links and quotes, zero discount/refund; no extra links | NORMAL/SUBSET; DUPLICATE UNPAID rolls back earlier writes, DUPLICATE PAID preserves old money | Integration | `invariants.ts`, matrix; existing `confirmation-atomicity.test.ts` subset/linkage/duplicate/late-write cases |
| Phase 20 stored quote; ADR-063/064 | Every app's quotedAmount unchanged; items use saved quote despite live price changes | All success cells, before/after quote equality in rejections | Integration | `fixtures.ts`, `invariants.ts`; existing `price-recheck.test.ts:173–183` is submission evidence, not a substitute for confirmation assertions |
| Phase 20 privacy/consent; ADR-054/055/058 | Only selected children confirmed; unselected/rejected siblings' stored fields, links, consent/device state unchanged | SUBSET and RETURN-HOLD; NEW exact creations; EXISTING personal data and prior consent preserved; no new effects on rejections | Integration | `invariants.ts`; existing atomicity Child preservation/rollback assertions plus additional per-sample consent/device coverage |
| Phase 20 serialization, ADR-060 | Exactly one winner/one `ApplicationNotPendingError`, one committed Payment/link set; replay cannot confirm again | SAME-SUBMISSION RACE; unmeasured replay after **every success**, including race winner, preserves all committed row/link facts | Integration / real independent sessions | `measurement.ts`, `invariants.ts`, perf file; reference existing atomicity two-admin and response-loss tests, without importing their `.test.ts` helpers |
| SPEC metric boundary/calibration | Accurate event ownership, control-command caveat, commit/rollback included in wall boundary; no fixture/assertion/replay/cleanup queries counted | Known commit/rollback/independent transactions, idle client and late-delivery probes | Harness checks + real PG | `measurement.ts`, `self-checks.ts` |
| SPEC fail-closed/output / ADR privacy boundaries | No DB client without opt-in; no SQL/params/PII on any stream, summary or report | Missing/0/other opt-in, unsafe URLs, pre/post-env Preview flags, canary diffs/errors/console, unhandled and startup errors | Harness subprocess / config checks | `environment.ts`, reporter, launcher, `self-checks.ts`; probes compare canaries privately and emit only counts |
| SPEC unchanged ordinary suites | Same discovered files, executed unit/integration counts, skip counts and outcomes before/after harness | No perf opt-in in ordinary commands; perf code never imported or fixtures constructed by them | Unit + integration regression | Unchanged `vitest.config.ts`, `vitest.integration.config.ts`, existing suites; baseline and post-build counts recorded by Build/QA |
| Existing ADMIN and refund boundaries | Authorization and finance/Refund/Revenue meaning preserved | Existing non-ADMIN action tests and refund/Revenue atomicity tests remain passing | Existing unit/integration reuse | `tests/unit/reservation-applications/admin-actions.test.ts`, `phase20-finance.test.ts`, existing `confirmation-atomicity.test.ts`; direct core is not evidence of HTTP/ADMIN authorization |

Class teacher allocation, unrelated capacity/retention/UI flows and browser behavior are not new benchmark cells. They remain covered by existing suites; baseline keeps valid future classes, capacity 8 and active/unpurged children. Do not expand their tests or use a UI assertion as server-rule proof. E2E is N/A for this direct-core measurement; no Preview/Production execution is authorized.

### Per-sample assertion execution gate

Define a fixed invariant checklist with safe codes: `LEDGER`, `AVAILABLE_BACKING`, `EXACT_LINKAGE`, `SELECTION_ISOLATION`, `FIXED_QUOTES`, `NO_RECONFIRMATION`, `HELD_FUNDS`, `CHILD_STATE`, `CONSENT_APPEND`, `DEVICE_SCOPE`, `NO_REFUND`, `ROLLBACK_STATE`, `FIFO` and `RACE_SINGLE_WINNER`. Each sample records expected/executed/pass/fail counters for its applicable codes. Rejection samples assert unchanged exact pre-state and ledger, not an impossible success linkage; success samples include the unmeasured replay check. Race assertions apply to the pair's final state/winner and prove no second effects from the loser, rather than requiring the loser's final DB state to equal pre-winner state.

Only after all expected codes execute and pass does the sample become valid. A missing assertion, swallowed exception, zero executed assertions or skipped warmup check fails completeness. Per-code expected/executed/pass/fail totals distinguish warmups, measured samples/pairs and self-checks. Do not increment a whole checklist merely because one helper was called. Mutation self-checks deliberately falsify each reduced fact and remove a checklist entry to prove both the assertions and execution gate fail. No result objects/diffs leave memory.

### `$yaho-qa` gates

1. Confirm exact 50-cell enumeration, profiles, selected counts, 5/30 repetitions and six independently connected race cells. Verify full tests use real core/PG and preserve transaction options. Inspect actual calibration aggregates and rollback evidence; a mocked event or inferred source count is insufficient.
2. Independently inspect per-sample assertion flow and expected/executed counters, including warmups, error rollback, race winner/loser and success replay. Use self-check negative evidence to establish assertions fail for broken facts; aggregate test totals alone cannot prove coverage.
3. Exercise absent opt-in (`env -u YAHO_OBS01_PERF`), value `0`, invalid value, unsafe URL and Preview/Vercel cases through launcher and dedicated config. Require nonzero exit, safe code, zero constructed clients/fixture writes before the relevant guard. No unsafe metadata printed even when the existing guard throws.
4. Validate both stdout/stderr, job-summary and report serializers with query/params/PII-shaped canaries, assertion failures, raw Prisma errors and unknown infrastructure failures. Missing/malformed final aggregate or a child failure cannot exit 0 or publish COMPLETE.
5. Compare same-source pre/post Build discovery and actual execution counts for `npm test` and the guarded normal integration command: file/test/skip counts must be unchanged, no perf import or opt-in introduced. Capture baselines during 6B rather than adopting an older report's totals. Unavailable integration execution is NOT RUN, not unchanged/PASS by inference from globs alone.
6. Check every fixture/failure cleanup and bounded owned-row counts; reject a run with leftover/unknown cleanup. If CI is used, inspect exact condition/checkout/run identity and install/setup outcomes. An incomplete measurement or missing required check cannot receive a blanket verification PASS.

Build runs appropriate existing `npm run lint`, `npm test`, normal integration, and build verification. Before `npm run build`, use a port-independent Next-dev process check per AGENTS.md; if dev exists, skip build, run typecheck/lint/test instead and disclose the substitution. Benchmark collection itself also waits for all dev/app/test activity to end. Required current checks are not claimed executed by this docs-only session.

### `$yaho-review` focus after QA

- Scope diff: only approved performance harness/config/support, results doc and **one chosen** CI route; no product files, existing tests/configs, package/lockfile, schema/migrations or finance changes. No A5 spans or optional diagnostics silently added.
- Output discipline: SQL/params/PII cannot escape events, guard errors, assertion diffs, uncaught/Prisma errors, console, startup failure, streams, metadata, task serialization or summary. No raw samples/files/artifacts or exception fallback. Only fixed labels, allowed metadata and aggregate numbers.
- Finance semantics: actual-deposit backing, protected returns, stored quotes, exact Payment/Item/Mapping linkage, consent append-only behavior and lock/transaction semantics remain intact. No speed result can excuse a weaker invariant, altered error class or reduced assertion coverage.
- Correct metric attribution, independent clients, calibration limitations, no outlier removal/silent retries, actual checkout identity, normal-suite regression evidence and removal of the temporary CI opt-in. Verdict is PASS or CHANGES_REQUIRED; corrections return to Build.

## Result Reporting Format — 6B completion

Write `docs/OBS-01-PERF-RESULTS.md`; deliver its link and the same aggregate conclusions in chat using AGENTS.md Changed / Tests / Lint / Build / Risks / Next format. If A4 is approved, put the same sanitized aggregates/environment/status in the CI job summary. **No uploaded artifact** is proposed; any future upload needs separate A4 approval of format, step and retention. No external APM or raw diagnostic logs.

Each run gets an independent environment block:

```text
status: COMPLETE | NOT RUN | INCOMPLETE | INVALID
utc_started / utc_finished:
audited_source_sha / pr_head_sha / checked_out_sha / checkout_mode:
source_clean_or_dirty_before_report / harness_config_revision_or_digest:
execution_route: LOCAL | A2 | A3
ci_run_id / attempt / integration_checked_out_sha: numeric/SHA or N/A
runner_class / runner_os_image_and_version / cpu_model_and_count / memory_class:
postgres_actual_version / node_actual_version / prisma_cli_and_client_versions:
migration_revision / migration_verification:
topology: dedicated loopback direct PostgreSQL, no pooler/remote service
pool_count: 3; connection_limit_each: 1; pool_timeout_seconds: 10
transaction_options: maxWait_ms=10000, timeout_ms=20000, isolation=unchanged default
clients: setup=1, measured=2; active_nonrace=1, race=2
warmups_per_cell_or_pair: 5; measured_per_cell_or_pair: 30; planned_cells: 50
scenario_order_and_profile_definition_revision:
device_profiles / consent_history_profiles / deposit_and_hold_profile_counts:
calibration_summary / event_coverage_caveat / instrumentation: event counters + clocks
setup / cleanup / quota_verification: safe statuses; no account or connection values
```

Use actual versions/hardware, not `Node 20` / `postgres:16` / `ubuntu-latest` as substitutes. Calibration has a small table: client role, known explicit statements, calibration repetitions, observed event min/max, commit/rollback assertion, independent attribution and late-event pass/fail. Client roles are fixed labels, not connection IDs. Record engine/control visibility limits, instrumentation presence and absence of overhead correction.

Aggregate table (one row per scenario/N/mode/profile/outcome; no mixing outcomes or environments):

| Scenario | N | Selected | Mode | Device / consent history / deposit / hold profile | Outcome / metric | Status | Warmups completed | n / expected | Wall ms p50 / p95 / max | Query events min / p50 / p95 / max | Fulfilled / rejected + allowlisted error totals | Effects asserted | Invariants expected / executed / pass / fail | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<fixed label>` | `2/4/8` | `N or N−1` | `NEW/EXISTING` | `<fixed profile labels>` | `<success or exact error class>` | `<status>` | `0..5` | `0..30 / 30` | `<aggregate or N/A>` | `<aggregate or N/A>` | `<counts>` | `COMMIT / ROLLBACK / SINGLE_COMMIT` | `<counts>` | `PASS / FAIL / UNKNOWN` |

Race cells have three rows: winner call (n=30), loser call (n=30), pair wall time (n=30 pairs). Pair query columns are N/A; query counts belong to separately attributed winner/loser calls. Pair outcome counts must show 30 fulfilled + 30 expected rejected and exactly 30 committed confirmations. Do not pool winner and loser timings. Invariant counts are pair-level for shared final-state checks and labelled accordingly, never doubled to imply independent duplicate execution.

For every complete distribution, sort all 30 measured values and use nearest rank: p50 = observation 15, p95 = observation 29, max = observation 30; use the same rule for query events. Keep integer query counts and consistently display wall ms to three decimals without altering underlying samples. Warmups, setup, assertions, replay and cleanup are excluded; slow valid samples remain included. Include fulfilled/rejected totals, exact expected error-class counts and per-code assertion totals alongside cell rows.

- **NOT RUN:** no primary calls in a cell (e.g. unavailable DB, install failure, opt-in denied, integration prerequisite failed, quota unknown). Show n=0, stats N/A and a fixed reason code; never zero milliseconds or PASS. Explain if execution was not authorized.
- **INCOMPLETE:** any of five warmups or thirty measured samples/pairs missing, harness/runner timeout or cancellation, missing environment/calibration evidence or unknown cleanup. Show actual attempted/settled/valid measured counts and warmup counts; p50/p95/max columns N/A for that cell, no complete p95. A core-call transaction/connection timeout is instead an unexpected call error and makes its cell INVALID. Do not combine partial runs or extrapolate.
- **INVALID:** wrong error/outcome, invariant/calibration/privacy/source-identity failure, unknown infrastructure call error or zero/two race winners. Keep safe failure counts and actual n; stats N/A for invalid cells. Any previously completed rows may remain clearly labelled descriptive observations from an overall invalid/stopped run, never a successful baseline.
- **COMPLETE:** only when every planned cell has all warmups and 30 valid measured samples/pairs, calibration/environment/correctness/cleanup gates pass and no samples are excluded. Correctness completeness is distinct from QA/Review and ordinary check status; no performance threshold is introduced. Before collection, report no numerical benchmark result.

## Acceptance Criteria

1. SPEC matrix, N=2/4/8, modes, profiles, five warmups/thirty samples and core/transaction boundaries are unchanged. All primary calls use real PG; calibration demonstrates observed query-event coverage and attribution.
2. Every sample's applicable assertions actually execute; financial/selection/device/consent/replay/rollback/race checks pass. Expected rejections are measured as their own outcomes, never treated as setup errors or mixed with success.
3. Harness/config/support are opt-in only and output-safe on success, failure and startup. Normal unit/integration discovery and actual execution counts remain unchanged and verified in 6B.
4. Results carry environment, actual checkout identity, completeness and calibration caveats, land in docs/chat and only approved aggregate CI summary. No product code/semantics/instrumentation or unchosen workflow is changed.
5. A chosen CI trial is isolated, uses the exact approved event/branch/repo/PR condition and has a concrete removal diff after the trial. Incomplete/invalid runs stop and report; they do not silently retry, expand scope or claim PASS.
6. Independent QA/Review gates finish in order; any necessary fixes use the Build role. Staging/commit/push/merge and any further scope are separately authorized, not assumed from this plan.

## Risks

| Risk | Mitigation / reporting rule |
| --- | --- |
| Shared-runner timing noise, machine/image drift, scheduling and cache effects | Isolated DB/runner workload, recorded actual environment, fixed order and full samples. No outlier trimming, SLA claim or production extrapolation. Compare only separately identified runs; do not attribute differences to product changes without evidence. |
| Iteration 5 mirror/install flakiness | `E2E_CI_ITERATION_5_REPORT.md` final supplement identified APT mirror slowness during Playwright `--with-deps`, not proof of DB/core slowness. Phase 2 integration currently uses plain `npm ci` and no browser/APT step. Reuse that distinction; bound the new perf install step, retain failing exit, no retries/ignored failures/new mirror or cache workaround. An install/service/setup failure produces NOT RUN, never a timing sample. |
| DB state growth across 35 repetitions in every cell | New fixture per call/pair, immediate manifest-scoped cleanup and residue check; only run roots persist. Stop on cleanup failure. Disclose physical bloat/autovacuum/cache noise even when live-row counts are stable. No global reset/truncate or production cleanup. |
| Race determinism vs natural contention | Independent connected sessions/counters, one external release gate, known actors and identical selection; assert one exact winner/loser. No timed sleeps/barriers. Scheduler may serialize starts; label simultaneous-start contention, do not invent lock-overlap or lock-wait evidence. Unexpected outcomes invalidate the cell. |
| Query-event coverage and delivery | Known independent commit/rollback calibration, raw statements included, per-client windows and late-event checks. Count all observed events; engine commands not emitted cannot be counted, and transaction-command labels are unclassified without evidence. No subtraction to match static operation counts; never call this a complete server audit. |
| Reporter/config/unhandled error leaks | Custom aggregate-only reporter plus guarded child streams, fixed codes, schema validation and canary negative probes. No raw fallback; stop collection/publishing if the boundary cannot be demonstrated. |
| Resource/runtime limits and Actions quota unverified | Existing standard runner/service only; 60-minute job cap is a resource bound, not a performance target. Verify allowance before CI, no paid overage. Job/harness interruption is INCOMPLETE; unexpected core timeout is INVALID. No reduced repetitions or undisclosed retry to fit quota. Local-only remains available under A1. |
| PR merge-ref/head drift or harness dirtiness | Explicit head checkout in perf jobs, actual SHA verification, source/harness revision metadata and pre-report dirty flag. A later source change requires rechecking compatibility; product changes needed to make measurement possible cause STOP. |

## Explicit Stop Conditions

Stop further sampling and report safe counts/status immediately on **any invariant failure**, missing invariant execution, wrong outcome/error, calibration/attribution failure, privacy/output failure, source mismatch, unknown infrastructure failure or uncertain/failed cleanup. Finish/drain in-flight calls and attempt only owned cleanup; do not hide the failure or silently continue other cells.

If Build discovers **any need to edit product code**, finance/locking/transaction behavior, product spans (A5), existing tests/discovery, schema/migrations/dependencies, or anything beyond the approved A1 plus chosen CI/A4 scope, stop and report the concrete requirement to 흥영. Do not implement a workaround, weaken an assertion, change sample counts, add a workflow or take remote/Preview/Production measurements. Revised scope needs approval and role-correct planning before Build resumes.

No raw diagnostics are an exception to output discipline, even for debugging an invariant. No elapsed time, recommendation or absent reply constitutes approval. A6 covers optimization, paid services/overage, new policies/targets and other later scope.

## Spec issues found

No measurement-design inconsistency found requiring a SPEC change. The matrix expands to 50 cells with six race cells; pair metrics create additional report rows, not additional scenario cells. Optional-consent history, routine support filenames, output wrapper and numeric pool settings above make implementation concrete within the specified scope. CI route choice, A4 publishing and actual quota/default-branch-registration facts remain explicit approval/pre-execution items, not unresolved business requirements or permission to redesign the measurement.

## Approval checklist — 흥영's 6B kickoff

An approval must identify these items explicitly; approval of this document without a CI choice authorizes only the A1 guarded local route.

- [ ] **A1 — SPEC + PLAN:** approve `OBS-01-PERF-SPEC.md` and this PLAN's exact test-only matrix, 5+30 counts, fixtures, safety/output/correctness requirements and guarded local execution. Authorize a `$yaho-build` developer subagent to implement only the listed harness/config/support, perform checks/measurements and create the aggregate results doc, followed by QA then Review.
- [ ] **Choose exactly one CI scope:** **local-only** (no workflow edits/invocation), **A2** (recommended temporary opt-in job in `phase2-integration.yml`, including exact PR #54/head-branch/repository/events, explicit perf head checkout, new job install/resource/concurrency limits and post-trial removal), or **A3** (alternative temporary `obs-01-performance.yml`, its exact triggers/setup/integration-before-perf/head checkout and deletion). Neither route is implied by the recommendation; both are never created together.
- [ ] **A4 — publishing:** approve aggregate results in `docs/OBS-01-PERF-RESULTS.md` and chat; if choosing CI, explicitly approve aggregate-only `GITHUB_STEP_SUMMARY` output. **No artifact upload or retention step is included.**

Approving these items keeps **A5 excluded** and **A6 separately gated**, grants no product optimization/instrumentation, remote DB access, paid overage or performance target, and does not grant staging/commit/push/merge/dispatch permission. The chosen CI trigger and removal publication wait for independently authorized SHIP actions and verified quota; the developer can prepare their reviewable diffs first. This 6A PLAN session ends at the document and approval handoff.
