# Requirement — Iteration 6A: OBS-01 Performance Verification

- Date: 2026-10-23. Role: `$yaho-spec` only.
- Audited HEAD: `3e9fef51d1ff912c055ff7e7226dfc607c601ca9`, branch `feature/phase21-ai-service`; PR #54 Draft (user-supplied PR context).
- Status: **measurement proposal, awaiting 흥영's approval before 6B implementation**. No measurements were executed in 6A. Every count below is a static source-operation count unless explicitly described as a future measured metric.
- Evidence line numbers refer to the audited HEAD. This document and the dated OBS-01 addendum are the only 6A changes.

## Problem

`OBS-01-batch-confirm-perf.md` mixes useful source observations with stale claims and an unmeasured N=2 estimate of 200–600ms. Estimates are not results. Establish the current behavior, then measure the unchanged confirmation core against real PostgreSQL while checking financial correctness. Optimization decisions follow measurement and a separate approval.

## Current Process

### Fact-check of the original OBS-01 analysis

Evidence shorthand: **F** = `server/reservation-applications/finance.ts`; **C** = `server/reservations/create.ts`; **A** = `app/(admin)/reservation-applications/actions.ts`. Thus `F:313` is a file-and-line reference to `server/reservation-applications/finance.ts:313` at the audited HEAD.

| Material original claim | Verdict | Current-code evidence / reconciliation |
| --- | --- | --- |
| Target is `confirmApplicationSubmissionCore`, `finance.ts:236` | Correct | `F:236–243`, transaction ends at `F:404`. It sorts and validates explicit choices, then confirms the selected applications atomically, creates one Payment, and allocates actual deposits FIFO. |
| Submission lock / application lock / selected application read / parent read are each one operation | Correct for the direct core's successful path | `F:124–128,244–260`: parent `FOR UPDATE`, selected applications ordered by id `FOR UPDATE`, selected `findMany`, parent `findUnique`. Application status and quote are checked after locking. |
| ClassSchedule lock is one operation; existing Child lock is 0–1 | Correct, incomplete helper cost | `F:266–277`: one bulk class lock, optional one bulk Child lock covering both explicit and requested Child IDs. Reservation creation later reacquires class/Child locks per application (`C:38–50`). |
| Return-obligation reconciliation costs 2–3 fixed queries | Incomplete / not a fixed upper bound | `F:144–185`: minimum **3** operations (all sibling applications + two ledger reads), plus terminal-sibling lookups, obligation writes, allocation creates and ledger refreshes; excess funding adds more. See the recount below. Cost depends on the entire submission, not just selected children. |
| `ledgerForSubmission` costs 2–3 queries | Corrected to exactly two source operations per invocation | `F:131–136`: deposit `findMany` and allocation `findMany`. Confirm invokes it inside reconciliation and again at `F:281`; funded terminal siblings cause further invocations at `F:167`. Emitted SQL count still requires measurement. |
| Duplicate-reservation precheck is 1–2 operations | Correct, branch-dependent | `F:286–297`: always invokes reservation `findMany`; PaymentItem `count` only when reservations were found. A prior paid reservation throws `ApplicationPaymentAlreadyExistsError`. |
| Fixed total is approximately 10–14 queries | Not an adequate current count | Simple success is **13 + E + Cdup** source operations including the single Payment and hoisted device read, before identity locks and application/mapping/allocation loops. Return reconciliation can add unbounded-by-N work. This is not a measured SQL total. |
| New-Child advisory lock is 0–1 per application | Qualified | `F:300–310`: **K distinct sorted identity keys**, locked before the application loop; normally K equals the number of new children, but it is deduplicated by key, not mechanically one lock per application. |
| New-Child duplicate lookup/create are one operation each; existing Child validation is one | Correct | `F:319–340`: new identity `findMany` + Child `create`, or existing Child `findUnique`. Existing data must match the submitted snapshot and be active/unpurged; requested-Child binding is checked at `F:317`. |
| Reservation creation is 3–5 queries | Successful-path source count is **5** | `C:38–89` and `lib/children/lock.ts:15–22`: class lock, Child share lock, existing-reservation read, capacity count, create (or update at `C:92`). Earlier rejection paths stop before all five. |
| One conditional application status update per child | Correct | `F:367–371`: `updateMany` constrained to `SUBMITTED`, requires count = 1; all writes roll back on failure. |
| Bottleneck 1: device lookup remains inside the application loop, same submission queried N times | **Stale / false today** | `F:313` precedes `for (const application of applications)` at `F:315`. It runs once when a call reaches this point, zero times on earlier failure. The same result is reused for all selected children. Exact excerpt below. |
| Device–Child connection is optional, one operation per application | Correct | `F:372–374`: if any devices exist, `deviceChild.createMany(..., skipDuplicates: true)` runs once per selected application. Rows depend on device count; this is distinct from the hoisted lookup. |
| Consent processing is two lookups plus one createMany per application | Correct | `F:375–376`; `lib/reservation-applications/consent-plan.ts:22–38`: two optional-consent latest-state reads, then three consent records (privacy and both optional choices) in one createMany, preserving submitted time/version. |
| Consent reads are already parallel with `Promise.all`, therefore performance is good | Misleading conclusion | `F:375` uses `Promise.all`, as does `F:132`. All run on one interactive-transaction connection; SQL executes serially. Syntax alone establishes no performance ranking. See the Prisma v6 transaction reference below. |
| Application processing is approximately 8–12 queries per child | Incomplete / ambiguous | Before payment/mapping/allocation: new-child path is **11 + d** operations plus its share of K advisory locks; existing-child path is **10 + d**. No per-child device lookup. The new-child/device-present path including its identity lock is 13 operations, exceeding the old range. |
| One Payment, N PaymentItems and N mappings | Correct | `F:379–391`: Payment is once per successful selected batch, followed by exactly one item and mapping per selected application. Item amount and paidAmount equal its stored quote; discount/refunded amount are zero. |
| Bottleneck 2: PaymentItem and Mapping creation still use a sequential application loop | Correct structural observation; latency impact unmeasured | `F:384–391`: each iteration awaits `paymentItem.create`, then awaits mapping `create`; the next iteration follows. There are 2N source operations. |
| Bottleneck 3: FundAllocation read inside each mapping loop, followed by sequential creates | Correct structural observation; latency impact unmeasured | `F:393–401`: N whole-submission allocation reads, each followed by FIFO allocation creates awaited one at a time. Number of creates depends on how deposits span charges. Reconciliation has additional allocation work. |
| Lock order remains Submission → ordered applications → ordered classes → ordered existing children → sorted new identities | Preserved in core; original description needs qualification | `F:244–277,300–310`. Identity locks are sorted by their opaque tuple keys, not by row id. `C:38–50` then takes re-entrant class/Child locks per application; newly created Children are locked there too. Ordering reduces some hazards; this static review does not prove absence of all deadlocks. |
| Conditional update, exact identity rejection, return idempotency, device skipDuplicates guard duplication | Preserved, but guards operate at different boundaries | Confirmation: `F:241,259,317–340,367–374`; return replay: `F:425–439` (same obligation/key, not a confirmation idempotency key). The stricter immutable return-payload comparison is in `A:248–265`. |
| Listed duplication guards are sufficient to describe the full path | Missing additional protections | Paid-reservation guard `F:285–297`; reservation state guards `C:55–77`; quote/funds checks `F:282–283`; selection-bound overbooking `F:67–86,343–362`. Unique constraints: `prisma/schema.prisma:435` (Child/class), `:703–704` (application/item mapping), `:822` (item/reservation). |
| N=2 sections total 200–600ms; Supabase/PgBouncer/Vercel network dominates | **UNMEASURED estimates / unverified attribution** | No timed result or environment accompanies that table. Source counts cannot establish latency, bottleneck ranking, or network dominance. Do not use these numbers as a baseline, target, or measured result. |
| Real measurement requires Vercel logs or APM | False as a requirement for core/DB measurement | Core accepts a `$transaction` client (`F:51,236–243`); real PostgreSQL is already used in `tests/integration/reservation-applications/confirmation-atomicity.test.ts:120–122`. Test-only clocks/query events can measure it. This local-DB result does not establish production latency. |
| Hoist / batch createMany or createManyAndReturn / batch allocations / add debug timing, in stated priority order | Historical proposals, not approved conclusions | Hoisting already happened. Remaining batching and instrumentation suggestions are out of 6A/6B baseline scope; performance benefits and priority remain unmeasured. ID dependencies and finance/locking correctness would require separate design before any optimization. |
| Keep lock order, transaction scope and duplication guards | Retained requirements | `F:243–404`, `C:17–19`; no performance measurement may alter these semantics or weaken assertions. |

