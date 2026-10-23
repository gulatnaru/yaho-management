# Iteration 6C — completed QA audit

Audit date: 2026-10-24 UTC. Baseline HEAD: 29ca8829b312ad89365b7b99c86e06b3333db355; branch: feature/phase21-ai-service; [PR #54](https://github.com/gulatnaru/yaho-management/pull/54): OPEN, Draft, unmerged at inspection. Inputs: [SPEC](ITERATION-6C-SPEC.md), [approved PLAN](ITERATION-6C-PLAN.md), REQUIREMENTS.md and docs/DECISIONS.md. The current report request supersedes the preparation documents' earlier “future report/proposed approval” wording.

Only this report was written. Product code, tests, workflows, configuration, SPEC, PLAN and Memory were not changed. No DB connection, perf harness/self-check, test rerun, app server, browser installation, CI trigger, approval, deployment, staging, commit or push occurred. Existing CI logs and metadata were retrieved read-only. No raw fixture data, capabilities, credentials or environment values are reproduced.

The yaho-qa skill was read. The explicit report-writing request permits this one document despite that skill's general no-edit rule. MEMORY.md was read as supporting context; agent-memory-repo/SKILL.md was absent from the searched installed/project skill locations, as also recorded in PLAN. Memory supplied no operational authorization.

## Summary and counting

Counts below refer only to the uniquely numbered finding rows E01–P07, not to test cases, supporting inventory entries or repeated approval references. PASS is bounded to the cited execution or directly observed source fact. There is no overall production-readiness approval.

| Area | PASS | BLOCKED | 개선 필요 |
| --- | ---: | ---: | ---: |
| 1. Evidence preservation | 5 | 1 | 0 |
| 2. Ledger integrity | 7 | 1 | 0 |
| 3. Concurrency and failure | 9 | 1 | 1 |
| 4. Access, privacy, consent and retention | 12 | 3 | 2 |
| 5. 360px WebKit and physical-device verification | 3 | 13 | 0 |
| 6. Pre-production approvals | 3 | 4 | 0 |
| **Total: 65 finding rows** | **39** | **23** | **3** |

Evidence vocabulary:

- **EXECUTED**: an existing named CI test/result, with its run/job and source identity. Nothing was re-executed in 6C.
- **STATIC**: a directly observed source/history fact; a PASS states only that fact, not an inferred runtime guarantee.
- **CONTRACT**: published COMPLETE plus the inspected admission contract; preserves 6B's established visibility boundary.
- **SUPPLIED**: historical/user context, attributed as such and insufficient alone for a new runtime PASS.
- **INFERENCE**: reasoning from source, never a runtime PASS. Ledger behavior claims use EXECUTED; the separate writer/guard explanations use INFERENCE explicitly.

P0/P1/P2 are recommended review priorities, not authorization. BLOCKED means the stated evidence or prerequisite is missing, not that the product failed. The three improvement rows identify concrete code/policy gaps; their separate approval scopes appear below.

## Evidence inventory and source continuity

All run timestamps below are 2026-10-23 UTC. The 6B report's finalization heading uses 2026-10-24; this does not change the execution timestamps.

| Evidence | Retrieved execution / source identity | Result and limit |
| --- | --- | --- |
| EV-B6 | [Run 39983585312, obs01-perf job 120517494083](https://github.com/gulatnaru/yaho-management/actions/runs/39983585312/job/120517494083); explicit checkout 37e7db44e56b4c615216defe1446ac19fb8feae2 | Job success. Header at 16:12:55: COMPLETE, cleanup PASS, self_checks 209, bootstrap A/B 1/1; start 16:05:53.507, finish 16:12:55.512. Dedicated synthetic loopback PostgreSQL 16.15, Ubuntu 26.04, three clients, one connection each. No production extrapolation. |
| EV-PRES | Local Git commits 37e7db4 → eebfa47 → 29ca882; docs/OBS-01-PERF-RESULTS.md:140 | Calibration correction → durable final result → temporary job removal. From perf-tested head to baseline only the results document and integration workflow differ. |
| EV-INT | [Run 39989509653, integration job 120537306955](https://github.com/gulatnaru/yaho-management/actions/runs/39989509653/job/120537306955) | At 16:47:12: 6 files / 87 tests PASS: confirmation-atomicity 26, workflow-races 10, price-recheck 26, class-link-issuance 12, family-queries 7, detail-queries 6. Ephemeral PostgreSQL 16; no skipped case in these six files. |
| EV-UNIT | [Run 39989509705, quality job 120537307593](https://github.com/gulatnaru/yaho-management/actions/runs/39989509705/job/120537307593) | Newly retrieved in this audit: 206 files / 2557 unit tests PASS at 16:47:05. Lint and Build steps success; compile success at 16:47:18. Examples: admin-actions 59, workflow-controller 27, retention 28, confirm 16, public-queries 18, phase20-finance 12, phase20-devices 3, payments/core 10. Mocked unit assertions retain their limits. |
| EV-I5 | [Run 39907935579, mobile-webkit-360 job 120271452015](https://github.com/gulatnaru/yaho-management/actions/runs/39907935579/job/120271452015) | Completed historical checkpoint: 63 PASS / 0 FAIL / 5 BLOCKED skips; eight specs, selectedSpecs=8, focused=false, failedSpecs=0, 06:18–06:20. PR head 3e9fef51d1ff912c055ff7e7226dfc607c601ca9; actual merge checkout c0b3819. |
| EV-INSTALL | [Run 39983585340, mobile-webkit-360 job 120516882630](https://github.com/gulatnaru/yaho-management/actions/runs/39983585340/job/120516882630) | Failure at “Install system dependencies after failed browser smoke”: APT step timed out after ten minutes at 16:15. UX execution skipped: zero UX tests executed. PR head 37e7db4; actual merge checkout 8da4a0f. Browser-binary installation was a different, successful step. |
| EV-UX | [Run 39989509694, mobile-webkit-360 job 120537308472](https://github.com/gulatnaru/yaho-management/actions/runs/39989509694/job/120537308472) | Latest completed execution retrieved for this baseline: 63 PASS / 0 FAIL / 5 BLOCKED skips, eight specs, selectedSpecs=8, focused=false, failedSpecs=0 at 16:53:33. Ledger 8/8; Confirmation 7/7. System-dependency fallback and subsequent engine recheck succeeded in this run. |
| EV-UX-OTHER | Same run; jobs 120537308214 (390px), 120537307992 (768px), 120537308366 (desktop Chromium) | All success; logs independently retrieved. Each WebKit project 63/0/5; Chromium 65/0/3. These are project-specific counts. |
| EV-GATE | [Run 38926417254](https://github.com/gulatnaru/yaho-management/actions/runs/38926417254), jobs 117058994975 / 117059222501 / 117070008327 | Historical detect success; production-migrate cancelled, no steps; final production-schema-gate failure. This is not a presently waiting approval or a current-head result. |

EV-INT, EV-UNIT and EV-UX checked out PR merge c1a1fc2d143bbd6dcb603bcf614979d2022c4ae0, merging baseline head into base 117151772552b16b6e81e3bbba23bb50e0826f0e. GitHub's read-only [head-to-merge comparison](https://github.com/gulatnaru/yaho-management/compare/29ca8829b312ad89365b7b99c86e06b3333db355...c1a1fc2d143bbd6dcb603bcf614979d2022c4ae0) returned ahead_by=1, behind_by=0, files=[]. Thus the compared contents match the baseline; these remain merge-checkout executions, not exact-head executions. The merge object is absent locally, so this comparison used GitHub metadata rather than fetching objects into the repository.

Local Git comparison 3e9fef5..29ca882 returned no changes under app/, lib/, server/, components/, prisma/, tests/unit/, tests/integration/ or tests/e2e/. The older completed UI checkpoint is therefore reusable within its recorded scope. It is not substituted for the newer completed run.

The read-only gh branch run listing and the workflow-specific production-schema-gate.yml listing both failed before returning metadata: the sandbox denied a socket connection to the configured proxy. No escalation was attempted. The GitHub connector returned the three commit-associated PR workflows above, which does not establish the latest pull_request_target gate state. Current-head gate discovery remains BLOCKED.

## 1. Evidence preservation — E1/E2

| ID | Finding / evidence | Classification / kind | Priority |
| --- | --- | --- | --- |
| E01 | Final 6B success is preserved at HEAD, docs/OBS-01-PERF-RESULTS.md:140, backed by EV-B6's named job/header, bootstrap/calibration, cleanup and 209 self-checks. 6B remains CLOSED. | PASS — EXECUTED | P2 |
| E02 | Commits 37e7db4, eebfa47 and 29ca882 exist in order. The final two commits preserve the result and remove only the temporary obs01-perf job/concurrency; the preceding integration definition matches byte-for-byte. .github/workflows/phase2-integration.yml:10 and :55; EV-PRES. | PASS — STATIC | P2 |
| E03 | Perf-head-to-baseline product/test source continuity and baseline-to-merge files=[] comparison were observed as described above. This is source continuity, not a claim that merge CI checked out HEAD directly. | PASS — STATIC | P2 |
| E04 | EV-INT identifies all six passing files, exact job and merge checkout; 87 is an inventory total, not evidence for an unnamed rule. Individual cases are mapped below. | PASS — EXECUTED | P2 |
| E05 | EV-UNIT independently supplies the complete 2557-test result plus historical CI lint/build success at matching source, strengthening the PLAN's previously historical-only unit inventory. | PASS — EXECUTED | P2 |
| E06 | Detailed measurements for the historical display-truncated 18 rows are not individually preserved as visible numbers in the authoritative report: INSUFFICIENT 6, HELD-FUNDS INSUFFICIENT 6, DUPLICATE UNPAID 3, DUPLICATE PAID 3. Missing: a retained complete per-row artifact for direct numeric review; no rerun or reconstruction proposed. | BLOCKED — CONTRACT visibility limit | P2; evidence owner |

The final record distinguishes 44 visible detailed rows from the other 18. The log returned to 6C also contained those 44 COMPLETE table rows and no detailed rows for the four negative-case groups above. COMPLETE admits exactly 50 cells / 62 rows: 44 single rows plus six race cells with WINNER/LOSER/PAIR. tests/performance/support/contract.ts:99, :105, :111, :120 and :124 enforce the matrix, 5/5 warmups, 30 attempted/settled/valid measurements, expected outcomes, environment/calibration, invariant counters and cleanup. A mismatch becomes INVALID/PROTOCOL. This CONTRACT basis preserves the 18 rows' completion/invariant assertions without claiming their unseen latency values. Earlier NOT RUN/INVALID attempt history and the old aggregate at results document :203 remain historical; they do not supersede :140.

## 2. Ledger integrity — L1–L4

D is ADMIN-recorded actual pre-confirmation deposits, P confirmed Payment allocations, T completed pre-confirmation returns, R funded but unreturned obligations, A available unallocated funds. Q is immutable quoted demand. Funded return allocations contain R+T: A=D−P−(R+T), and D=A+P+R+T. A post-confirmation Refund is separate. “Actual” here describes the operator's recorded bank event; the application does not prove the external transfer.

Every ledger behavior PASS below is **EXECUTED**. The following writer and equation explanations are separately labeled **INFERENCE from code reading**, not additional execution evidence.

| ID | Bounded executed claim / named evidence | Classification / kind | Priority |
| --- | --- | --- | --- |
| L01 | Stored deposit amount is distinct from declared/notification state and selected quote demand. “40000/60000 quotes, 30000+70000 deposits, rejection and 20000 partial return conserve every ledger term”, tests/integration/reservation-applications/workflow-races.test.ts:78, EV-INT. Notification remains null and no Reservation/PaymentItem/mapping appears before confirmation. Separately, **STATIC** field-persistence evidence: server/reservation-applications/finance.ts:205 writes payerName/depositedAt to ApplicationDeposit, declared at prisma/schema.prisma:687/:688; this test does not assert their persisted values. | PASS — EXECUTED | P0 |
| L02 | Existing quotes remain immutable after later class/default price changes: tests/integration/reservation-applications/price-recheck.test.ts:246, full case “existing submitted quotes remain immutable after later class/default price changes”, EV-INT. EV-B6 FIXED_QUOTES is complementary recorded evidence. | PASS — EXECUTED | P0 |
| L03 | Conservation and exact selected spend: “Scenario A confirms ONLY 40000 after rejected 60000 and returned 20000: D100000 P40000 R40000 T20000 A0”, confirmation-atomicity.test.ts:64, EV-INT. D remains 100000; P40000+R40000+T20000+A0. | PASS — EXECUTED | P0 |
| L04 | Held/returned funds cannot be reused: “sufficient D cannot spend funds held for a rejected sibling, and insufficient A rolls back”, confirmation-atomicity.test.ts:91; late/excess hold case workflow-races.test.ts:103; EV-INT. EV-B6 RETURN-HOLD and CONTRACT-admitted insufficient cells add synthetic scope. | PASS — EXECUTED | P0 |
| L05 | FIFO deposits, exact quoted item/mapping allocation: “FIFO allocations preserve the first and second deposit while each child keeps its quote”, confirmation-atomicity.test.ts:136; EV-INT. EV-B6 EXACT_LINKAGE/FIFO/AVAILABLE_BACKING validates its measured fixture matrix, not arbitrary live rows. | PASS — EXECUTED | P0 |
| L06 | After the partial post-confirmation Refund, Revenue is asserted as paidAmount 40000, refundedAmount 10000, netRevenue 30000 at confirmation-atomicity.test.ts:174, with the ledger unchanged at :172. After the item refund completes, :175 separately asserts ledger preservation (including A/P and pre-confirmation returns) and over-refund rejection; Revenue is not read again. Full named case :170, EV-INT. This case is sequential on one item; it does not cover C10. | PASS — EXECUTED | P0 |
| L07 | Legacy has timestamp-only deposit confirmation, NULL quotedAmount and no automatic Payment; explicit manual payment succeeds once and a duplicate fails. Full named case confirmation-atomicity.test.ts:177 and “legacy Phase 18 keeps amount-free single applications with no modern parent or ledger”, price-recheck.test.ts:325, EV-INT. | PASS — EXECUTED | P1 |
| L08 | External-bank reconciliation and actual live ledger truth cannot be verified here. Missing: authorized bank-to-ledger evidence, target identity and a separately authorized reconciliation review. No DB or bank source was accessed; there is no asserted bank mismatch. | BLOCKED — NOT VERIFIED | P1; finance/operator |

### Complete writer inventory

The search covered app/, lib/, server/, scripts/ and prisma/ for Prisma delegate mutations, raw SQL targets and dynamic persistence helpers, with test/performance writers inventoried separately. This matrix is **INFERENCE / source reading** for safety consequences; the file/line locations are directly observed. It does not promote all possible runtime paths to PASS.

| Model / write site | Purpose, caller and inspected boundary |
| --- | --- |
| Payment create; PaymentItem create | server/reservation-applications/finance.ts:379 and :386. One transaction includes selected Child/Reservation/status/consent writes, one Payment, quoted items, mappings and FIFO allocation. ADMIN adapter app/(admin)/reservation-applications/actions.ts:305, :315, :342; positive available-funds check finance.ts:280. |
| ReservationApplicationPaymentMapping create | finance.ts:390, same transaction. No separate production update/delete writer found. Unique applicationId and paymentItemId at prisma/schema.prisma:703 and :704; PaymentItem.reservationId unique at :822. |
| FundAllocation create | finance.ts:165 and :184 fund terminal/excess obligations; :400 funds confirmed items. Called inside submission-serialized deposit, close or confirmation transactions. No production update/delete writer found. |
| Payment / PaymentItem manual create | lib/payments/core.ts:58 and :69, createPaymentCore transaction. app/(admin)/payments/actions.ts:39 checks ADMIN at :43, validates Zod at the boundary and calls core at :50. Unique reservationId plus P2002 → DuplicatePaymentError at core.ts:83. This supports explicit legacy/manual payments; it does not bypass an existing mapped item. |
| Refund create; PaymentItem.refundedAmount update; Payment.status update | lib/payments/core.ts:136, :147 and :159, same transaction. app/(admin)/payments/actions.ts:88 checks ADMIN at :92 and calls core at :99. Item locked at core.ts:114; bounds at :131. Shared Payment aggregate synchronization gap is C10. |
| ApplicationDeposit create | finance.ts:204, submission lock :195; adapter payload comparison actions.ts:234–235. Deposit does not create Payment/Reservation. |
| ReturnObligation create/update | finance.ts:162–163 and :180–182 (funding/reconciliation), :442 (returned total/resolution). Invoked within deposit/close/confirm/return transactions. |
| ApplicationReturn create | finance.ts:440; submission → obligation locks :421/:426; fully funded and cumulative bounds :430/:439. Adapter compares immutable payload and observed totals at actions.ts:261–263. |
| ApplicationDeposit payerName / ApplicationReturn reason scrub | server/reservation-applications/retention.ts:233–234, only after every sibling application has been purged. Amounts, mappings, allocations and financial rows are preserved. This is a PII writer, not a new money event. |
| Synthetic Preview physical deletion | lib/e2e/phase20-cleanup.ts:202–205 deletes FundAllocation, mappings, PaymentItem and Payment after ownership/dependency checks at :139–155 and :175–196. Entry :66 uses the synthetic run marker and guarded caller/lease context, not ordinary retention. scripts/e2e/preview.ts:205 and scripts/e2e/phase21-preview-recover.ts:34 are callers. No cleanup executed. |
| Separate manual_test schema upsert/delete | server/manual-test/persistence.ts:13, :43, :155, :162 and :197–199 upsert Payment/PaymentItem and delete run-scoped tables including mappings/allocations. Refund persistence at :195. Explicit schema qualification/search-path check :61; run lock :67; item locks :77. HTTP wrappers app/api/manual-test/{payment,refunds,deposit}/route.ts:3 call handler.ts:56; production-disabled boundary auth.ts:106 and origin/session controls. These are synthetic-schema writers, not unguarded main-ledger endpoints. No runtime isolation claim is made here. |
| Perf fixture create/delete | tests/performance/support/fixtures.ts:63–64 (prior duplicate Payment/items), :98/:102/:108/:109 (allocations/mappings/items/payments cleanup), :50 (synthetic deposit ID adjustment). Integration/E2E fixtures also create/delete owned synthetic rows. These are test setup/teardown, not additional business entry points; none ran in 6C. |

**INFERENCE — equation/guard trace:** finance.ts:40 rejects allocated totals above deposits; :144 funds terminal applications before excess; :280 reconciles holds before available-funds admission; :399 allocates selected quotes FIFO using all prior allocations. lib/reservation-applications/ledger.ts:15, :38 and :43 validate allocation targets and bounds. ledger-summary.ts:7–24 computes R=funded−T and validates D=A+P+R+T; :42–69 checks individual mappings, quotes, items and actual-return sums, with no Refund input. Server revenue reads are server/revenue/queries.ts:68 and :92. Positive deposit/return/bounded obligation and exactly-one-target allocation CHECKs are in prisma/migrations/20261006090000_phase20_reservation_application_enhancements/migration.sql:164, :184, :195 and :205. These row constraints do not independently enforce every cross-row total.

**INFERENCE — quotes/legacy:** server/reservation-applications/groups.ts:324–345 writes current server-validated quote snapshots once; no main-ledger quotedAmount update writer was found. confirm.ts:44–49 rejects modern submissions from the legacy confirmation path; ledger-summary.ts:8 represents legacy amount as amount-unrecorded, not zero. There is no default-price substitution in that path.

## 3. Concurrency, atomicity and retry — C1–C4

| ID | Finding / evidence and scope | Classification / kind | Priority |
| --- | --- | --- | --- |
| C01 | Duplicate confirmation cannot create another mapping/payment: “response-loss read is authoritative; repeated writes cannot duplicate committed mappings”, confirmation-atomicity.test.ts:166; paid existing reservation rejection at :124; EV-INT. EV-B6 DUPLICATE UNPAID/PAID rows are CONTRACT-admitted rollback cases, not visible per-row numbers. | PASS — EXECUTED | P0 |
| C02 | Concurrent confirmation through two Prisma clients yields one fulfilled request, Reservation/PaymentItem/mapping counts [2, 2, 2] and conserved ledger P100000/A0: confirmation-atomicity.test.ts:120–122, counts helper :47, EV-INT. This test does not count Payment parents or verify a common parent. Separately, executed EV-B6 EXACT_LINKAGE (CI run 39983585312; docs/OBS-01-PERF-RESULTS.md:140/:145/:151; invariant definition tests/performance/support/invariants.ts:83–87) verifies one new Payment and exactly linked Reservation/PaymentItem/mapping per selected child, with a common Payment parent. Measured scope: synthetic successful-call and same-submission race fixtures, n=2/4/8 × NEW/EXISTING, within the dedicated loopback PostgreSQL 16.15 harness; not arbitrary live rows. | PASS — EXECUTED | P0 |
| C03 | Six 6B same-submission race cells: n=2/4/8 × NEW/EXISTING. EV-B6 records WINNER success, LOSER ApplicationNotPendingError, PAIR single-commit invariants; 5 warmups and 30 measured pairs per cell. Pair evidence is shared, not 18 independent races or per-call pair query counts. | PASS — EXECUTED | P0 |
| C04 | Confirm vs sibling return (:162), competing last-seat case (:149), deposit vs rejection (workflow-races :103), reject/cancel same child (:111), stale return observations (:117) execute in EV-INT. No general proof of every possible interleaving is claimed. | PASS — EXECUTED | P0 |
| C05 | Earlier Child/Reservation/consent rollback and later second-mapping failure rollback: full named cases confirmation-atomicity.test.ts:108 and :114; EV-INT. Workflow deposit/resolution/return late-write failure cases at workflow-races.test.ts:130 also restore before-state. | PASS — EXECUTED | P0 |
| C06 | Deposit same-key replay and changed-payload rejection under contention: “serializes two admins' different partial deposits and a same-key replay without duplicate money” (:91) and “rejects changed payload under a contended key; recovery is read-only” (:97), workflow-races, EV-INT. | PASS — EXECUTED | P0 |
| C07 | Return replay precedes stale-observation rejection; changed payload is refused: admin-actions.test.ts:632, “recognizes a matching return replay before stale-observation checks, but rejects changed payload”, EV-UNIT; real DB stale simultaneous returns and exact replay workflow-races.test.ts:117, EV-INT. | PASS — EXECUTED | P0 |
| C08 | Lost confirmation response recovers by authoritative read, without replay: integrated-ux-confirmation.spec.ts:47, EV-UX Confirmation 7/7. Ledger lost-response and failed-read recovery cases at integrated-ux-ledger.spec.ts:91/:108 pass in Ledger 8/8. Confirmation's duplicate rejection differs from replaying a keyed success receipt. | PASS — EXECUTED | P1 |
| C09 | Direct guards exist: submission lock finance.ts:124/:244; sorted application locks :249; sorted class locks :267; Child share locks :275; new identity advisory locks :307; post-lock status check :259 and conditional transition :367; unique mappings/items schema.prisma:703/:704/:822. This row confirms those declarations only. | PASS — STATIC | P0 |
| C10 | Different PaymentItems of one Payment have no common lock around Refund aggregate → Payment.status update. lib/payments/core.ts:114 locks only pi; :152 aggregates; :159 writes a derived parent status. Concrete synchronization gap; possible stale status under the interleaving detailed below has not been executed. | 개선 필요 — STATIC gap; runtime impact INFERENCE | P0; AP-6C-REFUND |
| C11 | Durable recovery after browser/process loss of the in-memory attempt identity is not demonstrated by the cited recovery executions. Missing: an approved targeted scenario covering reload/tab closure during an unsettled write and operator recovery from server records. No claim of duplicate spend; no automatic retry is authorized. | BLOCKED — NOT EXECUTED | P1; AP-6C-RECOVERY |

**INFERENCE — lock/transaction reasoning:** deposit, close, confirmation and actual-return paths serialize on the Submission; return then locks ReturnObligation. Legacy confirmation locks Application → Class → Child. Purge follows Submission → Application → Child with post-lock re-read (retention.ts:237/:309/:327/:334), and the executed purge/confirmation race is A11. The ordinary reservation helper locks Class, rejects cancelled/completed classes and inactive/purged children, and requires explicit bound overbooking confirmation (server/reservations/create.ts:39, :44, :53, :73). A hard blanket “never over 8” would misstate the existing ADMIN overbooking policy: the server requires the explicit binding; a bare flag is not authorization (finance.ts:74 and actions.ts:330). No new capacity/teacher policy was audited or invented.

**INFERENCE — operation-specific retry boundary:**

| Operation | Inspected behavior, distinct from execution claims above |
| --- | --- |
| Deposit/return | actions.ts:225/:248 requires ADMIN, key and Zod payload, compares immutable bank fields under the same submission lock, then joins core into the outer transaction. Core replay alone checks target/key, not all payload fields; no other product caller bypassing these adapters was found. Explicit unchanged-key replay follows read-only lookup actions.ts:201; changed fields are rejected. |
| Confirmation | Has no keyed success-receipt replay. A later request sees non-SUBMITTED and fails; actual mapped Reservation/Payment is recovered through detail reads. Item uniqueness is a backstop, not the recovery protocol. |
| Client timeout | workflow-controller.tsx:19–31 uses a deadline that does not cancel the underlying request. :72–108 reads/reconciles and blocks unresolved follow-up; deposit-form.tsx:74/:89/:90 separates lookup from explicit same-key replay. No automatic financial write-retry loop was found in these controllers. |
| Public submission | Signed review operation and group serialization preserve one durable parent; price-recheck.test.ts:162/:173/:210 execute concurrent/lost-response cases in EV-INT. This is separate from administrator confirmation and bank-event keys. |

For C10, a concrete source-supported schedule is: one batch Payment has two paid items, 40000 and 60000; T1 fully refunds the first item and T2 fully refunds the second. Both lock different items, write their own Refund/counter, and run :152 before either commits. Each aggregate can see only its own new refund, derive PARTIAL_REFUNDED at :158, then serialize only the already-computed parent updates at :159. The final Payment can remain PARTIAL_REFUNDED while committed item refunds total 100000. **That outcome is INFERENCE, not a reproduced incident.** The item bounds, Refund/counter transaction and pre-confirmation ledger protections remain separate. Existing payments/core.test.ts:90/:128/:138 mock one-item aggregates; confirmation-atomicity.test.ts:170 is sequential, so neither establishes cross-item parent-status safety.

## 4. Access, privacy, consent and retention — A1–A4

“Every admin surface” below means the reservation-application surface in the approved PLAN, plus the Payment/Refund writers it reaches. This is not an application-wide audit of unrelated AI, accounts or other domains.

| ID | Finding / evidence and scope | Classification / kind | Priority |
| --- | --- | --- | --- |
| A01 | All eight reservation-application page entry points below directly call requireAdminPrincipal before protected queries/rendering. | PASS — STATIC | P0 |
| A02 | All 24 exported reservation-application server actions below directly check ADMIN or immediately delegate to the private closeApplication helper that checks it before DB/core calls. | PASS — STATIC | P0 |
| A03 | Protected query entry points check ADMIN; count wrapper delegates to guarded family count. Two internal detail helpers rely on their guarded page caller, enumerated below; no current public caller found. | PASS — STATIC | P0 |
| A04 | Named role denials executed: admin-actions.test.ts:143 blocks the 23 listed action invocations before core calls (mocked denial); EV-UX family-list :158, family-detail :96, ledger :199 execute real MANAGER/TEACHER denied HTML/RSC and missing private markers. This is not an exhaustive unauthenticated HTTP action matrix. | PASS — EXECUTED | P0 |
| A05 | ADR-063 scoped applicationPrice projection, no invalid/stopped/revoked capability prices: public-queries.test.ts:202/:214/:220, EV-UNIT 18/18. Source projection at public-queries.ts:97 and pages listed below; legacy remains price-free. | PASS — EXECUTED | P0 |
| A06 | Signed-price review, revoked links/invites, foreign device/phone matching, child state and immutable quotes: named price-recheck.test.ts:185/:219/:227/:246/:253/:272/:281/:290/:299 cases, EV-INT 26/26. | PASS — EXECUTED | P0 |
| A07 | Completion is own quoted snapshots/capability, generic output for invalid/expired/legacy: phase20-completion.test.ts:11/:54 and phase20-completion-page.test.ts, EV-UNIT; integrated-ux-completion.spec.ts:92/:205/:261, EV-UX 12 passes. The successful-submit cookie navigation case is W07, not part of this PASS. | PASS — EXECUTED | P0 |
| A08 | Repeat-device projection is own active/unpurged children and fails when guardian changes: phase20-devices.test.ts:6/:16/:25, EV-UNIT 3/3; foreign-device denial price-recheck.test.ts:253, EV-INT. | PASS — EXECUTED | P0 |
| A09 | Current version/required acknowledgements and optional consent records: price-recheck.test.ts:260, EV-INT; confirm.test.ts:190/:204, EV-UNIT; EV-B6 CONSENT_APPEND checks stored version/time/actor and prior history. Program/legal/refund acknowledgements remain Application fields, not invented ChildConsent types. | PASS — EXECUTED | P0 |
| A10 | KST one-year/unconfirmed and scoped five-year/confirmed eligibility, last-day/leap-day behavior: retention.test.ts:28/:35/:97/:103, EV-UNIT. ADR-057/058 scope is preserved; not applied automatically to unscoped legacy customers. | PASS — EXECUTED | P1 |
| A11 | Purge locks/rechecks, skips future-reservation re-read, scrubs child data and only eligible history: retention.test.ts:391/:411/:440, EV-UNIT; “scoped purge and confirmation serialize against requested Child without resurrecting purged data”, confirmation-atomicity.test.ts:182, EV-INT. Wider historical phase18-retention-concurrency E2E is not claimed executed here. | PASS — EXECUTED | P0 |
| A12 | Explicit dynamic/no-store declarations, cookie flags, fixed error mapping and sanitizer exist at the listed source locations. No local/session-storage persistence calls were found in the inspected apply/controller subtree. This is a bounded source fact, not a production cache/log audit. | PASS — STATIC | P1 |
| A13 | Complete unauthenticated/MANAGER/TEACHER runtime denial across all eight pages and 24 actions is not established by the selected executions. Missing: named denial execution for remaining entry points, especially unauthenticated direct calls. Static checks are present; no reachable unauthenticated/under-authorized path was found in this inspected surface. | BLOCKED — NOT VERIFIED exhaustively | P1; AP-6C-AUTH |
| A14 | Actual Production HTML/RSC/error/log/CDN/browser-cache exposure is not observable here. Missing: authorized deployed-origin inspection and operational log/cache configuration evidence, using synthetic markers. Source projections and selected CI cases cannot attest the deployed environment. | BLOCKED — NOT VERIFIED | P1; privacy/operations |
| A15 | Manual purge cadence, accumulated expiry backlog, operator execution, backups/replicas and end-to-end deletion effectiveness are unverified. Missing: owner/runbook and authorized operational/backup evidence; no reservation auto-purge scheduler exists by current policy. | BLOCKED — NOT VERIFIED | P1; AP-6C-RET-OPS |
| A16 | Transaction-record PII retention duration/end-of-life cleanup remains explicitly undecided. REQUIREMENTS.md:2381; retention.ts:272 preserves financial rows; ADR-057 at DECISIONS.md:512–514 retains Payment.payerName/memo and Refund.reasonDetail. | 개선 필요 — STATIC documented policy gap | P1; AP-6C-RET |
| A17 | Retention policy for customers without a CONFIRMED reservation application is explicitly undecided: REQUIREMENTS.md:2380; retention.ts:168–169 excludes that population; DECISIONS.md:521/:528 records the scope. This is not an unauthorized extension of the five-year policy. | 개선 필요 — STATIC documented policy gap | P1; AP-6C-LEGACY-RET |

### Administrator entry-point matrix

Each page below has its own ADMIN check; the common layout's login gate alone is not relied upon. requireAdminPrincipal at lib/auth/authorization.ts:85 calls requireCurrentPrincipal, redirects missing sessions via :51, applies forced-password handling at :43, and denies non-ADMIN roles with notFound at :87. principal.ts:89 onward resolves current DB role/account/authVersion rather than trusting a JWT role; principal unit tests (EV-UNIT) remain mocked principal evidence, not the missing full HTTP matrix.

| Page under app/(admin)/reservation-applications/ | ADMIN-check location |
| --- | --- |
| page.tsx | :10 |
| submissions/[id]/page.tsx | :8 |
| [id]/page.tsx | :51 |
| groups/page.tsx | :11 |
| groups/[id]/page.tsx | :20 |
| returns/page.tsx | :7 |
| settings/page.tsx | :10 |
| retention/page.tsx | :99 |

All action locations below are in app/(admin)/reservation-applications/actions.ts. Retired compatibility actions still authorize before returning their “reload” result.

| Exported action | Entry / ADMIN-check location |
| --- | --- |
| markGroupManualTestSession | :63 / :64; Preview-only at :65 |
| createApplicationGroup | :84 / :85 |
| issueApplicationGroupLink | :90 / :91 |
| updateApplicationGroup | :97 / :98 |
| stopApplicationGroup | :116 / :117 |
| saveReservationApplicationSettings | :122 / :123 |
| importLegacyReservationApplicationSettings | :139 / :140 |
| refreshApplicationWorkflow | :185 / :186 |
| refreshApplicationReturn | :190 / :191 |
| refreshApplicationReturns | :195 / :196 |
| lookupWorkflowReceipt | :201 / :202 |
| recordApplicationDeposit | :225 / :226 |
| recordApplicationReturn | :248 / :249 |
| resolveApplicationWorkflow | :276 / :277 |
| confirmApplicationSubmission | :305 / :306 |
| issueApplicationLink | :370 / :371 |
| stopApplicationLink | :383 / :384 |
| upgradeLegacyApplicationLink | :398 / :399 |
| confirmApplicationDeposit | :413 / :414 |
| confirmReservationApplication | :467 / :472 |
| rejectReservationApplication | :568 → private closeApplication :541 |
| cancelReservationApplication | :577 → private closeApplication :541 |
| purgeExpiredPersonalData | :598 / :599 |
| issueClassApplicationLink | :615 / :616 |

Direct queries: family-queries.ts countPendingApplicationFamilies :52/:53, findPossibleDuplicateApplicationIds :59/:60, listApplicationFamilies :113/:114; detail-queries.ts getApplicationWorkflowDetail :40/:41; return-queries.ts listApplicationReturns :30/:31 and getApplicationReturn :34/:35; link-queries.ts getClassApplicationLinks :44/:45 and getLinkCompositionOptions :105/:106; queries.ts listReservationApplications :74/:81 and getReservationApplicationDetail :160/:161. countPendingReservationApplications :108 delegates to the authorized family counter. Compatibility getApplicationLinkForClass is an export alias of the guarded link query at queries.ts:228.

queries.ts:175 listChildCandidatesForApplication and :203 getApplicationRetention have no internal principal check; their sole product caller is the ADMIN-guarded [id]/page.tsx:51, followed by calls at :65/:68. They are internal functions without a server-action/route export. This is caller-dependent authorization, not a demonstrated reachable bypass. Retention scans/settings/finance cores are similarly server-internal dependencies of guarded entries. Payment actions separately require ADMIN as listed in the ledger writer matrix.

### Guardian exposure matrix against ADR-063

The policy at docs/DECISIONS.md:596–608 permits valid-link in-scope applicationPrice, own-child estimates and submitted quotedAmount. Catalog/default/cross-group prices, seats/availability, other families' PII and internal ledgers remain prohibited. Selecting a field for internal admission is distinguished from returning it.

| Surface | Allowed response / capability and source inspection | Evidence boundary |
| --- | --- | --- |
| Legacy /apply/[token] | public-queries.ts:25/:31 uses two-stage admission and display-only selects; [token]/page.tsx:41 passes applicationPrice:null. Closed links return a generic notice before display query. | STATIC projection; EV-UNIT public-queries cases; modern conversion is separate. |
| Modern class/group page | public-queries.ts:97 selects own-scope id/time/location/applicationPrice and Program descriptive fields only; :109 validates active hashed link/group; group/[token]/page.tsx:36–39 passes only reduced class cards after settings/consent admission. | A05; no Program.defaultPrice/capacity/reservation count/catalog fallback in this DTO. |
| Companion page | public-queries.ts:111 requires nonrevoked, unexpired invitation and active group; companion/[token]/page.tsx:16/:36 uses dynamic reduced class cards. groups.ts:174 treats invite as group scope only, not child/guardian ownership. | A05/A06; no issuer/companion-family PII or financial DTO returned. |
| Price-review and submit action responses | group/[token]/actions.ts:63/:81 validates Zod, readiness and scope; groups.ts:158/:193/:204 locks/revalidates link/group/classes; signed reviewed prices/operation, fixed errors, no raw request echo; current quote :329. | A06; changed price requires explicit reconfirmation, not silent save. |
| Completion HTML/RSC/client props | completion.ts:17–30 requires unexpired hashed completion cookie and unpurged parent, returns only own SUBMITTED quoted snapshots; complete/page.tsx:28 calls noStore and :68 passes bank guidance/own items. Invalid/expired/legacy output is generic. | A07 and W07 exclusion. Notification :61 only timestamps; companion issue/revoke requires issuer completion capability at completion-actions.ts:19/:38/:50. |
| Repeat children API | GET route.ts:9, force-dynamic :6 and private,no-store :14; devices.ts:35/:47/:62 validates opaque unexpired nonrevoked device, unpurged latest submission, active children and same guardian. Client fetch at application-wizard.tsx:63 uses no-store. | A08. Own guardian profile and authorized children only; phone matching alone cannot grant ownership. |
| Errors/logs | Public group actions return fixed messages at :70/:114–118; legacy action logs describeErrorForLog only at [token]/actions.ts:145. errors.ts:37–41 logs class/code, never raw Prisma message/request body. | A12 source fact. No blanket attestation of hosted/platform access logs, referrers or production observability. |
| Cache/browser storage | Public pages force-dynamic; group/companion revalidate=0. Completion uses noStore; repeat API private,no-store. Completion/device cookies at group actions.ts:120–121 are HttpOnly, Secure, SameSite=Lax, capability paths/TTLs; wizard/controller drafts and receipts inspected in component memory with no localStorage/sessionStorage calls. | A12 source fact; A14 deployed/browser behavior remains unverified. Raw capabilities can appear in the intended link/cookie surfaces; they are not recorded in this report. |

ChildSafetyInfo is absent from these public select/response projections. Photo consent history is stored as below; the audit did not execute a separate media-publication flow or inspect all external photo usage.

### Consent storage and deletion/retention field map

groups.ts:240 parses the schema and :241 checks the current wording version; :338–345 stores required program/privacy/legal/refund acknowledgements, optional photo booleans, consentVersion and submittedAt per child Application. Guardian details live on the Submission. Confirmation actions.ts:322–324 rechecks required fields under lock; finance.ts:375–376 appends ChildConsent with application-submission time, administrator actor, application ID and wording version. Legacy confirm.ts:116–131 follows the same consent planner.

consent-plan.ts:12 maps optional agreement to AGREED (the stored equivalent of “GRANTED”), unchecked previous AGREED to REVOKED, and otherwise DECLINED. Privacy is AGREED; program/legal/refund acknowledgements are Application records, not extra consent types. Current history uses recordedAt descending, id descending (lib/children/consent/queries.ts:16–32); ordinary append-only behavior preserves earlier records. Expired-retention purge is the accepted deletion exception.

| Population/fields | Implemented action / retained structure | Policy or evidence limit |
| --- | --- | --- |
| Unconfirmed Application | One year from class date in KST, retained through expiry day. Pending entries must be rejected/cancelled first; only terminal entries purged. retention.ts:138/:145 and :210/:311 scrub child/guardian details, requestNote and resolutionNote; mark actor/time. | Application row/status/consent/version/processing history retained; no invented automatic cancellation. A10/A11. |
| Scoped confirmed Child | Five years from last valid reserved class date, fallback latest confirmed application class; future reservations block purge. retention.ts:154/:168 and :327–340 lock/re-read. | Excludes customers lacking a CONFIRMED Application; A17 is the explicit policy gap. Last-reserved-class rules include established NO_SHOW/cancellation distinctions. |
| Eligible Child fields/dependencies | retention.ts:345–378 deletes ChildConsent, ChildSafetyInfo, Relationship; scrubs Reservation memo/cancelDetail; scrubs confirmed Application copy; anonymizes Child name, nulls birth/guardian/memo, resets gender, deactivates and marks purge. | Child/Reservation/attendance/Payment/PaymentItem/Refund and financial amounts/status/time/linkage remain. No cascade financial deletion. |
| Parent and application-ledger PII | Only when every sibling is purged: retention.ts:223–234 clears parent guardian/declared payer, deposit payerName and return reason. Unpurged siblings retain needed parent data. | Source and mocked purge tests; no current live expiry/backlog inspection. |
| Repeat-child grants and tombstones | retention.ts:362 deletes DeviceChild; :365 clears requestedChildId and writes non-PII requestedChildPurgedAt so NEW cannot resurrect a purged identity. | A11 actual DB race; device capabilities/structural links are not mistaken for a full backup-deletion policy. |
| Transaction-record free text | Payment.payerName/memo and Refund.reasonDetail remain by ADR-057; retention.ts:272–274 preserves financial history. | Duration/end-of-life disposal explicitly undecided, A16. No five-year rule silently applied to these fields. |
| Operations/backups | Manual ADMIN purge core retention.ts:391–399; batch limits :22–23; UI/action report hasMore. No reservation auto-batch introduced. | A15: manual cadence, legal/backup lifecycle and actual operational compliance not verified. |

## 5. 360px WebKit and real iPhone Safari/VoiceOver — W1–W3

docs/E2E_CI_ITERATION_5_REPORT.md:183 and :226 records historical local unit verification; :196 onward describes install-failure diagnosis and its workflow-only repair. Its preparation-era “browser/remote CI still needed” wording is not the latest execution result. The independently retrieved EV-I5, EV-INSTALL and EV-UX logs provide the actual timeline.

| ID | Finding / missing verification | Classification / kind | Priority |
| --- | --- | --- | --- |
| W01 | Iteration 5 completed 360px checkpoint EV-I5: 63 PASS / 0 FAIL / 5 BLOCKED skips, full eight-spec selection. | PASS — EXECUTED | P2 |
| W02 | Latest completed retrieved 360px execution EV-UX: 63/0/5, full selection; Ledger 8/8, Confirmation 7/7. The later completion is preserved separately from EV-I5. | PASS — EXECUTED | P1 |
| W03 | EV-INSTALL failed system-dependency installation and skipped UX execution: zero tests executed, an environment attempt with no new UX verdict. PASS here means the historical attempt is correctly evidenced, not that its UX tests passed. | PASS — EXECUTED metadata/log fact | P2 |
| W04 | “first-ever zero has a different message”, integrated-ux-family-list.spec.ts:188. Missing separately provisioned empty authenticated server; shared fixture DB is populated. | BLOCKED — skipped in EV-UX | P1; AP-6C-UX |
| W05 | “failed read displays retry rather than zero or success”, same file :192. Missing controlled authenticated list read failure. | BLOCKED — skipped in EV-UX | P1; AP-6C-UX |
| W06 | “shows retry without a success/zero-balance fallback”, integrated-ux-family-detail.spec.ts:112. Missing controlled authenticated detail read failure. | BLOCKED — skipped in EV-UX | P1; AP-6C-UX |
| W07 | “successful submission replaces the document; reload and back do not restore inputs or resubmit”, integrated-ux-completion.spec.ts:229. Measured WebKit policy rejects the existing Secure completion cookie on mandatory HTTP loopback; missing approved origin/environment supporting unchanged cookie attributes. | BLOCKED — skipped in EV-UX | P1; AP-6C-UX |
| W08 | ADMIN → link → two children → deposit → selected confirmation journey, integrated-ux-full-journey.spec.ts:12. Same Secure-cookie/HTTP-loopback blocker; no completed WebKit full-journey money-flow execution. | BLOCKED — skipped in EV-UX | P1; AP-6C-UX |
| W09 | Physical iPhone narrow layout, zoom and Dynamic Type. Missing recorded device/iOS/Safari version, approved origin, operator session and actual clipping/reflow/target observations. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W10 | Physical keyboard/scroll behavior, date and phone entry, keyboard dismissal and visible focused fields. Missing real iPhone interaction record. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W11 | Physical multi-child selection, own prices/total, price change review and explicit reconfirmation. Missing real Safari session evidence. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W12 | Physical validation/error focus and complete consent reading/order/acknowledgement. Missing real focus/viewport and interaction observations. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W13 | Physical submit, Secure-cookie completion, refresh/back and duplicate-family prevention. Missing approved-origin Safari session and authoritative synthetic result observation. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W14 | Physical copy/share success, permission denial/unsupported behavior and manual selection fallback. Missing device permissions/share-sheet/manual-fallback evidence. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W15 | Physical ADMIN deposit/return/confirmation touch flow and explicit lost-response/read recovery. Missing approved synthetic iPhone/operator network-interruption session. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |
| W16 | VoiceOver labels, swipe/rotor order, focus movement, validation errors, live-region announcements, consent navigation and recovery. Missing physical iPhone with VoiceOver enabled plus operator/version/origin and observed announcements. | BLOCKED — NOT EXECUTED | P1; AP-6C-DEVICE |

The eight-spec EV-UX accounting is:

| Spec | PASS | FAIL | BLOCKED skip |
| --- | ---: | ---: | ---: |
| family-list | 8 | 0 | 2 |
| class-links | 5 | 0 | 0 |
| family-detail | 10 | 0 | 1 |
| ledger | 8 | 0 | 0 |
| confirmation | 7 | 0 | 0 |
| completion | 12 | 0 | 1 |
| guardian | 13 | 0 | 0 |
| full-journey | 0 | 0 | 1 |
| **360px WebKit total** | **63** | **0** | **5** |

No skip became a PASS, no cookie attributes were weakened, and Chromium's completed full journey does not close W08. These results test Playwright WebKit on Linux with configured viewports; they do not establish physical Safari or VoiceOver behavior. Instagram/Kakao in-app browsers are also NOT VERIFIED; they require a distinct session if anyone later claims support evidence.

## 6. Pre-production approvals — P1/P2

| ID | Finding / missing evidence | Classification / kind | Priority |
| --- | --- | --- | --- |
| P01 | The pre-existing deployable migration delta versus PR base 1171517 is prisma/migrations/20261015090000_ai_service_followup/migration.sql:1. It is unrelated to the reservation audit. No 6C schema delta exists. Separate prisma/manual-test files are not the main prisma/migrations deploy payload. | PASS — STATIC | P0 |
| P02 | Production workflow declares trusted base tooling, exact head payload, environment production, noncancelling serialized migration, repeated head checks, preflight/deploy/verify and fail-closed final result. Locations below. Declarations alone do not prove reviewer protection or secrets are configured. | PASS — STATIC | P0 |
| P03 | EV-GATE's actual historical state is detect success / migrate cancelled with no steps / final gate failure. Earlier “WAITING” context is stale. | PASS — EXECUTED metadata | P0 |
| P04 | Latest branch/PR current-head Production Schema Gate state is unavailable. Both gh listings were network-denied; connector's commit-associated PR runs do not establish pull_request_target state. Missing authorized read-only current gate/run/approval metadata for exact release candidate. Do not call it PASS, absent, or presently waiting. | BLOCKED — NOT VERIFIED | P0; AP-6C-RELEASE |
| P05 | Production applied migrations, expected pending delta, identity and drift are unknown. Missing separately authorized Production preflight/status evidence; no DB probe is allowed in 6C. | BLOCKED — NOT VERIFIED | P0; AP-6C-RELEASE |
| P06 | Environment/reviewer protections, secret presence/validity, application runtime/bank/channel settings and backup availability cannot be verified from source declarations. Missing authorized settings/owner attestations without exposing values. | BLOCKED — NOT VERIFIED | P0; AP-6C-RELEASE |
| P07 | Human migration/deployment approval, exact candidate review, restore/failure ownership and rollback readiness are not established. PR remains Draft/unmerged; its existing body explicitly keeps Production Schema Gate unapproved. Missing separate recorded approvals and recovery plan. | BLOCKED — NOT VERIFIED | P0; AP-6C-RELEASE |

Workflow facts: .github/workflows/production-schema-gate.yml:4 uses pull_request_target; :33–39 checks out trusted base tooling; :93–100 checks out only approved head schema/migrations; :82–85 declares production environment and cancel-in-progress:false; :117, :140 and :174 recheck exact PR head; :128/:150/:162 run preflight/deploy/verify; :184–204 require successful migration when schema changes. scripts/release/production-migration.ts:353 reads the required identity/connection settings, which are names only in this audit. The AI migration begins an explicit transaction with local timeouts (:1–3), adds AI-service tables and enables RLS (:309 onward), ends COMMIT at :380. This is payload identification, not a completed migration/security review.

### Required approval/evidence checklist — LIST ONLY

Every item is required/unverified for its respective future action; nothing below was approved or executed.

| Checklist | Owner / evidence needed before action |
| --- | --- |
| Audit disposition | Product/operator accepts this report and separately resolves or explicitly dispositions required gaps/blockers. Financial CI is not production authorization. |
| Retention/privacy policy | Authorized policy/privacy owner decides transaction-record and unscoped-customer retention, disposal, backup handling and operational responsibility; no period chosen in 6C. |
| Device and skipped-flow disposition | Product/QA owner approves synthetic physical-device session and minimal missing environments or records an explicit release disposition for W04–W16. |
| Stacked PR/source review | Maintainer reviews Mock PR #53/base dependency, future transplant/squash strategy and exact candidate SHA. PR #54's historical AI body/test SHA is not current reservation-audit execution evidence. Both Draft states are preserved. |
| Migration review | DB/release owner reviews exact AI-service migration checksum/delta, intended schema/RLS/permissions, compatibility and transaction/timeout/failure behavior; confirms no unintended migration payload. |
| Gate and human approval | Authorized Production Environment reviewer inspects current exact-head run, required reviewer/protection settings and serialized execution; separate human approval is required. No approve/cancel/rerun/bypass in 6C. |
| Production access and preflight | Separate authorization for DB identity, applied/pending set, drift and connectivity checks. Expected migration set and intended runtime/direct roles must be established before execution. |
| Secret/config readiness | Operations attests presence and correct environment binding of PRODUCTION_DIRECT_URL, PRODUCTION_DB_IDENTITY_SHA256, PRODUCTION_DB_RUNTIME_IDENTITY_SHA256. Release verification also declares VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, PRODUCTION_BASE_URL at production-release-verify.yml:75–101. Runtime auth/application settings and bank/channel values require owner readiness; no values retrieved. |
| Backup and rollback/failure plan | Named owner confirms a usable backup/PITR/restore procedure, recovery window and compatibility of application rollback with the additive schema. Review what happens on failed/partially applied migration and safe forward recovery. No automatic down migration, destructive rollback or current restore readiness is assumed. |
| Migration execution and verification | Separate execution approval; approved preflight, deploy, post-verify and final schema gate success on exact candidate. Cancelled/unknown jobs are insufficient. |
| Merge approval | Explicit human merge approval after required review and CI/schema gates. No merge on failed CI, direct main push or Draft conversion here. |
| Deployment and release checks | Separate deployment approval for exact source/environment; reviewed Vercel target/config and approved post-release migration status/smoke evidence. production-release-verify.yml:43–101 declares those checks; 6C did not run them. |
| AI live activation, only if later requested | Legal/privacy/international-transfer/provider/Kakao/OpenAI/cron approvals remain separate. Reservation-audit acceptance or AI schema approval does not authorize live AI/customer processing. |

## Improvement issues and separate approval proposals

| Approval ID / finding | Severity / reproduction or inspection method | Expected / actual / impact | Required separate approval |
| --- | --- | --- | --- |
| AP-6C-REFUND / C10 | **MAJOR**, P0 financial-status review. Inspect lib/payments/core.ts:114/:152/:159; proposed reproduction is concurrent full refunds of different items in one batch Payment, with both aggregates completing before either transaction commits. NOT EXECUTED. | Expected: committed Payment.status reflects all committed item refunds. Actual source locks each item only and computes the shared parent status before serializing its update. The concrete missing synchronization can leave a stale partial status under the explained schedule (INFERENCE); no observed over-refund or altered D/A/P/R/T is asserted. | Approve a narrowly scoped BUILD investigation/fix plan for common-Payment refund serialization or equivalent consistency control, and one targeted real-PostgreSQL interleaving case. No policy changes, broad suite expansion or fix in 6C. |
| AP-6C-RET / A16 | **MAJOR**, P1 policy completeness. Inspect REQUIREMENTS.md:2381, DECISIONS.md:512–514 and retention.ts:272. | Expected for complete lifecycle readiness: approved transaction-PII retention/disposal and accountable operation. Actual: ordinary customer purge intentionally preserves Payment payer/free text and Refund detail, while duration/end-of-life cleanup is unresolved. Impact: no auditable disposal boundary for retained transaction PII. This does not assert violation of an already-approved period or make a legal judgment. | Policy/privacy/finance owner approves scope, lawful basis/duration, exceptions, deletion/anonymization and backup handling; then separate SPEC/PLAN/BUILD approval if code is required. |
| AP-6C-LEGACY-RET / A17 | **MAJOR**, P1 policy completeness. Inspect REQUIREMENTS.md:2380, DECISIONS.md:521/:528 and retention.ts:168–169. | Expected: an approved lifecycle for all collected customer populations. Actual: customers without a CONFIRMED Application remain outside the approved five-year purge. Impact: unresolved retention/disposal for this existing population; current scoped behavior correctly avoids inventing consent/policy. | Owner approves population-specific policy and communication/consent implications before any implementation. Do not extend the current five-year rule automatically. |

Other separate verification approvals, not product-defect findings:

| Approval ID | Missing scope / owner |
| --- | --- |
| AP-6C-RELEASE | P04–P07: release/DB/environment owners provide current exact-head gate, settings, review, backup and separate operational approvals. P0 release prerequisite. |
| AP-6C-DEVICE | W09–W16: QA/product approves real iPhone/iOS/Safari/VoiceOver, origin and synthetic operator session; retain versioned observations. |
| AP-6C-UX | W04–W08: owner reviews smallest missing empty/failure/cookie-origin verification individually. If a new test/environment is necessary, approve its exact scope first. No harness redesign or cookie relaxation. |
| AP-6C-AUTH | A13: targeted execution for remaining role/unauthenticated entries, reusing current tests first; authorize only the missing denial checks if release needs an exhaustive runtime matrix. |
| AP-6C-RECOVERY | C11: narrowly scoped reload/closed-tab/unsettled-write operator recovery verification. No persistence design or automatic retry change implied. |
| AP-6C-RET-OPS | A15: operations/privacy owner provides manual cadence, backlog, backup/replica handling and authorized evidence of effective purge. Automatic scheduling remains a separate policy decision. |

## Recommended priority and risk assessment

1. **Financial integrity (C10 P0; L08/C11 P1):** review the shared-Payment refund synchronization gap C10 before production disposition; obtain external-bank reconciliation evidence L08 and durable interrupted-client recovery evidence C11. L08/C11 are missing verification, not asserted production incidents.
2. **P1 privacy lifecycle and access:** resolve A16/A17 policy gaps and A15 operational/backup evidence; complete outstanding full-surface role execution A13 and deployed exposure verification A14; do not infer disposal completeness from row anonymization alone.
3. **P1 physical/mobile readiness:** complete or explicitly disposition W04–W16, preserving the five WebKit skips and real-device/VoiceOver gaps separately.
4. **P0 release prerequisites — separate and mandatory:** obtain current gate/identity/config/backup evidence and separate human approvals (P04–P07). Keep the pre-existing AI-service migration distinct from reservation verification.
5. **P2 evidence usability:** retain accessible complete artifacts for E06 if later needed; preserve all successful and failed attempt identities. No 6B reopening, optimization or perf rerun is recommended.

Likelihood is not measurable from this audit. The PLAN's qualitative triage is preserved as investigation order, not a measured defect probability: evidence 2×2=4; ledger 2×3=6; concurrency 2×3=6; access/privacy 2×3=6; mobile 3×2=6; production approvals 3×3=9. Runtime likelihood for finance/privacy/production remains unknown. Concrete residuals are the synchronization/policy gaps above, synthetic-vs-live limitations, missing physical-device evidence and missing production approvals. None is erased by aggregate CI success.

## Explicit NOT EXECUTED / NOT VERIFIED

- No local unit/integration/E2E rerun, lint, typecheck or build. EV-INT/EV-UNIT/EV-UX are existing CI executions, with merge identities disclosed.
- No perf harness, calibration, self-check or benchmark execution; no new measurements or reconstructed 18-row detail. 6B stays CLOSED.
- No database connection or query of any kind against local, Preview or Production; no bank reconciliation, live balance/drift check, migration status/generation/application or cleanup/purge.
- No physical iPhone Safari, VoiceOver, iOS keyboard/share sheet or Instagram/Kakao in-app-browser execution. W09–W16 are entirely NOT EXECUTED.
- Five admitted WebKit skips W04–W08 remain BLOCKED. The install-failure attempt executed zero UX tests; its environment failure is not a failed UX suite.
- No runtime reproduction of C10's different-item Refund race, no exhaustive interleaving proof, and no durable tab/process-loss recovery test for C11.
- No exhaustive unauthenticated/role request matrix for every page/action, no live CDN/RSC/log/browser-cache audit, no external media/photo-use audit.
- No operational retention backlog/cadence, backup/replica deletion or restore verification; no resolution of transaction-record/unscoped-customer policy questions.
- No current-head Production gate determination via gh, Production Environment settings/secret validation, live applied-schema attestation or human release approval.
- No workflow trigger/rerun/cancel/approval, DB operation, PR mutation, merge, deployment, staging, commit, push or external messaging.

## Completion report

### Changed

Created docs/ITERATION-6C-REPORT.md only. Completed all six audit areas with **39 PASS / 23 BLOCKED / 3 개선 필요**, 65 counted findings. Existing SPEC/PLAN remain uncommitted and unchanged; baseline HEAD/branch retained.

### Tests

No tests run in this session. Reused and independently retrieved EV-INT 87/87 and EV-UNIT 2557/2557, EV-UX 360px 63 PASS / 0 FAIL / 5 BLOCKED skips, plus preserved 6B COMPLETE evidence. Findings map named tests and source to their actual executed scope.

### Lint

No lint rerun for this Markdown-only deliverable. Historical matching-source CI lint success is EV-UNIT. Report whitespace, finding counts, source citations and working-tree scope checked at completion.

### Build

No build/server/browser started. Historical matching-source CI build success is EV-UNIT; no local .next interaction.

### Risks

Three MAJOR improvement items: shared-Payment Refund status synchronization, transaction-PII retention policy, unscoped-customer retention policy. Runtime manifestation of the first is inferred, not reproduced. The 23 blockers and production approvals remain open; no production-readiness verdict.

### Next

Review and separately disposition the approval register in priority order. Any code/test/environment/policy/release work requires its own approved scope and applicable BUILD/review workflow. No fix or operational action is authorized by this report.
