# Requirement

Iteration 6C — Reservation application pre-production safety and completeness audit (흥영).

Baseline: `29ca8829b312ad89365b7b99c86e06b3333db355`, branch `feature/phase21-ai-service`, [PR #54](https://github.com/gulatnaru/yaho-management/pull/54) OPEN / Draft / unmerged. Prepared 2026-10-24. This is an audit specification, not a production-readiness verdict.

The current request authorizes writing this SPEC and then its PLAN without an intermediate approval round. Only `docs/ITERATION-6C-SPEC.md` and `docs/ITERATION-6C-PLAN.md` may change in this task. No commits. The report described below is a future deliverable; this task does not create it. The explicit document-writing request overrides the PLAN skill's general no-file-edit instruction only for these two outputs; no implementation is authorized.

## Problem

Operators need to distinguish demonstrated reservation-application safety from environmental blockers and concrete gaps before production approval. Successful synthetic CI does not prove bank reconciliation, real iPhone usability, production configuration, or a complete retention policy. Existing integration, E2E and 6B evidence should answer as much as possible without expanding the test system.

## Current Process

- Modern submissions collect independent child applications, preserve server-validated `quotedAmount`, and require ADMIN confirmation against recorded deposits. Legacy Phase 18 retains timestamp-based deposit confirmation and no automatic Payment creation. Do not apply modern money semantics to legacy rows.
- Iteration 6B is **CLOSED**. Its authoritative final section is `docs/OBS-01-PERF-RESULTS.md:140`, run [39983585312](https://github.com/gulatnaru/yaho-management/actions/runs/39983585312), `obs01-perf` job `120517494083`, tested PR head `37e7db4`. Bootstrap/calibration passed; 50 cells / 62 rows COMPLETE; financial invariants passed; cleanup PASS; self-checks 209. `eebfa47` preserves the result; `29ca882` removes the temporary job. Earlier NOT RUN / INVALID text is historical and is not the final result. Detailed figures for 18 rows were not visually available; their completion was validated by the strict report contract. No reconstructed measurements and no performance optimization.
- Read-only preparation also found existing baseline-head integration run [39989509653](https://github.com/gulatnaru/yaho-management/actions/runs/39989509653): **6 files / 87 tests PASS**, including confirmation-atomicity 26, workflow-races 10 and price-recheck 26. The checkout was PR merge `c1a1fc2`, combining head `29ca882` with base `1171517`; it was not an exact-head checkout.
- Preserve the supplied Iteration 5 completed WebKit checkpoint: **63 PASS / 0 FAIL / 5 SKIP per WebKit project**. The 360px execution is independently located at run [39907935579](https://github.com/gulatnaru/yaho-management/actions/runs/39907935579), job `120271452015`, head `3e9fef5`, merge checkout `c0b3819`. Later run [39983585340](https://github.com/gulatnaru/yaho-management/actions/runs/39983585340), 360px job `120516882630`, failed dependency installation: **zero UX tests executed**, not 63 failed tests and not a new completed result.
- Additional existing evidence discovered during preparation: run [39989509694](https://github.com/gulatnaru/yaho-management/actions/runs/39989509694), baseline head / merge checkout `c1a1fc2`, subsequently **completed**. The 360px job `120537308472` again has **63 PASS / 0 FAIL / 5 BLOCKED skips**, eight selected specs, `focused=false`; Ledger 8/8 and Confirmation 7/7. Thus Iteration 5 is the supplied completed reference, while this newer completed execution is the latest retrieved evidence. Do not continue describing all later attempts as installation failures. Other WebKit projects also show 63/0/5; Chromium shows 65/0/3. Counts are project-specific, not a blanket all-engine 63/0/5 claim.
- Real iPhone Safari / VoiceOver verification is **NOT EXECUTED** to date. Automated WebKit success does not change this.
- The pre-existing schema delta is `20261015090000_ai_service_followup`, unrelated to the reservation Phase work. It remains an unapproved production prerequisite under the supplied context, not a migration to perform in 6C. Historical gate run [38926417254](https://github.com/gulatnaru/yaho-management/actions/runs/38926417254) now reports detect SUCCESS, production-migrate CANCELLED with no steps, final gate FAILURE. Its old WAITING description is stale. A current-head Production gate result was not established by available metadata; do not label it PASS or presently WAITING.

## User Story

As the operator, I want a traceable PASS / BLOCKED / 개선 필요 table showing what is proven, what is missing, and which separate approvals are needed, so that production decisions do not rely on assumptions or unnecessary reruns.

## Scope

| Area / requirement IDs | Verification scope | Required method and evidence | Required output / boundary |
| --- | --- | --- | --- |
| 1. Evidence preservation — E1, E2 | Preserve final 6B results, CI run/job IDs, commits, source identity and temporary-job removal; inventory integration/E2E evidence | Read final results section and existing CI metadata/logs; inspect Git history and workflow diff; compare relevant tested source to baseline | Evidence inventory with observed vs supplied vs contract-validated facts; no perf execution or 6B reopening |
| 2. Ledger integrity — L1–L4 | Recorded actual deposits vs confirmed quote/Payment amounts; return-obligation accounting; Payment/PaymentItem/Refund/mapping/allocation consistency; legacy distinction | Inspect batch-confirm core and every deposit/return/allocation writer; link existing integration results and 6B invariants to `D=A+P+R+T`, no over-confirmation and non-reuse of held/returned funds | Separate rows for conservation, allocation, refund separation and actual-bank reconciliation; real bank/production balance truth is BLOCKED without authorized bank evidence |
| 3. Concurrency and failure — C1–C4 | Duplicate and same-submission race confirmation, whole-transaction rollback, client retry/idempotency and lost-response recovery | Inspect existing integration cases and client/server paths; reuse 6B six race-cell evidence, duplicate cases and rollback evidence | Case-to-result map; distinguish duplicate prevention from replaying a success receipt; no unexecuted race or network hypothesis promoted to PASS |
| 4. Access and privacy — A1–A4 | ADMIN protection of pages, queries and actions; link/device/completion projections; consent storage; deletion/retention as implemented | Trace each server entry point and serialization surface; reuse role/privacy/consent/retention tests and CI evidence; compare REQUIREMENTS Phase 18/20 and ADR-008/050/055–058/060/063/064 | Entry-point and data-surface matrices; permitted own-link prices vs prohibited catalog/cross-family data; retention field map and policy gaps |
| 5. Mobile WebKit — W1–W3 | Completed 360px results vs install-only failures; admitted skips; real-device coverage | Read per-project CI steps/counts and skip reasons, existing E2E specs, Iteration 5 report; keep historical checkpoint and newer retrieved completion separate | Executed scenarios PASS only within measured scope; five WebKit skips BLOCKED individually; iPhone Safari / VoiceOver NOT EXECUTED and BLOCKED |
| 6. Pre-production approvals — P1, P2 | Production Schema Gate evidence and pre-existing AI-service delta; required migration/deployment approvals | Read workflow/release tooling, existing approval records and GitHub metadata only; no DB query or workflow action | Gate-state timeline plus approval checklist, missing evidence/owners and dependencies; no approval, migration, merge or deployment |

Every scope item maps to an atomic final-report row. An area may contain PASS, BLOCKED and improvement rows at once; an area-wide green verdict must not hide exclusions.

## Out of Scope

- Any product-code change, including finance, permissions, cookies, retry behavior, privacy or retention fixes. Report problems as separate approval items only.
- Production or Preview DB access, including read-only probes; schema/migration creation, edits, generation, application or reconciliation.
- Perf reruns, harness/self-check execution, calibration, harness redesign, financial performance optimization, new benchmarks or latency targets. 6B stays closed.
- Running DB-backed tests, starting/seeding a DB or app server, installing browsers, triggering/rerunning CI, adding broad test suites or weakening assertions/skips. This preparation runs no tests; the audit method reuses existing results.
- PR mutations, merge, deployment, Production Environment approval/cancellation, gate bypass, commits, staging or pushes. No external messaging.
- Inventing money/refund/retention policies or collecting additional personal data. No AI-service feature/privacy audit beyond identifying its existing production prerequisite.
- Editing REQUIREMENTS, DECISIONS, historical reports, workflows, Memory, or any file other than the two requested documents. A later approved audit may write only its separately authorized report.

## Business Rules

1. Source of Truth remains current request > REQUIREMENTS > DECISIONS > ARCHITECTURE > AGENTS > implementation; Memory is context only. Preserve all existing monetary, refund, capacity, consent and privacy decisions.
2. `D` is ADMIN-recorded actual pre-confirmation deposits, `P` Payment allocations, `T` completed pre-confirmation returns, `R` funded unreturned obligations, `A` unallocated available funds. `D=A+P+R+T`; funded return allocations contain `R+T`, so do not subtract `T` twice. `Q` is immutable quoted demand, not a deposit or proof of a bank transfer. Post-confirmation Refund must not replenish `A` or enter pre-confirmation return totals.
3. Inspect atomic selection, current status, amount bounds, unique mappings, lock ordering, transaction boundaries and write callers together. A lock or unique constraint alone is insufficient proof of all interleavings. Bank transfer execution is external to this ledger.
4. ADR-063 permits only valid-link, in-scope `applicationPrice`, own children's estimates and own submitted `quotedAmount` completion snapshots. No catalog/other-group prices, `Program.defaultPrice` fallback, capacity/reservation/remaining-seat/availability information, other families' PII, or public financial ledgers. Closed/revoked/expired capabilities expose no prices. Apply this to HTML, RSC, action/API responses, errors, logs, caches and browser persistence; inspect device and companion boundaries separately.
5. Consent wording version, submission time, required acknowledgements and optional GRANTED/DECLINED/REVOKED semantics must be traceable. Append-only consent has the existing expired-retention purge exception. Keep one-year unconfirmed and five-year scoped confirmed retention, KST expiry, manual ADMIN purge, structural transaction-history preservation and future-reservation protection. Do not extend the five-year rule to unscoped legacy customers or decide unresolved transaction-record retention.
6. Reuse tests only where the named case was actually executed with a matching result and source identity. Record PR head, merge checkout, environment, scope and skips. Confirm source continuity before carrying older evidence forward.
7. Classification is binding:

   | Classification | Admission rule |
   | --- | --- |
   | PASS | Named executed test/result and run/job, or a precisely bounded directly observed code fact with `file:line`. Label evidence kind. A source-reading inference about runtime behavior is never PASS. |
   | BLOCKED | Required verification cannot be completed under this environment/authorization, or execution evidence is inaccessible. State the exact missing device, environment, artifact, permission or external evidence and the safe next approval. |
   | 개선 필요 | Concrete gap with baseline `file:line`, expected rule and impact. Create a separate approval item with proposed scope/priority; implement nothing in 6C. |

8. Use evidence kinds EXECUTED (existing CI), STATIC (direct source fact), CONTRACT (recorded COMPLETE plus enforced contract), SUPPLIED (attributed historical context), and INFERENCE (unproven reasoning). Mere test existence is not an executed result. Do not promote SUPPLIED metadata or an INFERENCE to runtime PASS. Document contradictions and source limits rather than silently reconciling them.
9. Distinguish environment-caused skips from defects. WebKit HTTP-loopback Secure-cookie restrictions do not authorize weakening cookies. Missing empty-server/fault-injection fixtures do not authorize harness redesign. Any necessary new test is a narrowly justified approval proposal, not implementation.
10. Priorities are recommendations: P0 = release-critical financial/privacy integrity or missing production safety approval; P1 = required readiness/real-device/policy evidence; P2 = evidence usability/follow-up. Priority is not a defect finding or permission to act.

## Acceptance Criteria

| ID | Required audit deliverable |
| --- | --- |
| E1 | Identify the authoritative 6B final section, run 39983585312, tested head 37e7db4 and preserving commits eebfa47/29ca882; explicitly preserve historical failed attempts and the visible-vs-contract evidence limit. |
| E2 | Inventory existing CI runs, exact jobs/checkouts and outcomes; demonstrate temporary perf job removal and unchanged integration definition without any rerun. |
| L1 | Map actual-recorded deposits, immutable quotes and selected confirmation amounts; identify the external-bank reconciliation limit. |
| L2 | Trace conservation and return-hold funding/non-reuse through writers and named tests/invariants. |
| L3 | Trace one-time Payment/PaymentItem/mapping/FIFO allocation and post-confirmation Refund/Revenue separation. |
| L4 | Preserve legacy amount-unrecorded/no-auto-Payment behavior; no NULL-to-zero or default-price inference. |
| C1 | Identify sequential duplicate and paid/unpaid existing-reservation rejection evidence. |
| C2 | Identify simultaneous same-submission confirmation and confirm-vs-return evidence, including 6B race winner/loser/pair scope. |
| C3 | Identify rollback after earlier Child/reservation/consent and later PaymentItem/mapping writes. |
| C4 | Trace lost-response reads, unchanged-key replay, changed-payload rejection and absence of automatic financial write retry; state uncovered boundaries. |
| A1 | Enumerate admin pages, direct query/action paths and unauthenticated/MANAGER/TEACHER denial evidence. |
| A2 | Map ADR-063 allowed projections and prohibited HTML/RSC/API/error/log/cache/persistence fields, including completion, repeat-child and companion capabilities. |
| A3 | Map submitted consent/version/time to stored application records and confirmation ChildConsent; distinguish acknowledgement fields from consent history. |
| A4 | Map retention eligibility, lock/recheck, scrubbed and retained fields, parent/sibling handling, device tombstones and unresolved policy/operational coverage. |
| W1 | Preserve Iteration 5 completed 360px 63/0/5 evidence; label 39983585340 installation failure zero-executed; separately record retrieved newer completion 39989509694 with its checkout/counts. |
| W2 | List five WebKit BLOCKED skips separately; do not turn 63/0/5 into 68 passes or copy Chromium totals onto WebKit. |
| W3 | List real iPhone Safari/VoiceOver checks as NOT EXECUTED with missing device/iOS/assistive-technology evidence. |
| P1 | Identify AI-service migration as pre-existing/unrelated; distinguish unapproved delta, historical gate cancellation/failure, current-head unknown and actual Production DB state (unverified). |
| P2 | List required production approvals/evidence without taking any operational action. |

## Conflicts

| Existing rule | Disposition |
| --- | --- |
| REQUIREMENTS §§7–9, 13, 18–20 and Phase 18/20; ADR-005/007/023/034/036/038–040/060 | Preserve reservation, money, refund and return semantics; audit only. Legacy Phase 18 and modern Phase 20 remain distinct. |
| REQUIREMENTS Phase 18/20 and §23 security/consent; ADR-050/052/053/055–058/060/063/064 | Preserve ADMIN boundaries, privacy, consent, manual purge, valid-link price exception and legacy compatibility. ADR-063 supersedes earlier price nondisclosure only within its defined scope. |
| REQUIREMENTS §24, especially lines 2380–2382 | Existing legacy-customer and transaction-record retention questions remain unresolved. Record policy approval needs; do not invent answers or treat manual purge as a defect solely because automation is absent. |
| ADR-051; `.github/workflows/production-schema-gate.yml`; ADR-061/062 | Production gating and separate AI live/privacy approvals remain intact. 6C cannot approve or execute them. |
| ADR-065; OBS-01 SPEC/PLAN/results | Closed 6B evidence is reusable; no new fence/calibration/harness or optimization work. |
| ARCHITECTURE §§6–10; AGENTS role/Git rules | Modular Monolith and server boundaries remain; no product implementation or Git mutation. User specifically authorizes these two doc outputs only. |

## Open Questions

없음 — the audit scope and next PLAN are authorized by this request. Missing execution evidence, real-device checks, production facts and existing business-policy questions are audit outputs/approval items, not decisions required to write this specification. If execution would require a new policy or forbidden action, record it and stop that check; do not widen scope.

## Priority

**Now:** preserve and map existing evidence, inspect the six areas, identify blockers and separate improvement approvals. **Next:** after PLAN approval, produce the separately authorized `docs/ITERATION-6C-REPORT.md` through read-only inspection/evidence reuse. **Later:** separately approved fixes, targeted missing tests, real-device sessions and production release operations; performance optimization remains outside 6C.