The current loop structure, quoted from `server/reservation-applications/finance.ts:313–317`:

```typescript
    const devices = await tx.deviceSubmission.findMany({ where: { submissionId: input.submissionId }, select: { deviceId: true } });
    const reservationIds: string[] = [];
    for (const application of applications) {
      const choice = choices.find((candidate) => candidate.applicationId === application.id)!;
      if (application.requestedChildPurgedAt || (application.requestedChildId && application.requestedChildId !== choice.childId)) throw new ApplicationNotPendingError();
```

Repository history resolves the timing of this discrepancy: `8b0089f59b2e693b1265fc435087079ddabc1cf3` both introduced the original OBS-01 document and moved the device lookup out of the loop. `git diff 8b0089f HEAD -- server/reservation-applications/finance.ts server/reservations/create.ts lib/reservation-applications/consent-plan.ts` is empty. Thus the document was already stale about device lookup when added. No later consent/core-query change in those files should be invented to explain the UX work.

### Recount: source operations, not measured SQL statements

N = selected applications; nNew = new-child choices; E = 1 if any existing/requested Child IDs need the bulk share lock, otherwise 0; Cdup = 1 if the duplicate precheck finds reservations and invokes PaymentItem count, otherwise 0; K = distinct new identity lock keys; d = 1 if the device lookup returns any devices, otherwise 0; Fpay = number of FIFO Payment FundAllocation creates. Rejected paths stop at their actual failure point and do not follow this successful-path formula.

| Successful direct-core stage | Source operations | Evidence |
| --- | --- | --- |
| Submission lock, application lock/read, parent read, class bulk lock | 5 | `F:244–269` |
| Existing/requested Child bulk lock | E | `F:270–277` |
| Reconciliation base: all applications + ledger | 3 | `F:145–150,131–136` |
| Reconciliation additional work | Xrec, defined below | `F:151–185` |
| Ledger after reconciliation | 2 | `F:281,131–136` |
| Duplicate precheck | 1 + Cdup | `F:286–297` |
| Device lookup | 1 | `F:313` |
| Payment | 1 | `F:379–382` |
| New identity locks | K | `F:300–310` |
| Per application: Child operations | 2 new / 1 existing | `F:321–340` |
| Per application: reservation helper, status update, optional device link, consent | 5 + 1 + d + 3 | `C:38–104`, `F:367–376` |
| Per application: PaymentItem, Mapping, current allocations read | 3 | `F:384–398` |
| Payment allocation creates | Fpay | `F:399–400` |

