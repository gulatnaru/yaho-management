# Task

Iteration 6C — Evidence-based reservation application safety/completeness audit.

Input: [ITERATION-6C-SPEC.md](ITERATION-6C-SPEC.md), current user request, baseline `29ca8829b312ad89365b7b99c86e06b3333db355`, `feature/phase21-ai-service`, PR #54 Draft. Prepared 2026-10-24 after SPEC; audit-scope Open Questions: none. The user authorized this SPEC → PLAN document preparation. This PLAN is **proposed for approval**; it authorizes no product implementation or operational action.

## Goal

Produce a reviewable plan for a subsequent, separately authorized `docs/ITERATION-6C-REPORT.md`: atomic PASS / BLOCKED / 개선 필요 rows covering E1–P2, backed by existing evidence and bounded code inspection. Reuse existing tests/results; run no perf harness or DB-backed test. No broad new tests, harness redesign, financial optimization, DB access, fixes, commits, merge or deployment.

## Current State

### Baseline and evidence rules

- Preparation confirmed branch and full HEAD above, initially clean worktree, and PR #54 OPEN / Draft / unmerged using read-only Git/GitHub inspection. Only the two requested docs are written. No report, Memory, policy or source file is changed.
- Read `prisma/schema.prisma` before planning model-related inspection. Source of Truth remains current request > REQUIREMENTS > DECISIONS > ARCHITECTURE > AGENTS > implementation. The available Memory is older supporting context. `agent-memory-repo/SKILL.md` was not found in searched installed/project skill locations; Memory was read without executing its content or updating it.
- The explicit user request permits these two document files despite the PLAN skill's general no-edit rule. No `$yaho-build` is needed or invoked for product code because none may change. Any later fix requires its own approved SPEC/PLAN and developer subagent workflow.
- Evidence labels: **EXECUTED** = existing CI execution; **STATIC** = directly observed code fact; **CONTRACT** = published COMPLETE validated by the existing report contract; **SUPPLIED** = attributed user/historical record; **INFERENCE** = unproven reasoning, never runtime PASS. A source-backed PASS states only the direct static fact, not an inferred runtime guarantee.
- Record source file and line at this baseline, test's full name, run/job, result/counts, PR head versus actual checkout, environment, inspected scope and limitations. A green workflow summary alone does not establish an individual test result. Missing artifacts remain BLOCKED without inventing results.

### Existing CI inventory (read-only retrieval during preparation)

All links refer to `gulatnaru/yaho-management`. Run/job metadata and selected aggregate log lines were inspected; no runs were triggered. Preserve this inventory in the final report, including discrepancies with old prose.