**Total = 13 + E + Cdup + K + (13 + d)N + nNew + Fpay + Xrec.**

For reconciliation, let t be eligible REJECTED/CANCELLED siblings visited, u the number that receive increased funding, fTerm their newly created allocation rows, x = 1 when positive excess is funded (else 0), and fExcess its allocation rows. Then **Xrec = t + 3u + fTerm + 2x + fExcess**: terminal lookup t; obligation write and two refreshed-ledger reads per funded terminal sibling; each allocation create; excess lookup/write and allocations. Existing fully funded terminal siblings still incur their lookup. Neither t nor deposit fragmentation is bounded by the selected N alone.

Illustration only: all N selected, no terminal siblings/excess/prior reservations, one exact-total deposit so Fpay = N, one associated device (d = 1). New path has E = 0, K = N; existing path E = 1, K = 0:

| N | All new: 13 + 17N | All existing: 14 + 15N |
| --- | --- | --- |
| 2 | 47 | 44 |
| 4 | 81 | 74 |
| 8 | 149 | 134 |

These are **logical calls reconstructed from source**, excluding transaction-control SQL. A Prisma operation can emit multiple SQL statements (or short-circuit); relation loading, writes, engine transaction commands and empty filters prevent equating this table with actual DB-query counts. 6B must report observed query-event counts separately, with their definition.

### UX confirmation steps absent from the old analysis

The current ADMIN flow calls the core inside an outer transaction, using `financeInTransaction` to reuse that transaction (`A:172–175,315–345`). Before the core it adds a parent lock, authoritative full-ledger validation, application locks/read, parent purge read, required-confirmation/consent/purge checks, class bulk lock/read with reserved counts, and overbooking-binding validation (`A:318–340`). After the core it validates the ledger again (`A:343`). For ordinary success this is eight additional source operations outside the core; nested ledger/class projections can emit more SQL. They must not be hidden in, or mistaken for, the direct-core count.

Successful writes then invalidate caches (`A:346–348`). The workflow controller performs a separate authoritative refresh/read and verifies the receipt (`app/(admin)/reservation-applications/submissions/[id]/workflow-controller.tsx:72–85,97–110`; `A:185–189`; `lib/reservation-applications/detail-queries.ts:40–94`). That read loads applications, consent history, deposit/allocation/return facts, candidates and retention facts in a RepeatableRead transaction. It is not inside this measured core call.

UI class revision metadata is passed at `workflow-controller.tsx:130`; current class/overbooking authority is checked at `A:325–340`. Price/link revision operations belong to other paths (`server/classes/application-price.ts:10–20`; `server/reservation-applications/links.ts:26–32,48–61`), not additional queries inside `confirmApplicationSubmissionCore`. The confirmation core uses the stored quote, not a live price revision. Direct-core timing therefore includes its own transaction completion but excludes ADMIN authorization/Zod, outer workflow checks, HTTP/RSC, browser refresh and rendering; it must never be labelled end-to-end confirmation time.

### Measurement-capable infrastructure inventory

| Existing resource | Verified capability / boundary |
| --- | --- |
| `.github/workflows/phase2-integration.yml:3–5,12–29` | `pull_request` and `workflow_dispatch`; `ubuntu-latest`; ephemeral `postgres:16`, dedicated local port 55432 and synthetic database/user `yaho_e2e`. Both DB URL variables point to that service; no Supabase/Production credentials are needed. |
| Same workflow `:34–56` | Node 20, npm ci, Prisma generate, guarded server verification, local role preparation, `prisma migrate deploy`, then `npx vitest run --config vitest.integration.config.ts`. This is already usable infrastructure, not an assumption that a remote DB is available. |
| `tests/e2e/support/db-safety.ts:1–6,34–76` | Actual guard names are `assertSafeE2eDatabaseUrl(s)`, not `assertE2eDatabaseIsSafe`. Both URLs must be PostgreSQL, localhost/127.0.0.1, port 55432, exact dedicated database and user. |
| `scripts/ci/verify-e2e-db.ts:5–29`; `scripts/ci/prepare-e2e-db.ts:15–25` | Guard before client construction; verify actual PostgreSQL 16/database/user; prepare anon/authenticated NOLOGIN roles needed by existing migrations in the disposable service. Do not reproduce connection strings or passwords in reports. |
| `vitest.integration.config.ts:6–15` | Reject Vercel/Preview; check before/after environment loading; guard before fixtures/client construction; include only `tests/integration/reservation-applications/**/*.test.ts`, no file parallelism. |
| `tests/integration/reservation-applications/confirmation-atomicity.test.ts:20–48,63–188` | Real PostgreSQL, real finance writes; only authorization/Next cache/navigation and the injected DB binding are replaced. `:120–122` directly calls the core concurrently on independent Prisma clients. Other confirmation scenarios call the real core through the real ADMIN action (`:9,41`): subset/holds/linkage `:64–94`, Child/late-write rollback `:95–118`, paid duplicate `:124–128`, identity `:130–134`, FIFO `:136–140`, class/ledger/capacity/overbooking `:142–160`, return race/retry/refund/purge `:162–188`. These are correctness tests, not a timed benchmark. |
| `tests/integration/reservation-applications/workflow-races.test.ts:30–45,77` onward | Real deposit/return workflow assertions and ledger conservation support; this file does not itself call the confirmation core. |
| `tests/integration/reservation-applications/price-recheck.test.ts:173–183,265–269` | Stored quote preservation after a live price change, verified existing-Child snapshot behavior. Submission coverage, not confirmation timing. |
| `lib/db/prisma.ts:1–9`; `package.json:25,48`; `package-lock.json:1592–1593,6856–6857` | Product singleton has no query-event logging configured. Manifest range is ^6.0.0; lockfile actually pins Prisma CLI/client **6.19.3**. No package/schema upgrade is required for the proposed test-only instrumentation. |