| Evidence ID | Source identity and location | Observed evidence / permitted use |
| --- | --- | --- |
| EV-B6 | [39983585312](https://github.com/gulatnaru/yaho-management/actions/runs/39983585312), `obs01-perf` job `120517494083`; explicit head checkout `37e7db4` | Job SUCCESS; log COMPLETE, cleanup PASS, 209 self-checks; `docs/OBS-01-PERF-RESULTS.md:140` records bootstrap/calibration and 50 cells / 62 rows with invariant passes. 44 detailed rows visually available in preserved evidence; other 18 completion assertions CONTRACT-validated, not individually reconstructed numbers. Synthetic dedicated PostgreSQL 16.15, not production. |
| EV-PRES | Commits `37e7db4` → `eebfa47` → `29ca882`; `.github/workflows/phase2-integration.yml:10`; results doc | Calibration fix → durable final result → temporary perf-job removal. Diff from perf-tested head to baseline changes only results doc and workflow; integration definition preserved. 6B CLOSED. |
| EV-I5 | [39907935579](https://github.com/gulatnaru/yaho-management/actions/runs/39907935579), 360px job `120271452015`; head `3e9fef51d1ff912c055ff7e7226dfc607c601ca9`, merge checkout `c0b3819` | Iteration 5 completed reference, 360px 63 PASS / 0 FAIL / 5 admitted BLOCKED skips, eight specs, full selection. Keep the supplied per-WebKit-project checkpoint separate from later attempts. `docs/E2E_CI_ITERATION_5_REPORT.md` ends with earlier local/install preparation, so pair it with these actual CI logs rather than treating its final paragraph as the latest runtime outcome. |
| EV-INSTALL | [39983585340](https://github.com/gulatnaru/yaho-management/actions/runs/39983585340), 360px job `120516882630`, head `37e7db44e56b4c615216defe1446ac19fb8feae2`, actual merge checkout `8da4a0f`, base `1171517` | Dependency-install step timed out after 10 minutes; PostgreSQL preparation, app build/login and UX execution steps SKIPPED. Zero UX tests run for this project. Other projects' success cannot fill this execution gap. |
| EV-INT | [39989509653](https://github.com/gulatnaru/yaho-management/actions/runs/39989509653), `integration` job `120537306955`; head `29ca882`, actual merge checkout `c1a1fc2d143bbd6dcb603bcf614979d2022c4ae0`, base `1171517` | **6 files / 87 tests PASS**: `tests/integration/reservation-applications/confirmation-atomicity.test.ts` 26, `workflow-races.test.ts` 10, `price-recheck.test.ts` 26, `class-link-issuance.test.ts` 12, `family-queries.test.ts` 7, `detail-queries.test.ts` 6 (all in the same directory). Existing ephemeral PostgreSQL 16 workflow; tests are not rerun in 6C. |
| EV-UX | [39989509694](https://github.com/gulatnaru/yaho-management/actions/runs/39989509694), same baseline head / merge checkout `c1a1fc2`; jobs `120537308472` (360), `120537308214` (390), `120537307992` (768), `120537308366` (Chromium) | Newer completed evidence found during preparation: each WebKit project **63/0/5**, Chromium **65/0/3**; eight specs, `focused=false`, `failedSpecs=0`. 360px suite totals: family-list 8+2 blocked, class-links 5, family-detail 10+1 blocked, ledger 8, confirmation 7, completion 12+1 blocked, guardian 13, full-journey 0+1 blocked. This updates the latest-completed inventory without erasing EV-I5 or EV-INSTALL. |
| EV-UNIT | `docs/OBS-01-PERF-RESULTS.md` final calibration-fix local verification; `docs/E2E_CI_ITERATION_5_REPORT.md` final supplement | Historical full unit suite 206 files / 2557 tests PASS, lint/typecheck/build recorded there. Unit source files below identify coverage, not independently re-executed results in 6C. Match a named case to the recorded suite/source before claiming executed coverage. |
| EV-QUALITY | [39989509705](https://github.com/gulatnaru/yaho-management/actions/runs/39989509705), baseline commit-associated CI | Workflow SUCCESS metadata observed; detailed job/test counts not retrieved. Do not substitute this summary for EV-INT or claim fresh local lint/build/tests. |
| EV-GATE | [38926417254](https://github.com/gulatnaru/yaho-management/actions/runs/38926417254), detect job `117058994975`, migration job `117059222501`, final job `117070008327` | Historical run currently returns detect SUCCESS, migration CANCELLED / no steps, final gate FAILURE. Old Memory's WAITING statement is stale. Not a current-head or live-DB proof; no final Production PASS established. |

Git continuity inspected: `3e9fef5..29ca882` has no changes under `app`, `lib`, `server`, `components`, `prisma`, `tests/unit`, `tests/integration`, or `tests/e2e`. Still report CI merge checkouts honestly and confirm relevant merge-source contents before carrying results into a final claim. No claim of exact-head execution for merge-ref CI.

Current-head Production Gate discovery remains incomplete: the connector's commit workflow listing is PR-event-only and does not establish `pull_request_target` gate state; a read-only `gh run list` fallback was denied by the network sandbox. Do not retry through a DB, infer absence of a gate, or call an old cancellation a current waiting approval. Record this metadata gap as BLOCKED. No secrets or raw fixture data belong in the report.

## Data Model

**No schema changes; no migration required or permitted.** No Prisma generation, validation command, migration/status probe or DB connection is needed for this document audit. Read schema/migration text only.

| Existing records / sources | DB-enforced facts to inspect | Server rules that need separate inspection/evidence |
| --- | --- | --- |
| `prisma/schema.prisma:506` / `:537`: ReservationApplicationSubmission / ReservationApplication | Parent/child relations, restrictive FKs and stored quote/consent/status/purge fields; existing migration checks | Family ownership, immutable quotes, required acknowledgements, selection scope and legacy-vs-modern branching |
| `prisma/schema.prisma:683`, `:701`, `:712`, `:731`, `:747`: ApplicationDeposit, ReservationApplicationPaymentMapping, ReturnObligation, ApplicationReturn, FundAllocation | Unique deposit/return keys and mapping application/item IDs; restrictive FKs; `@@unique([applicationId, kind])` | Per-submission funding sums, allocation totals, FIFO, no cross-family funding and held-funds non-reuse are not proven by row uniqueness alone |
| `prisma/migrations/20261006090000_phase20_reservation_application_enhancements/migration.sql:164`, `:184`, `:195`, `:205` | Positive deposit/return amounts, return bounds, allocation exactly-one-target/positive check | Sum consistency and conservation require transactional writers/read validation; inspect all callers rather than assuming a global DB assertion |
| `prisma/schema.prisma:800`, `:819`, `:838`: Payment / PaymentItem / Refund; `:273`: ChildConsent | Reservation/item uniqueness, existing refund limits and relationships; consent storage fields | One-time conversion of selected quotes, refund/Revenue separation, append-only business path and expired-retention exception |

Do not import AI-service cost-ledger or 90-day consultation-retention semantics into the reservation ledger. The pending production delta `prisma/migrations/20261015090000_ai_service_followup/migration.sql` is pre-existing and unrelated; inspecting its identity is not approval to alter/apply it.

## API

No new API, Server Action, provider or response DTO. Audit the existing server boundary:

- `app/(admin)/reservation-applications/actions.ts`: require ADMIN before validation/DB/core calls; inspect direct confirmation, deposit, return, resolution, settings, link, projection/receipt and purge actions, including wrapper/helper delegation.
- `lib/auth/authorization.ts:35`, `:85`, `lib/auth/principal.ts`, and `app/(admin)/layout.tsx:47`: live principal resolution and role boundaries. Layout authentication alone does not prove ADMIN authorization for each query/action.
- Public actions at `app/(public)/apply/[token]/actions.ts`, `group/[token]/actions.ts`, completion actions, and `app/api/reservation-applications/repeat-children/route.ts`: token/device/expiry/ownership validation, current consent/price checks and no-store response boundaries. Do not issue HTTP requests against Preview or Production.

## UI

No UI change. Server Components retain reads/authorization and reduced props; client forms/controllers retain interaction and explicit recovery. Inspect both sides: button disabling cannot establish server safety, and server tests cannot establish mobile interaction/accessibility.

Read `app/(admin)/reservation-applications/page.tsx`, `submissions/[id]/page.tsx`, `[id]/page.tsx`, `groups/page.tsx`, `groups/[id]/page.tsx`, `returns/page.tsx`, `settings/page.tsx`, `retention/page.tsx`, their queries and client forms. Read public legacy/group/companion/completion pages and their form props, HTML/RSC/API projections, loading/empty/error behavior and browser persistence. No browser/server startup in 6C.

### Area 1 — Evidence preservation (E1, E2)

**Sources:** EV-B6/EV-PRES/EV-INT/EV-I5/EV-INSTALL/EV-UX/EV-GATE; `docs/OBS-01-PERF-RESULTS.md:140`; `tests/performance/support/contract.ts:99`; `.github/workflows/phase2-integration.yml`; Git objects `37e7db4`, `eebfa47`, `29ca882`.

**Inspection:** (1) Verify baseline and two-file scope. (2) Identify final authoritative 6B section and keep earlier failed attempts historical. (3) Record run/job/checkouts, environment, counts and evidence kind; distinguish user closing date 2026-10-24 from CI's UTC log timestamps on 2026-10-23. (4) Inspect strict COMPLETE admission without executing it. (5) Compare workflow before/after `29ca882`: removal of `obs01-perf` only, unchanged `integration`. (6) Check source continuity for reused cases. Preserve references and sanitized aggregates in the future report; do not copy whole logs or download new benchmark artifacts.

**Expected output / mapping:** E1 historical measured/contract evidence row, E2 preservation/removal static row, P2 recommended priority. Missing log access is an explicit evidence-access BLOCKED row; it does not reopen 6B. The 18 truncated rows' detailed latency numbers stay unavailable; financial COMPLETE status retains its stated contract basis. No optimization recommendation.

### Area 2 — Ledger integrity (L1–L4)

**Sources:** `server/reservation-applications/finance.ts:124` (submission lock), `:144` (return reconciliation), `:189` (deposit), `:236` (batch confirm), `:280` (reconcile/available gate), `:379` (Payment/items/mapping/allocations), `:408` (actual return); `app/(admin)/reservation-applications/actions.ts:201`, `:225`, `:248`, `:305`; `lib/reservation-applications/ledger.ts:15`, `:38`, `:43`; `lib/reservation-applications/ledger-summary.ts`; `server/reservation-applications/confirm.ts:39`; `server/revenue/queries.ts` / `server/revenue/aggregate.ts`; `app/(admin)/payments/actions.ts:88` and `lib/payments/core.ts`. EV-INT and EV-B6; `tests/performance/support/invariants.ts:29`, `:42`, `:48`, `:82`; `tests/performance/support/contract.ts:120` counters LEDGER, AVAILABLE_BACKING, HELD_FUNDS, EXACT_LINKAGE, NO_RECONFIRMATION, FIFO, ROLLBACK_STATE and RACE_SINGLE_WINNER; existing full-journey invariant checks.

**Inspection:** (1) Trace ADMIN input → stored amount/date/actor → funding allocations; customer notification is not a bank confirmation. (2) Define D/A/P/R/T and independently follow both writers and read-summary validation; `R=funded obligations−T`, and total reserved allocation is `R+T`. (3) Trace insufficient funds, rejected/cancelled sibling holds, fragmented FIFO deposits, excess funds and partial returns. (4) Trace selected quotes to one Payment and one mapping/item per child; verify errors abort the enclosing transaction. (5) Follow post-confirmation Refund into existing Revenue only; check it never replenishes A. (6) Inspect all write references to these models to detect bypasses. (7) Inspect legacy `confirmReservationApplicationCore` separately. (8) Split recorded-ledger consistency from actual-bank truth.

**Named existing cases:** `tests/integration/reservation-applications/confirmation-atomicity.test.ts:64` “Scenario A confirms ONLY 40000 after rejected 60000 and returned 20000: D100000 P40000 R40000 T20000 A0”; `:91` “sufficient D cannot spend funds held for a rejected sibling, and insufficient A rolls back”; `:136` FIFO; `:170` post-confirmation Refund; `:177` legacy no automatic Payment. `workflow-races.test.ts:78` “40000/60000 quotes, 30000+70000 deposits, rejection and 20000 partial return conserve every ledger term”. EV-INT has 26/26 and 10/10 for these files. EV-B6 NORMAL/SUBSET/FRAGMENTED/RETURN-HOLD/INSUFFICIENT/HELD-FUNDS INSUFFICIENT and invariant contract supply complementary synthetic evidence, not bank reconciliation.

**Expected output / mapping:** L1 recorded-vs-confirmed amount map and separate actual-bank BLOCKED row; L2 conservation/non-reuse rows; L3 mapping/refund separation rows; L4 legacy compatibility row. Use executed evidence within its cases; list code-reading deductions separately. Financial gaps, if concrete, are P0 separate approval items; bank-reconciliation readiness P1. No bank statements/customer PII are requested or copied in 6C.

### Area 3 — Concurrency and failure (C1–C4)

**Sources:** finance/action locations above; `server/reservations/create.ts`; `lib/children/lock.ts`; `app/(admin)/reservation-applications/submissions/[id]/confirmation-form.tsx`, `workflow-controller.tsx:19`, `deposit-form.tsx`, `app/(admin)/reservation-applications/returns/return-form.tsx`; `tests/integration/reservation-applications/confirmation-atomicity.test.ts:108`, `:114`, `:120`, `:124`, `:149`, `:162`, `:166`; `workflow-races.test.ts:91`, `:97`, `:117`; EV-INT and EV-B6. Unit workflow-controller/admin-actions/confirmation-selection tests and existing E2E confirmation/ledger specs supplement this evidence.

**Inspection:** (1) Trace parent → sorted applications → sorted classes → Child locks and post-lock state validation; inspect confirm-vs-return/deposit/purge callers for inversions. (2) Map sequential duplicate, paid/unpaid existing-reservation rejection, same-submission concurrent winner/loser and competing last seat separately. (3) Trace earlier Child/reservation/consent and later PaymentItem/mapping failure injection to transaction rollback. (4) Follow response-loss/read-failure/timeouts from client to receipt/detail reads; pending network work may still commit after client timeout. (5) Inspect deposit/return immutable-payload comparisons and keys in action adapters, not only core replay behavior. (6) Separate confirmation duplicate prevention (may return not-pending on retry) from same-result keyed receipt replay. No automatic financial write retry is assumed safe.

**Expected output / mapping:** C1 duplicate-prevention cases; C2 race cases including **six 6B race cells** with WINNER/LOSER/PAIR rows and `ApplicationNotPendingError` losers; C3 rollback cases; C4 recovery/idempotency matrix by operation. EV-INT also proves confirm-vs-return and response-loss case execution. Unknown production interleavings remain unknown, not a demand for a new stress suite. Concrete duplicate-spend/partial-commit gap P0; uncovered recovery evidence P1 approval proposal only.

### Area 4 — Access and privacy (A1–A4)

**Sources:** API/UI paths above; `lib/reservation-applications/{queries,family-queries,detail-queries,return-queries,link-queries}.ts`; `public-queries.ts:25`, `:31`, `:97`, `:102`; `completion.ts:18`; `server/reservation-applications/{groups,devices,price-review,confirm,retention}.ts`; `lib/reservation-applications/{consent-plan,consent-content,retention,last-reserved-class,errors}.ts`; `prisma/schema.prisma:273`, `:537`; EV-INT/EV-UX/EV-UNIT. Exact reused test cases are in the Tests table.

**Inspection:**

1. Enumerate every admin page, exported action and direct query. Map each to ADMIN check or documented guarded caller; follow helpers. Check unauthenticated/MANAGER/TEACHER denial with existing source/test evidence. Include settings, links, returns, retention, family counts and receipt/projection reads, not just confirmation. Do not call missing local auth mocks runtime evidence.
2. Build a surface × allowed fields × capability/role × evidence matrix for legacy/group/companion pages, review responses, submitted completion, repeat children, action errors, logs, caches, RSC props and browser storage. ADR-063 permits only assigned-link `applicationPrice` and own-child amounts, not global/default prices, capacity/availability or other-group/family data. Inspect closed/expired/revoked paths and no-store/dynamic declarations; code declarations alone do not establish CDN/production behavior. Do not reproduce tokens or PII in report examples.
3. Trace current required acknowledgement/version checks in `groups.ts:241` and submitted snapshots at `:329` / `:344` to application storage; then confirmation `finance.ts:375` and `confirm.ts` to ChildConsent at submission time. Distinguish confirmation-time actor from guardian-origin record, append-only current-state ordering, optional decline/revoke and purge exception.
4. Compare KST one/five-year rules and eligibility to `retention.ts`, candidate scan/re-read locks, `last-reserved-class.ts`, scrub fields and retained financial structures. Inspect `server/reservation-applications/retention.ts:222` parent PII only after every sibling is purged, `:232` deposit payer/return reason scrubbing, `:265` scoped confirmed policy, `:345` consent/safety deletion and `:362` device unlink/tombstone. Pending applications require resolution first; future reservations prevent purge. Manual batches are 500 applications / 100 children, not an automatic scheduler.
5. Identify policy coverage separately: REQUIREMENTS `:2380` legacy-customer scope, `:2381` transaction PII retention/cleanup, `:2382` undecided automation; `server/reservation-applications/retention.ts:272` deliberately retains Payment/Refund structure. Record unresolved retention/backup/operator evidence without choosing durations or deleting data. The presence of an approved manual process is not itself a defect.

**Expected output / mapping:** A1 entry-point matrix; A2 projection/surface matrix; A3 consent field/origin timeline; A4 expiry/field-retention matrix plus separate policy and operational rows. Bounded static controls may PASS as static facts, executed role/privacy cases as executed facts; unseen production logs/caches/backups are BLOCKED. A proven disclosure/auth bypass is P0; policy completeness or manual operational evidence P1. A policy gap with `REQUIREMENTS.md:2381` and retained-field code evidence is a separate approval item, not a new legal policy chosen here.

### Area 5 — Mobile WebKit (W1–W3)

**Sources:** EV-I5, EV-INSTALL, EV-UX; `docs/E2E_CI_ITERATION_5_REPORT.md`; `.github/workflows/e2e-ux.yml`; `tests/e2e/integrated-ux-{family-list,class-links,family-detail,ledger,confirmation,completion,guardian,full-journey}.spec.ts`; `tests/e2e/support/ux-reporter.ts:8` (three fixed BLOCKED cases and two Secure-cookie cases); `integrated-ux-confirmation.spec.ts:22`, `:47`; `integrated-ux-completion.spec.ts:229`; `integrated-ux-full-journey.spec.ts:15`.

**Inspection:** (1) Build timeline by run/project/job and UTC execution time. Keep last supplied completed checkpoint EV-I5 separate from later installation failures EV-INSTALL and newer retrieved completed result EV-UX. (2) Verify checkout, full selection, eight spec totals and actual test execution. (3) Preserve 360px 63 PASS / 0 FAIL / 5 admitted skips and Ledger 8/8 / Confirmation 7/7. (4) Give each skip its own BLOCKED row and exact missing setup. (5) List physical-device checks below as NOT EXECUTED. A zero-test failed installation neither disproves previous cases nor verifies current browser behavior.

| BLOCKED row | Existing evidence / exact missing prerequisite | Recommended priority |
| --- | --- | --- |
| W2-empty | `integrated-ux-family-list.spec.ts:188`, “first-ever zero has a different message”; populated fixture DB cannot represent first-ever empty state; missing separately provisioned empty authenticated server | P1 |
| W2-list-error | Same file `:192`, “failed read displays retry rather than zero or success”; missing controlled authenticated server read failure | P1 |
| W2-detail-error | `integrated-ux-family-detail.spec.ts:112`, “shows retry without a success/zero-balance fallback”; missing controlled authenticated detail read failure | P1 |
| W2-completion | `integrated-ux-completion.spec.ts:229`, successful-submit document replacement/reload/back scenario; missing approved WebKit environment where existing Secure completion cookie works, since required HTTP loopback rejects it | P1 |
| W2-journey | `integrated-ux-full-journey.spec.ts:12`, ADMIN → issued link → two children → bank record → selected reservation; same WebKit Secure-cookie/HTTP-loopback blocker, no WebKit end-to-end money-flow pass | P1 |

No new fixture mode, fault-injection hook, HTTPS harness or cookie relaxation in 6C. Existing lower-level financial integration/confirmation evidence stays usable and does not turn these skipped flows into passes.

Real iPhone Safari and VoiceOver checklist (W3, all **BLOCKED / NOT EXECUTED**): record device/iOS/Safari version and approved origin; 360-class narrow layout/zoom/dynamic text; form keyboard/scroll and date/phone entry; multi-child selection and price review; validation/error focus; consent reading/order and announcements; submit/refresh/back without duplicate family; Secure-cookie completion; copy/share denial and manual fallback; ADMIN deposit/confirmation touch interaction and explicit lost-response recovery. VoiceOver requires real focus order, labels, rotor navigation, live-region announcements and error recovery. Instagram/Kakao in-app browser behavior is a distinct optional evidence row if claimed; Safari/WebKit does not prove it. Missing hardware/operator session and origin approval cannot be supplied by source reading. Recommend P1 separate verification approval, with synthetic data only.

**Expected output / mapping:** W1 executed historical/latest cases plus separate install-attempt environmental blocker; W2 five exact skip rows; W3 real-device rows. Do not combine skips with passes, mark latest completed evidence absent when EV-UX exists, or claim real Safari/VoiceOver from desktop WebKit.

### Area 6 — Pre-production approvals (P1, P2)

**Sources:** EV-GATE and current PR metadata; `.github/workflows/production-schema-gate.yml:1`, `scripts/release/schema-change.ts`, `production-migration.ts`, `production-smoke.ts`, `.github/workflows/production-release-verify.yml`; `prisma/migrations/20261015090000_ai_service_followup/migration.sql`; REQUIREMENTS Phase 21 follow-up; ADR-051/061/062. Read text only. Existing `docs/LAST_RUN_REPORT.md`/Memory may describe old approvals; compare them with run identity before reuse.

**Inspection:** (1) Identify pending schema delta as pre-existing AI-service follow-up; no new reservation migration. (2) Separate last known unapproved delta from individual run outcomes; EV-GATE is cancelled/failed, not currently waiting. Current-head gate metadata and live Production applied/drift state remain unverified. (3) Inspect environment approval, trusted tooling/base vs approved payload/head, exact-head rechecks, identity/preflight/verify steps, non-cancelling production concurrency and final gate. A workflow declaration is a static control, not proof that settings or migration succeeded. (4) List dependencies below without executing/approving anything.

| Approval/evidence required before the respective production action | Missing or review requirement; no action in 6C |
| --- | --- |
| Audit acceptance and blocker disposition | Operator reviews report and separately accepts required evidence/risks; no implied production approval from financial CI PASS |
| Policy/privacy operational readiness | Authorized owner decides outstanding retention/backup/disposal and customer-data handling questions; real-device evidence or explicit owner disposition recorded |
| Stacked-PR/source review | PR #54 depends on Mock PR #53/base `1171517`; base review/merge strategy and exact final candidate need separate approval; both remain Draft here |
| Migration payload approval | Approve exact candidate SHA and only intended pre-existing delta, review effects/RLS/permissions, backup/recovery and failure plan; schema content review is not DB execution permission |
| Production Environment human review | Authorized reviewer checks current-head gate, protections and serialized run. Never approve/cancel/rerun or bypass from 6C |
| Production DB access/preflight authorization | Separate permission for identity, applied/pending migrations and drift checks; approved expected migration set and safe connectivity. No read-only DB probe now |
| Migration execution and post-verification | Approved preflight, deploy, verify and final schema gate SUCCESS on exact candidate; failures/drift block release. Do not mark completion from a pending/cancelled/unknown job |
| Merge authorization | Explicit human approval after required CI/schema gates and review; no merge while CI fails, no direct main push |
| Deployment/release authorization | Exact source/environment and runtime configuration review, deployment approval and approved smoke/release verification/rollback ownership; no deployment now |
| AI live activation, only if separately requested | Existing legal/privacy/external-provider/Kakao/OpenAI/cron gates remain independent and closed; reservation audit or AI migration approval does not authorize live AI processing |

**Expected output / mapping:** P1 gate timeline/unapproved-delta static facts and separate current-gate/live-DB BLOCKED rows; P2 approval checklist with owner role, evidence needed and status “required/unverified”, never “approved” without named authorization. Missing production safety approval is recommended P0 for release gating; identifying that gate is not a product defect.

## Tests

**Execution policy:** zero new tests and zero test execution in this task or the proposed evidence-reuse audit. No DB-backed test, perf entry point/self-check, browser install, CI rerun, database service, seed or migration. No new fixtures/assertions. Read existing test source and prior results only. Unit/CI evidence lacking exact execution/source linkage stays pending evidence/BLOCKED, not PASS by existence. A needed test becomes a separate proposal describing the uncovered rule, why existing cases are insufficient, smallest case, safe environment and approval owner.

The mapping below satisfies the role's server-rule/money/permission/privacy acceptance-case requirement using existing locations; UI criteria have E2E mappings of their own.

| SPEC / requirement / ADR | Required result | Normal / rejection or race cases (existing names) | Level and existing location | Result/evidence use |
| --- | --- | --- | --- | --- |
| L1–L3; Phase 20, ADR-060 | D=A+P+R+T; only selected quote becomes Payment | “Scenario A confirms ONLY 40000 after rejected 60000 and returned 20000: D100000 P40000 R40000 T20000 A0”; held funds/insufficient A rejection; FIFO case | integration: `tests/integration/reservation-applications/confirmation-atomicity.test.ts:64`, `:91`, `:136`; workflow-races `:78` | EV-INT: files 26/26 and 10/10; EV-B6 corroborating invariants |
| L3; ADR-007/036/039/040/060 | Refund affects existing Revenue, not A/P or pre-confirmation returns | “post-confirmation partial/full Refund changes existing Revenue only; A/P and pre-confirmation returns are unchanged” | integration: confirmation-atomicity `:170`; static `server/revenue/*` | EV-INT executed case, source rule trace |
| L4; ADR-052/053/060/063 | Legacy has no auto-Payment or invented quote | “legacy keeps deposit timestamp confirmation with NO automatic Payment, followed by explicit manual payment” | integration: confirmation-atomicity `:177`; unit `confirm.test.ts` | EV-INT for modern/legacy boundary; unit result provenance EV-UNIT |
| C1/C2; ADR-023/060 | One winner, no second mapping/Payment or silent last-seat overflow | “two admins simultaneously confirming one selection create exactly one Payment and one Mapping per child”; duplicate existing Child/paid reservation; competing last seat; confirm-vs-return | integration: confirmation-atomicity `:120`, `:124`, `:149`, `:162`; perf test `tests/performance/reservation-applications/obs-01.perf.ts` | EV-INT and six EV-B6 race cells / duplicate scenarios; perf never rerun |
| C3; Phase 20 atomic batch | Later failure rolls back earlier and financial writes | “one later Child failure rolls back an earlier actual reservation/Child/consent write”; “failure after PaymentItem/Mapping writes rolls back all reservations, payments, allocations and statuses” | integration: confirmation-atomicity `:108`, `:114` | EV-INT 26/26 file |
| C4; ADR-060 | Stable-key replay prevents duplicate money; changed payload refused; recovery reads only | “response-loss read is authoritative; repeated writes cannot duplicate committed mappings”; “rejects changed payload under a contended key; recovery is read-only”; stale returns | integration: confirmation-atomicity `:166`; workflow-races `:91`, `:97`, `:117` | EV-INT; inspect deposit/return adapter payload checks too |
| A1; ADR-050/053/060 | ADMIN-only direct calls before DB/core | “blocks MANAGER and TEACHER (requireAdminPrincipal → notFound) before any core runs”; existing unauthorized HTML/RSC E2E cases | unit `tests/unit/reservation-applications/admin-actions.test.ts:143`; E2E family-list `:158`, family-detail `:96`, ledger `:199`; queries' unit tests | EV-UNIT historical scope linkage; EV-UX executed role surfaces; no blanket authorization claim |
| A2; ADR-063/064 | Valid-link own prices only; closed/cross-family/device requests expose nothing | “selects only positive current applicationPrice within the supplied active group capability”; “invalid, stopped, revoked and inaccessible capabilities return no price data”; “price review is read-only and returns only assigned in-scope prices” | unit `public-queries.test.ts:202`, `:214`; integration `price-recheck.test.ts:95`, `:185`, `:253`, `:299` | EV-INT price-recheck 26/26; EV-UNIT for projection tests; static surface matrix |
| A2; ADR-060 | Device capability never phone-match ownership | “returns only active, unpurged children from the opaque device capability”; “does not return a granted child after the child's guardian changes” | unit `phase20-devices.test.ts:6`, `:25`; integration price-recheck foreign-device/purge cases | EV-UNIT historical unit evidence; EV-INT executed cases |
| A3; ADR-008/055/056/060 | Mandatory current consent, submission-time version and optional decline/revoke | “latest consent version is checked independently from signed prices”; “records declined optional consents for a new child instead of leaving them unrecorded”; “appends a withdrawal for an existing photo sharing agreement and a decline when none existed” | integration price-recheck `:260`; unit `confirm.test.ts:190`, `:204`, `group-public-action.test.ts`; batch-confirm consent invariant | EV-INT / EV-B6; unit history linked before execution claim |
| A4; ADR-055–058/060 | KST expiry, scoped/manual purge; no future-reservation/purged-child resurrection | “keeps data through the last retention day and expires the next KST day”; “scoped purge and confirmation serialize against requested Child without resurrecting purged data” | unit `retention.test.ts:97`, `:391`, `:440`; integration confirmation-atomicity `:182`; E2E `phase18-retention-concurrency.spec.ts:209`–`:382` | EV-INT scoped race executed; historical E2E concurrency has no retrieved matching result: existence alone cannot PASS |
| W1/W2; mobile UI and server-recovery distinction | Explicit NEW selection, sibling unaffected; lost-response recovery works in executed UI scope | “360px explicit NEW choice confirms first only; sibling memo draft and original request survive”; “lost response reconciles actual Reservation/Payment without replay”; existing eight-spec suite | E2E `integrated-ux-confirmation.spec.ts:22`, `:47`; ledger and other integrated specs | EV-I5/EV-UX 360px Ledger 8/8, Confirmation 7/7; five separate BLOCKED skips |
| W3; mobile accessibility | Physical Safari/VoiceOver interaction and announcements | Approved real-device checklist above | real-device manual E2E; no matching executed record | BLOCKED / NOT EXECUTED; no new automated test in 6C |
| E1/E2/P1/P2; ADR-051 | Preserved evidence and production approvals remain explicit | Git/workflow/report inspection; no operational test | static: results, workflows, `scripts/release/*`, existing `tests/unit/release/schema-change.test.ts` as coverage reference | Executing schema gate/DB validation N/A: forbidden. Runtime production state BLOCKED |

## Acceptance Criteria

| Scope IDs | Final report rows / expected evidence | Classification rule / recommended priority |
| --- | --- | --- |
| E1/E2 | Final 6B preservation, CI inventory, tested-source continuity and job removal | PASS only for preserved/directly verified facts and bounded recorded execution; unavailable detail BLOCKED; P2 |
| L1 | Recorded D vs selected quotes/Payment; separate bank truth | Existing executed scenarios eligible PASS; actual bank reconciliation BLOCKED; financial mismatch if demonstrated 개선 필요 P0, external evidence P1 |
| L2/L3 | Conservation, R+T funding, non-reuse, mappings/FIFO, Refund/Revenue separation | Named execution and direct source facts separated; actual defect 개선 필요 P0; missing live ledger evidence BLOCKED |
| L4 | Legacy timestamp/no-auto-Payment/NULL compatibility | Named test/source scope only; concrete regression 개선 필요 P0/P1 by impact |
| C1/C2 | Sequential duplicate, paid/unpaid duplicates, same-submission/last-seat/return races | EV-INT/EV-B6 executed limits; unexecuted interleaving never PASS; concrete race defect 개선 필요 P0 |
| C3/C4 | Rollback stages and operation-specific retry/recovery | Named executed cases plus source boundary; uncovered/production network evidence BLOCKED P1; concrete duplicate/partial-commit gap 개선 필요 P0 |
| A1/A2 | Admin-entry and public-surface matrices | Direct controls STATIC vs executed denial/projection evidence; live configuration/cache/log gaps BLOCKED P1; demonstrated leak/bypass 개선 필요 P0 |
| A3/A4 | Consent/version/time and retention field/scope/lock map | Implementation facts and executed cases bounded; unresolved transaction retention 개선 필요 policy item P1 with REQUIREMENTS:2381 and code:272; actual backup/operator effectiveness BLOCKED P1 |
| W1/W2/W3 | Completed/attempt timeline; five skip rows; real-device list | 63 executed WebKit cases eligible PASS; install-only attempt zero executed; five skips and physical iPhone/VoiceOver BLOCKED P1 |
| P1/P2 | Unrelated migration identity, gate timeline and approvals checklist | Workflow facts may STATIC PASS; current-head gate/Production facts/approvals BLOCKED; P0 release prerequisite, no authorization implied |

Completion means every SPEC ID has evidence or an explicit blocker/gap and recommended priority, not that every row is PASS. No single overall “production ready” verdict while required approvals or environmental coverage remain open. New test/fix requests have separate approval IDs, not code changes.

## Risks

Likelihood × impact is an **a priori qualitative triage**, not measured defect probability. Scale 1 low / 2 medium / 3 high; score 1–9 orders investigation. Unknown runtime likelihood is explicitly marked unknown; the provisional number only sets review order. Priorities are recommendations, not authorization.

| Area | Likelihood × impact / provisional score | Risk / what remains unknown | Mitigation in this PLAN |
| --- | --- | --- | --- |
| 1 Evidence | 2 × 2 = 4 | Historical NOT RUN text, truncated perf rows or merge-ref identity could overstate/understate proof; log retention/access longevity unknown | Preserve final-section hierarchy, contract vs visible evidence, identities and sanitized durable references; no rerun |
| 2 Ledger | 2 (production likelihood unknown) × 3 = 6 | D may differ from actual bank truth; held-funds double counting or incorrect refund reuse has high financial impact; actual production balances unobserved | Trace all writers and summaries, reuse invariants/negative cases, separate bank truth BLOCKED; P0 if concrete gap |
| 3 Concurrency | 2 (unobserved interleavings unknown) × 3 = 6 | Rare retries/races could duplicate or partly commit funds; synthetic tests do not enumerate all schedules or production network outcomes | Read lock/order/transaction/adapters and client recovery; reuse six race cells, rollback and integration cases |
| 4 Access/privacy | 2 (live exposure unknown) × 3 = 6 | Cross-group/family projections, stale capabilities, consent loss or incomplete retention operations could expose personal data; CDN/log/backup state and transaction-PII retention completeness unknown | Server-entry/surface and field-retention maps; identify concrete policy gaps; live state BLOCKED |
| 5 Mobile WebKit | 3 (known missing coverage) × 2 = 6 | Five admitted skips and no physical iPhone/VoiceOver evidence; actual accessibility and Secure-cookie HTTPS flow unknown despite completed 360px cases | Preserve PASS scope, enumerate each blocker/device check and missing prerequisite; no harness/cookie change |
| 6 Production approvals | 3 (known missing approval/current evidence) × 3 = 9 | Wrong migration/head or unapproved deployment could affect production; current gate, drift, runtime settings, backups and recovery readiness unknown | Keep unapproved AI-service delta separate; list gates/owners and evidence; no DB/release action; P0 prerequisite |

### Separate approval register (proposal structure; no fixes in 6C)

| Candidate ID | Evidence / concrete gap or missing proof | Impact and recommendation |
| --- | --- | --- |
| AP-6C-RET | `REQUIREMENTS.md:2381` explicitly leaves transaction-record PII retention/cleanup undecided; `server/reservation-applications/retention.ts:272` preserves Payment/Refund records. `:232` scrubs application-ledger PII only when all sibling applications are purged | Existing manual purge does not establish end-of-life coverage for all transaction PII. P1 policy completeness item: owner approves scope/duration/disposal/backup handling separately; no invented period or deletion job. Not a claim that current code violates an already accepted duration |
| AP-6C-DEVICE | No real iPhone Safari / VoiceOver execution record; W3 checklist | P1 verification approval for device/operator/origin and synthetic-only session; all associated runtime assertions BLOCKED |
| AP-6C-UX | W2 five admitted skips and exact missing environments | P1 if required before release: review smallest missing verification individually. A new test/environment/hook must explain why current integration/E2E is insufficient; no broad suite or harness redesign authorized |
| AP-6C-RELEASE | P1/P2 gate evidence/approvals unavailable; pre-existing AI migration | P0 production prerequisite: obtain current exact-head metadata and separate human/DB/release approvals; no operational action here |
| AP-6C-FIX-n | Reserved for a concrete later audit finding: exact baseline `file:line`, expected requirement/ADR, observed code/result, impact and evidence limits | Recommend P0/P1/P2 by actual impact; define minimal proposed fix and targeted verification. If only a hypothesis, keep INFERENCE/BLOCKED, not a proven defect. Implementation always separate approval/developer workflow |

No bank reconciliation issue is asserted merely because no bank source is available; classify that missing external verification BLOCKED. Likewise missing physical-device proof is not a demonstrated product defect. Distinguish these from AP-6C-RET's documented policy-completeness gap.

## Implementation Order

This is the order of **audit documentation**, not product implementation. Steps after this PLAN require approval for the audit/report task; none authorizes tests, DB access, commits, merge or deployment.

1. Freeze baseline/scope and evidence inventory (Area 1). Verify unchanged source and workflow removal with read-only Git inspection. Output identities and preservation rows; independently reviewable without any runtime access.
2. Trace ledger writers, projections and existing executed assertions (Area 2). Output D/A/P/R/T definition, writer-to-test matrix, legacy distinction and bank-verification blocker. Stop any check needing a DB; keep progressing through independent evidence.
3. Trace races/rollback/recovery (Area 3). Output operation-specific duplicate/idempotency/rollback table and existing execution links. Record uncovered cases as approval proposals instead of adding tests.
4. Trace access/privacy/consent/retention (Area 4). Output entry-point, exposure-surface and scrub/retain maps. Record policy questions without resolving business/legal choices.
5. Reconcile mobile execution timeline and skips (Area 5). Output historical and latest-completed 360px facts, install-only attempts, five blockers and real-device NOT EXECUTED list. No browser setup or real-device session now.
6. Read production controls and enumerate approvals (Area 6). Output historical/current-state distinctions and unapproved-delta checklist. Current-head metadata absence stays BLOCKED; no operational probe.
7. Write only the separately authorized `docs/ITERATION-6C-REPORT.md` using the structure below. Check each SPEC ID maps to an atomic row, every PASS cites its precise evidence scope, every gap has location/impact, and every blocker states what is missing. User approval of this PLAN alone does not override the current two-file write restriction; obtain report-task authorization before creating it.
8. Review document consistency/links/source references and scope with read-only tools. No lint/test/build necessary for these Markdown outputs; `git diff --check`, path/status and baseline verification suffice. No stage/commit/push. Report completion using Changed / Tests / Lint / Build / Risks / Next.

### Final `docs/ITERATION-6C-REPORT.md` structure (not created in this task)

1. **Audit identity and limits:** baseline, branch, PR, audit date/observer, allowed read-only methods, no test rerun/DB access/perf/implementation/Git operations.
2. **Evidence inventory:** EV IDs, file/section/line, full test names, run/job/attempt if retrievable, PR head and actual merge/head checkout, environment/time, result/counts/skips, evidence kind and visibility/access limits; 6B CLOSED.
3. **PASS / BLOCKED / 개선 필요 table:** columns `row ID | SPEC ID / area | bounded claim | classification | evidence kind | file:line + test/result + CI link | unknown/missing prerequisite | impact | recommended priority | separate approval ID / owner`. Split static facts, measured outcomes and inferences into different rows; never give inference a runtime PASS.
4. **Six area findings:** evidence preservation; ledger equation/writer map and bank limit; concurrency/retry table; entry-point/projection/consent/retention maps; 360px historical/attempt/latest-completed timeline and five skips; production gate/delta/approval checklist.
5. **Real iPhone Safari / VoiceOver:** NOT EXECUTED checklist and exact missing hardware/origin/operator evidence, independent of WebKit success.
6. **Risk assessment:** likelihood × impact per area, unknowns, evidence limits and release dependencies; no inferred all-clear.
7. **Separate approval items:** concrete improvements with baseline locations/impact; missing-test proposals only where existing proof is inadequate; policy/device/release approvals, owner and minimal suggested follow-up. No implementation.
8. **Completion report:** Changed / Tests / Lint / Build / Risks / Next, distinguishing reused historical executions from checks actually performed. State report completion separately from production readiness, which remains subject to listed blockers and approvals.