## User Story

As 흥영, I need measured, reproducible confirmation timings and query counts with asserted financial outcomes, so I can decide whether optimization is warranted using evidence from the current implementation.

## Scope

6A delivers this reconciliation and measurement requirements, plus the historical-analysis addendum. 6B, only after approval and the normal PLAN/BUILD gates, may implement and execute an isolated synthetic PostgreSQL harness. No benchmark result exists yet.

### Instrumentation without product changes

1. Construct harness-owned Prisma 6.19.3 clients with query logging configured as **event only** (`log: [{ level: "query", emit: "event" }]`); register `$on("query", ...)` on the base client before use. Count each event, optionally sum only its numeric duration, and discard query/params/target fields immediately. Do not copy documentation examples that print query text. The generated API supports `$on` and `Prisma.QueryEvent` (`node_modules/.prisma/client/index.d.ts:583,5541–5547`); official [Prisma v6 logging](https://www.prisma.io/docs/orm/v6/prisma-client/observability-and-logging/logging) and [API reference](https://docs.prisma.io/docs/orm/v6/reference/prisma-client-reference#log) describe these facilities. Query-event duration is client/DB request duration, not complete core time.
2. A test-only `$extends({ query: { $allOperations(...) } })` can additionally count logical model/raw operations and time individual awaited operations without changing inputs/results. Include raw operations: `$allModels.$allOperations` alone misses raw locks; top-level `$allOperations` handles them with an undefined model. Such logical counts are a diagnostic, not the actual SQL metric. Register events on the base client first; extensions do not replace event counting. API availability is established, but transaction/raw interception and types must be checked by 6B calibration, not claimed tested here. [Prisma v6 query extensions](https://www.prisma.io/docs/orm/v6/prisma-client/client-extensions/query#modify-all-prisma-client-operations).
3. Measure `performance.now()` immediately before direct invocation of `confirmApplicationSubmissionCore(measuredClient, input)`, and stop in `finally` after fulfillment/rejection. This includes core transaction acquisition, lock waits, SQL, JS and commit/rollback. Keep unchanged `maxWait: 10000` / `timeout: 20000` (`F:9,404`). No test adapter may change transaction semantics or budgets.
4. Each measured client serves only one in-flight core call. Fixture creation, validation, replay probes, metadata queries and cleanup use a separate unmeasured client. Concurrent contenders have separate clients/counters, never a shared query-event counter or inferred async context. Establish connections before warmups; verify event delivery and attribution through completed transactions before collecting samples.

**Per-phase timing is not available as an exact metric from these hooks.** Private reconciliation/helper boundaries and JS between queries are not exposed; the same model/raw operations occur in several phases, and overlapping awaited-operation intervals cannot safely be summed into phase wall times. Do not infer phases by SQL text, source line interception, or subtracting selected query durations. Operation timings may be labelled operation diagnostics only. Exact lock/validation, Child/reservation/consent and payment/allocation phase timers would need explicit product-code spans/markers or another separately reviewed mechanism; that is an optional approval-gated scope expansion, excluded from the baseline. `Promise.all` inside an interactive transaction still serializes SQL on its single connection. [Prisma v6 transaction behavior](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions#using-transaction-within-promiseall).

### Harness location and explicit invocation

Proposed 6B files: `tests/performance/reservation-applications/obs-01.perf.ts`, narrowly scoped support files under `tests/performance/support/`, and `vitest.performance.config.ts`. A sanitized aggregate reporter belongs to test support. Naming and directory are outside both existing discovery globs: `vitest.config.ts:12` includes only unit tests; `vitest.integration.config.ts:13` only integration application tests. The dedicated config must include the exact perf file and fail closed unless `YAHO_OBS01_PERF=1`, with the same dedicated-local-DB guards and Vercel/Preview exclusions before constructing clients. No normal test glob changes or package script are needed.

Proposed explicit command after approval, with the guarded database already prepared:

```sh
YAHO_OBS01_PERF=1 npx vitest run --config vitest.performance.config.ts
```

Do not invoke it in 6A. Do not silently include it in `npm test` or the existing integration test command. Use one worker and sequential scenario groups; only the intentional two-admin pair is concurrent. Reuse fixture concepts, not imports from `.test.ts` files that would register their suites.

### CI execution options and limitations

- **Proposed default: reuse the existing Phase 2 workflow's service/setup recipe and add a separately opted-in perf step/job**, leaving its ordinary integration command intact. Reusing an unchanged workflow alone will not run this harness: the invocation and opt-in condition must be added and approved. If a separate job is used, it needs its own PostgreSQL service/setup because job services are not shared. Finish ordinary integration tests before measurement so they do not compete for the DB.
- For a pre-merge 6B trial, an explicitly approved, exact-head-branch condition can invoke the perf command on that PR's `pull_request` opened/reopened/synchronize events; pushes to the PR branch produce synchronize events, including while the PR is Draft. Keep the condition limited to the approved trial branch and remove/disable it after the trial as specified in the approved PLAN. No universal automatic perf suite is proposed. If no CI edits are approved, use the guarded local setup and report no CI measurement.
- A **new dedicated workflow file** is an alternative requiring explicit approval; it can use the same ephemeral PostgreSQL recipe and approved PR trigger. The current workflow is not a callable reusable workflow (`workflow_call` is absent), so a new file cannot simply call it without further workflow changes.
- CLI/API `workflow_dispatch` requires the workflow file to exist on the default branch. A new feature-branch-only file cannot be dispatched just by giving `gh workflow run ... --ref ...`; use approved PR-push triggering before merge. The existing file's registration on the actual default branch must be verified read-only before promising manual dispatch. Current YAML declares dispatch but has no perf input/step. [GitHub dispatch and PR trigger rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
- Record both PR head SHA and actual checked-out SHA: the existing checkout on a `pull_request` run defaults to the merge ref. Do not label a merge-ref measurement as pure `3e9fef5`/head measurement. [GitHub PR checkout behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).
- Use the existing standard Linux runner, local PostgreSQL and installed dependencies; no APM subscription, paid runner or hosted benchmark DB is needed. Private-repository runs consume included Actions minutes/storage. Available account quota has not been verified; no paid overage is authorized. Prefer the aggregate job summary; any aggregate artifact upload/retention is also a workflow change requiring approval. [GitHub Actions included usage](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions).

## Out of Scope

- No optimization: no further hoisting, batching, parallelization, query rewrite, indexes, caching, dependency upgrades, or changed Prisma loading strategy.
- No finance, price, refund, allocation, lock order, isolation, transaction scope/budget, privacy, authorization or confirmation policy change.
- No product instrumentation in the baseline; no production/Preview/Supabase/Vercel benchmark, HTTP/browser benchmark or latency extrapolation to those environments.
- No assertion weakening, test deletion, skipped adverse outcomes, silent retries, preset performance targets or improvement percentages.
- No code/test/workflow/schema/migration edits, DB operations, test/lint/build runs, staging, commit or push in 6A. No edits to REQUIREMENTS/ADRs are needed because no business policy is being changed.

## Business Rules

### Fixtures and scenario matrix

Use synthetic run-owned data only, derived from `confirmation-atomicity.test.ts:24–48`: two synthetic ADMIN users, one synthetic Program, future SCHEDULED classes with capacity 8, a Submission with valid guardian fields and N independent applications. Run **N = 2 / 4 / 8** separately. One class per child avoids conflating selected-child count with last-seat contention. N denotes total applications/children in the fixture; normal/race/rejection batches select all N, and subset/return scenarios explicitly select N−1. These sizes remain within current validation's max 10 (`lib/reservation-applications/phase20-validation.ts:84,103–119`).

Use the existing tests' synthetic alternating 40,000 / 60,000 quotes and deliberately different Program.defaultPrice; these are test vectors, not new prices or financial rules. Required acknowledgments/consents are valid; optional consent choices are fixed and documented. Sort run-owned application IDs deterministically so FIFO fragmentation is reproducible. Primary scenarios have one synthetic device associated with the Submission and no pre-existing DeviceChild links. Existing-child fixtures additionally have deterministic prior optional-consent history to exercise append-only history; new-child fixtures have none. Record the consent-history/device profile as a scenario dimension.

**Two independent Child modes:** NEW uses distinct identities absent from Child and `newChild: true`; EXISTING pre-creates matching active/unpurged Children, binds requestedChildId and passes childId. Never combine mode samples into one distribution. Fixtures must be prepared before the measured call, including deposits/holds/actual returns through existing finance cores and any direct synthetic prerequisite rows. Snapshot all relevant rows before timing; verify afterward using an unmeasured client.

All rows below run at each N and both modes unless stated otherwise. Every row has **5 excluded warmup fixtures + 30 measured fresh fixtures per scenario/N/mode/profile**; the concurrent row has 5 warmup **pairs** + 30 measured **pairs**. No sample reuses an already-confirmed submission as its primary invocation.

| Scenario / fixture difference | Measured boundary and expected outcome class | Required outcome checks |
| --- | --- | --- |
| NORMAL: N selected, one exact-total actual confirmed deposit, no holds/previous reservations | One core call; fulfillment / committed success | Exactly one Payment, N distinct reservations/items/mappings, N new Children only in NEW mode; existing Children unchanged in EXISTING mode; all invariants below. Also run a no-device NORMAL profile at N=2 in each mode, with the same 5+30 repetitions; report separately. |
| SUBSET: N total, select first N−1, deposit covers all N quotes; last sibling remains SUBMITTED | One core call; committed success | Only N−1 confirmed, selected quote sum paid, last sibling and all its linkage/consent/device state untouched, remaining funds available. This gives a non-vacuous unselected-sibling assertion. |
| FRAGMENTED: N selected; deposit 30,000 first, then remaining total; deterministic confirmedAt/id order | One core call; committed success | First 40,000 quote spans two actual deposits; per-deposit amounts and FIFO order checked. All other success invariants hold. Separately report this profile because allocation-create count differs from NORMAL. |
| RETURN-HOLD: N total, last sibling REJECTED; deposit covers all N, hold funds its quote, actual partial return of 20,000 already recorded; select other N−1 | One core call; committed success | Existing hold allocations/return records unchanged; R and T remain protected, P increases by selected quote sum and A becomes 0. At N=2 this reproduces existing Scenario A: D100000 = A0 + P40000 + R40000 + T20000. Rejected sibling untouched. |
| SAME-SUBMISSION RACE: NORMAL fixture, identical selection, two independent clients and ADMIN actor IDs | Start both calls from the same external start gate after connection setup; wall/query metrics per contender and pair completion | Exactly **one fulfilled success and one rejected `ApplicationNotPendingError`** after serialization (`F:244–259`). One Payment and one set of N items/mappings/reservations, never two. Apply all success invariants to the committed winner; loser contributes no additional effects. Report winner and loser separately. |
| INSUFFICIENT: N selected; actual deposits total selected quotes minus 1 | One core call; rejected `InsufficientApplicationDepositError`, rolled back (`F:280–283`) | No new Child/reservation/Payment/item/mapping/consent/device link or committed reconciliation write; original pending applications, quotes and ledger unchanged. A just below required total must fail even if a faster rejection is observed. |
| HELD-FUNDS INSUFFICIENT: N total, last REJECTED and funded hold; D = all quotes minus 1; select other N−1 | One core call; rejected `InsufficientApplicationDepositError` | Gross D is enough for selected charges, but A is selected total minus 1. Assert no reuse of held money, no confirmation and unchanged funded hold/ledger. |
| DUPLICATE UNPAID: EXISTING only; N selected, one selected Child/class already has RESERVED Reservation without PaymentItem; enough actual deposits | One core call; rejected `DuplicateReservationError` from helper (`C:55–65`), rolled back | Put the duplicate last in application order so earlier selected work executes and must roll back. Preserve original reservation; no new success rows/consents/device links or status changes. |
| DUPLICATE PAID: EXISTING only; same shape but prior reservation already has Payment/PaymentItem | One core call; rejected `ApplicationPaymentAlreadyExistsError` (`F:285–297`), rolled back | Preserve exact prior payment/linkage/amount; no new mapping/payment or confirmations. Keep separate from unpaid duplicate because the rejection point differs. |

A duplicate-reservation fixture requires an existing Child by definition; do not manufacture a NEW-mode duplicate while still claiming to measure successful new-Child creation. All failures are measured and asserted by their precise core error type, not ADMIN action strings/status alone. A timeout, infrastructure error, wrong error type, zero/two race winners, or invariant violation invalidates that cell; do not silently retry or relabel it a successful timing sample.

The race must use genuinely independent connections, not a single client transaction or mocked lock. Do not add an artificial hold/sleep inside timed calls. Existing `tests/e2e/support/phase20-race-barrier.ts:81–100` provides deterministic correctness-race machinery, but its pauses/observer queries must not be included as natural contention timings; an optional separate unmeasured overlap check may use it. Report simultaneous-start contention, without claiming a measured lock-wait duration.

### Financial and selection invariants alongside every measured success

These checks run outside the timed/query-count window, for every successful sample including warmups and race winners. Error/rollback samples also retain ledger conservation and verify no prohibited effects. Assertions must cover the owned submission and exact row relationships, not only global table counts.

| Required invariant | Assertion requirement and existing reference |
| --- | --- |
| **D = A + P + R + T** | D = confirmed deposits; P = allocations to Payment mappings; R = funded obligations minus actual returns; T = completed actual pre-reservation returns; A = remaining unallocated deposits. All nonnegative, per-deposit allocations ≤ deposit amount, each allocation targets exactly one mapping or obligation. Use existing `validateLedgerAllocations` and `summarizeDetailLedger` on reduced facts; `lib/reservation-applications/ledger-summary.ts:42–71,7–24`; existing integration `ledger()` at `confirmation-atomicity.test.ts:46` and `workflow-races.test.ts:30–33`. Helpers in `.test.ts` are local, not reusable exports. |
| No confirmation beyond actual deposits | Snapshot available A before invocation; new P equals selected fixed quotes and is ≤ prior available A after protected holds. Actual bank-confirmed deposits alone fund success, not deposit notification or default price. Per-deposit backing must remain valid. Existing tests `confirmation-atomicity.test.ts:64–94,136–140`. |
| Exact Payment / PaymentItem / Mapping linkage | One new Payment per batch; its total = selected quote sum. Exactly one distinct item per selected Reservation, one mapping per selected application pointing to that item, each item's amount/paidAmount = original quote, discountAmount/refundedAmount = 0. Each mapping's allocations sum to its quote; no extra mappings/reservations or unrelated links. `confirmation-atomicity.test.ts:74–89` covers linkage/amounts; `ledger-summary.ts:53–59` checks mapped funding. Extend these assertions to every N, not just their existing examples. |
| Only selected children confirmed; unselected siblings untouched | Snapshot application state, quote, child/reservation/payment links and relevant consent/device facts. Confirmed selected IDs must equal requested IDs; subset/rejected siblings remain byte-for-byte equivalent for stored business fields, with no new sibling links/history. Existing subset and rejected-sibling checks `confirmation-atomicity.test.ts:64–83`; existing Child data preservation `:85–89`. No timestamp-dependent projection comparisons. |
| quotedAmount unchanged | Compare every application's stored quote before/after, and against item amount. Before timing, deliberately change live class prices (keeping valid future classes) so success must still use saved quotes. `F:282,387` reads saved quotes; `price-recheck.test.ts:173–183` already checks quote stability after price change on submission replay. Full before/after quote assertions on every perf confirmation are additional required coverage, not claimed already present in that test. |
| Duplicate confirmation impossible | After counters/time stop, replay the same selected set with an unmeasured client: require `ApplicationNotPendingError` and no changed row/link counts. Race requires one winner and one loser, including one Payment (not only N items). Existing direct race `confirmation-atomicity.test.ts:120–122` and response-loss/replay `:166–168`. Replay probes are not extra primary samples. |
| Return-obligation funds never reused for reservations | Validate backing per deposit/target, keep existing hold allocation IDs/amounts and actual return records unchanged, and assert P increase consumes only previously available A. RETURN-HOLD and HELD-FUNDS INSUFFICIENT make this non-vacuous. Existing `confirmation-atomicity.test.ts:64–94,162–164`; completed return funding remains reserved, as reflected in `ledger-summary.ts:6–24`. Existing Refund must not replenish A (`:170–175`). |

Also verify Child/consent/device behavior from the chosen mode: NEW creates exactly the selected Children, EXISTING preserves personal data, each selected application appends the expected three consent records using stored time/version, and one device links only selected Children. Existing late-failure rollback assertions cover Child/consent cleanup at `confirmation-atomicity.test.ts:108–118`; the performance harness must add complete per-sample device/consent checks rather than assume those tests already assert them all.

### Metrics, repetitions and reproducibility

- **Primary:** monotonic wall-clock milliseconds per direct core call and actual Prisma query-event count per call. Query count includes all emitted statements while the owned core call is active, including transaction control if emitted; it is not renamed CRUD count. Calibrate event counting with known independent transactions/rollback before warmups; explicitly document any engine commands not exposed as events. Do not invent a fixed BEGIN/COMMIT subtraction to match the static table.
- **Optional diagnostic:** summed numeric query-event duration per call and separately named logical operation count. Neither establishes phase timings or DB CPU time. Check instrumentation itself does not emit SQL/params or share counters. Baseline measurements consistently use the same light instrumentation; report its presence, not a guessed overhead correction.
- **Outcomes:** fulfilled/rejected totals, allowlisted error class totals, asserted committed/rolled-back effects, invariant pass/failure counts. For races report winner/loser call distributions and pair wall time separately, each with 30 samples from 30 pairs.
- **Sampling:** exactly 5 warmups excluded, then 30 measured fresh fixtures for every matrix cell/profile above. Warmups still assert outcomes. Use the same fixed, recorded scenario order; cleanup each owned fixture after checks, so database size does not grow with repetition. Do not discard slow runs/outliers. Interrupted cells report actual count and incomplete status, never a complete p95.
- **Statistics:** for each scenario/N/mode/device/deposit/hold profile and outcome class, sort samples; use nearest-rank p50/p95 (`ceil(p*n)`, one-based) and max for milliseconds and query count. Report n, min/max query counts where helpful, and aggregate failures. Do not merge successful and rejected calls or claim a stable tail SLA from 30 observations; these are descriptive measurements.
- **Environment:** record UTC date, audited source/head SHA and checked-out SHA, clean/dirty source flag, harness/config revision, runner class and OS image, CPU count/model and memory class, PostgreSQL actual version, Node actual version, Prisma CLI/client versions, migration revision, direct local DB topology, connection pool settings (numeric configuration only), transaction options, client count, warmups/repetitions and fixture-profile counts. Node 20 / postgres:16 / ubuntu-latest are current configuration, not substitutes for actual versions. No URLs, usernames, credentials, host account details or env dumps.
- **Isolation and safety:** require both URL guards and actual DB metadata verification before fixtures; exclude Vercel/Preview/remote DBs. No dev server, HTTP app or other test workload should run concurrently with the benchmark. Own and clean every synthetic row by run manifest in dependency order, including on failure; no global deletes/reset/truncate, migration reset, or db push. Apply only existing migrations to the dedicated disposable service. Setup/connect/preflight/assertion/replay/cleanup costs stay outside core metrics; unmeasured setup failures are reported as setup failures.
- **No performance pass threshold:** report what was observed. Do not preset latency/query budgets, improvement percentages, or conclusions about which optimization will help. Outcome/invariant correctness is mandatory regardless of speed.

### Output discipline

Only aggregate numeric measurements, counts, allowlisted scenario/outcome labels and the non-sensitive environment metadata above may reach logs, job summaries or artifacts. Keep individual timing samples in memory only until aggregation. Never persist/print SQL, parameters, event payloads, exception messages/stacks/meta, fixture row snapshots/IDs, personal/guardian/Child data, raw or hashed capability/idempotency tokens, bank/account fields, connection strings or credentials, including synthetic values. Register no stdout Prisma query/error logging and disable verbose Prisma DEBUG output for the harness.

A sanitized reporter must suppress default Vitest assertion diffs and uncaught-error serialization that could expose objects/SQL. Assertions use fixed safe failure codes with aggregate failure counts; unexpected errors map to a fixed unknown-infrastructure label without dumping the error. Keep the exit code failing for wrong outcomes/invariants/incomplete runs. No console/raw-JSON fallback on failure. If instrumentation/reporting cannot meet these constraints, that harness run is not approved to collect/publish data. This restricts benchmark output; existing repository tools are not being changed in 6A.

## Acceptance Criteria

1. The historical OBS-01 body remains intact, with a 3–5-line dated addendum marking all processing times UNMEASURED and linking here. Current evidence reconciles every material claim, including the already-hoisted lookup, consent SQL serialization and full ADMIN-path overhead.
2. 6B implements only the approved measurement scope, after approved PLAN and `$yaho-build`; this specification alone does not authorize implementation. Normal unit/integration discovery remains unchanged.
3. Every specified N/mode/scenario/profile yields aggregate wall/query statistics and exact success/error/rollback assertions at the specified repetitions, or is explicitly incomplete/invalid. Independent race contenders yield one committed confirmation and no duplicate money/linkage.
4. Every measured success satisfies all financial/selection invariants; rejected calls preserve transactional state. A correctness failure cannot be compensated by a good timing result.
5. Environment and metric definitions accompany aggregate results; no sensitive output or unsupported production claims. No optimization, target or improvement percentage is attached to the measurement design.
6. At 6A completion, `git status` contains only the two requested docs, with no staged changes; no test/lint/build execution is required or claimed.

## Conflicts

No business-policy change is requested. Reviewed and **maintained**:

- REQUIREMENTS 10.1/10.4 and ADR-001/003/023: one Child per Reservation, duplicate guards and class-lock capacity rules. N is fixture size, not a new class-capacity policy.
- REQUIREMENTS 12 and Phase 20 “금액·입금 알림·ADMIN 확인 / 반려·취소와 Reservation 전 반환” and acceptance criteria; ADR-005/007/036/039–041/060: actual deposits, exact per-child quote mapping, fund conservation, returns separate from Refund/Revenue, unchanged refund rules.
- REQUIREMENTS 20/20-1, Phase 20 “권한·개인정보·동시성”; ADR-054/055/058: privacy, submitted consent history, active/unpurged Child checks, purge/write serialization. Synthetic fixtures add no collection fields.
- REQUIREMENTS Phase 20 “보호자 참가비 표시”, ADR-063/064: fixed quotedAmount and price/link revision compatibility. No new price revision is required for confirming an old snapshot.
- REQUIREMENTS 24 testing-infrastructure questions and ADR-009/030/059/060: this is direct-core local PostgreSQL measurement using an existing integration-service pattern, not automated Playwright/Preview access or a decision to resolve general E2E CI questions. No shared Preview or Production access is authorized.
- AGENTS source-of-truth order and role/approval rules: 6A is documents only; 6B implementation remains gated. No REQUIREMENTS/DECISIONS rewrite or new ADR is justified by unchanged policy.

## Approval List — explicit 흥영 approval before 6B

| Item | Proposed approval scope / default |
| --- | --- |
| A1. 6B implementation and execution | Approve this matrix, counts, isolation, correctness and output requirements; then approve the PLAN before a `$yaho-build` developer subagent implements test-only harness/config/support and runs it on the dedicated synthetic DB. No implementation is authorized in 6A. |
| A2. CI workflow reuse and invocation | If CI measurement is wanted, explicitly approve edits to `.github/workflows/phase2-integration.yml` to add the isolated opt-in perf command/job and its exact trial branch/event condition or dispatch input. Current `pull_request` triggering can be reused; new activity types, head checkout changes, conditions and dispatch input changes must be enumerated in the approved PLAN. Until approval, local-only harness execution is the proposed fallback. |
| A3. Alternative new workflow | Only if chosen instead of reuse: approve the new workflow filename, service setup, PR-push trigger/filters and eventual default-branch dispatch registration. Do not create both routes implicitly. No CLI dispatch promise for a new PR-only file. |
| A4. Result publishing | Approve aggregate job-summary output as part of CI scope. If an uploaded artifact is desired, separately approve its new upload step, aggregate-only format and retention. No raw traces/samples/SQL or external APM. |
| A5. Exact per-phase timing — optional, excluded | No product instrumentation approved by default. If requested, obtain explicit approval for product-code spans/markers, their boundaries, privacy/output handling and overhead before a revised PLAN/BUILD. Test-only operation timings cannot silently substitute for phase wall time. |
| A6. Any later scope expansion | Product optimization, finance/locking changes, remote/Preview/Production measurements, changed dependencies/schema/migrations, paid services/overage or performance targets are outside 6B baseline approval and require a separate request/approval. Staging/commit/push are not authorized by this 6A session. |

Routine harness filenames and fixture implementation details within A1 do not create additional business-policy questions. Workflow alternatives and optional phase instrumentation are explicit scope approvals, not assumptions or preconditions for writing this specification.

## Open Questions

없음 — no unresolved business requirement blocks the proposed measurement design. Approval of 6B/PLAN and any chosen optional workflow/instrumentation scope remains pending above; it is not granted by the absence of Open Questions. Account Actions quota and default-branch workflow registration are pre-execution facts to verify, not permission inferred from elapsed time.

## Priority

**Now:** finish 6A reconciliation and obtain review of the concrete measurement specification. **Next:** approved PLAN, test-only BUILD and real measurements with QA/Review. Optimization decisions remain **Later**, informed by results and separately approved.
