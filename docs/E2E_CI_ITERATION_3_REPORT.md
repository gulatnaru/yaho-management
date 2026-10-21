# E2E CI iteration 3 — run 39583183547

Scope: corrective E2E specs/helpers and this report. No application, permission, finance-policy, migration, commit, or push changes.

## A–I classification

| Group | Classification | Change / evidence |
| --- | --- | --- |
| A | TEST locator and cancellation-scenario defects; separate product UX note | Scope completion feedback to the named deposit/invitation regions, confirmation rejection to `confirmation-selection-form`, and guardian errors to the wizard form. Preserve text and visibility checks. Distinguish known cancellation refusal (retain address) from unknown transport outcome (hide address); both paths remain checked. The confirmation error is also visibly repeated in `workflow-status`; see below. |
| B | PRODUCT contractual wording gap; TEST substring also inaccurate | SPEC supplement explicitly requires the class-link sentence `복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.` Both class-link assertions now require this exact sentence. They remain enabled and are expected to fail against the unchanged shared component. |
| C | TEST transport-status assumption, supported by authorization/read-order inspection; live payload recheck pending | Replace an unconditional HTTP 404 requirement with exact denied/not-found UI, unchanged URL/no redirects, HTML and independent RSC non-disclosure. Accept only 200/404. Each missing/role/route case retains and expands its negative data assertions. |
| D | TEST locator/render-path mismatch | The invalid fixture is genuinely overallocated. `detail-ledger` is itself the alert, not an ancestor containing an alert. Assert its actual unavailable-state message, no numeric ledger cells/A label, and disabled confirmation. |
| E | TEST operation-completion synchronization defect; financial invariant unchanged | The previous deposit and next cancellation reuse the same workflow success sentence. Wait for this cancellation's terminal review/reason and matching persisted obligation before reading the exact ledger. Add terminal/amount waits for subsequent confirmation and partial return too. A committed bad ledger still fails. |
| F | TEST initial client-readiness gap found; WebKit cause requires browser rerun | There is no history navigation before either failing draft assertion, so BFCache cannot explain these failures. Enter drafts only after a real React state transition: generated deposit key or checked first child plus explicit `NEW` connection. Keep exact draft preservation after every write and the unselected sibling check. Do not claim a WebKit product fix or browser PASS. |
| G | TEST refresh/read-order defect | After saved price or completed stop notice, explicitly reload the administrator page before checking card state. Verify both displayed price and reloaded input value. The inline price reload button exists only on error/revision disagreement, so the test does not depend on its transient presence. |
| H | Unresolved original failure; added stronger TEST navigation readiness checks | The reported URL satisfies the current filter-application predicate. Preserve all URL predicates, and require the updated removal link's contractual `href=/reservation-applications?status=all` and default notification/bank values before clicking it. Exact failing CI line/predicate is still needed before claiming this group resolved. |
| I | TEST schedule-creation redirect race | `/classes/[^/]+$` also matches `/classes/new`, so the old lookup could query ID `new` before creation completed. Wait for a detail URL excluding `/classes/new`, derive the actual created ID, and verify program, location, and price. All schedule creation/business actions still use the UI. |

## Product findings (unimplemented)

The invitation cancellation case also had a scenario mismatch: aborting a response exercises unknown outcome, while its old expectations describe a definitive `{revoked:false}` refusal. The test now expires only its own synthetic capability before a real UI cancellation to obtain a known refusal, preserving the original exact message, active invite, and visible unchanged address checks. It restores the original expiry in `finally`, then separately aborts the next UI request and requires the uncertainty warning, hidden copy/address, and still-active fixture invite. The original final UI cancellation/double-click/revoked-link checks remain. `completion-interactions.test.ts` covers these distinct safety contracts. This is a fixture-state correction, not a product text/behavior change.

### B — class-link clipboard-denial wording

- Reproduction: open either existing legacy class-link card or a newly issued class-link card; deny or remove `navigator.clipboard`; activate `링크 복사`.
- Actual: shared `components/application-ux/copy-control.tsx` renders `복사하지 못했습니다. 직접 선택해서 복사해 주세요.`
- Contract: `docs/UX-REDESIGN-INTEGRATED-SPEC.md`, "Link hash limitation" supplement, item 3, explicitly says `복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.` The general INT-02 fallback requirement is less specific. PLAN Phase 7 (`Completion guidance and shared feedback reuse`) standardizes target-specific success and selectable fallback behavior; it does not revoke this class-link sentence. PLAN's immediate issue/copy/share supplement likewise preserves SPEC guidance.
- Impact: manual selection remains available, but class-link card feedback does not meet the approved wording. Existing tests' old substring also omitted `직접`, so even the contractual sentence would not satisfy that substring.
- Proposed minimal fix, **not implemented**: allow a copy-failure message override in the shared control and provide the contracted sentence in every class-link context, preserving completion's existing feedback and manual selection. Confirm the intended copy contract before any product edit.

### A — duplicate visible confirmation rejection feedback (UX note)

- Reproduction: submit the adversarial foreign-family Child selection from the confirmation E2E case and receive a definitive action failure.
- Source evidence: `WorkflowController.run()` puts `result.error` into `workflow-status` with `role=alert`; `SubmissionConfirmationForm` independently renders the same `state.error` as an alert. Both are visible product feedback, separate from any hidden live announcer duplication.
- Impact: repeated visual message and potentially repeated assistive announcement; does not establish an authorization or finance leak.
- Proposed minimal fix, **not implemented**: choose one owned location for the detailed operation error while retaining workflow freshness/status and accessible feedback. Any product structure/accessibility change needs separate review.

## C — case-by-case authorization and non-disclosure

| Case | Source authorization/render path | Required updated E2E evidence |
| --- | --- | --- |
| ADMIN missing family | Submission page requires ADMIN and calls not-found when no detail exists. | Both standard 404 headings, same missing-family URL, no family review/fixture sentinel/real-family ID in HTML or RSC. |
| MANAGER family detail and child detail | Both route pages await `requireAdminPrincipal()` before protected reads. Non-ADMIN principal calls `notFound()`. | Both headings, no redirected/login response, no review/consent/ledger/form/card, fixture guardian/child/request/token values absent in HTML and RSC. |
| TEACHER family detail and child detail | Same guard-before-read as MANAGER. | Same independent UI/HTML/RSC evidence. |
| MANAGER family ledger and whole-return workbench | Submission and returns pages require ADMIN before reads. | Both headings and no deposit/ledger/return cards, marker/application IDs or fixture private data in HTML/RSC. |
| TEACHER family ledger and whole-return workbench | Same guard-before-read as MANAGER. | Same independent UI/HTML/RSC evidence. |

The ancestor reservation-applications `loading.tsx` supplies a streaming boundary, explaining why a not-found document can have an already-started 200 response. The shared `tests/e2e/support/application-denial.ts` checks both statuses plus the stronger UI/data contract; it also rejects serialized guardian, child, quote, price, token-hash, returned-amount and consent fields. Route IDs already present in the requested URL are not treated as secret data. No permission changes were made. Any actual authorized UI or protected payload discovered by rerun is a security product defect and must stop product work.

## D — invalid ledger fixture and rendering

`ux-seed.ts` creates a deposit of 100000 and allocates 100001 to a return obligation. The fixture is invalid by construction; it is not a missing fixture. `WorkflowController` sets the ledger non-current when verification is unavailable and renders `<p data-testid="detail-ledger" role="alert">최신 원장 금액을 표시할 수 없습니다. 이전 잔액을 현재 잔액으로 사용하지 마세요.</p>`. The old descendant-role query could not find the root element and expected another component's unused branch text. No product rendering change is required by this source path.

## E — finance trace and comparison

1. The dedicated cancellation fixture owns one submission with two distinct applications: 40000 and 60000, both SUBMITTED, no deposits/obligations. The test opens that exact submission and asserts ownership before doing anything.
2. UI deposit records 60000; the next UI action cancels that fixture's 60000 application with an explicit reason/dialog confirmation.
3. Before this change, `latest()` could match the previous deposit's unchanged `저장 결과와 최신 서버 원장을 확인했습니다` before the cancellation action/refresh completed. A direct Prisma snapshot could therefore still see SUBMITTED/no obligation, correctly computing D60000/A60000/R0 for the earlier state.
4. The independent invariant helper queries deposits, payment mappings and return obligations by that same submission ID. There is no wrong-family lookup in this code path. It always checks D=A+P+R+T before the exact expected tuple.
5. `resolveApplicationWorkflow()` wraps the status/return allocation change in a submission-locked transaction with ledger validation before and after. `closeApplicationWithReturnCore()` changes terminal status and calls `reconcileReturnObligations()` atomically. There is no evidenced product branch intentionally exposing returned-obligation money as A.
6. The test now requires the cancelled row's terminal review and exact saved reason, disappearing cancellation form, persisted CANCELLED state, and matching 60000 obligation before asserting D60000/A0/P0/R60000/T0. Later UI waits precede unchanged D100000/A0/P40000/R60000/T0 and D100000/A0/P40000/R40000/T20000 assertions.

Same-head CI Integration run 39583183592 (job 119165538538) passed **87/87**. `tests/integration/reservation-applications/workflow-races.test.ts` covers the same close/reconcile action and rejection/cancellation serialization; `confirmation-atomicity.test.ts` covers sibling return funds with confirmation and partial returns. These tests await the actual action result before reading, unlike the former E2E wait. They support the synchronization diagnosis but do not replace a fresh browser run of this exact 60000 cancellation scenario. If the new terminal receipt is present and the exact tuple still differs, report a finance-policy product defect; do not change expected money or product policy.

## F — draft-loss limits

The failing paths fill controlled textareas immediately after SSR navigation, before any demonstrated hydrated state update. WebKit can retain a native DOM value while React state remains its empty initial value; a later UI update can expose that difference. This is a source-supported hypothesis, not a reproduced browser conclusion.

The corrected test path first observes state owned by the intended workflow (a nonempty generated transaction key; or selection count 1 and enabled explicit NEW confirmation), then fills the drafts. `workflow-controller.test.ts` independently checks isolated child-reason drafts across sibling operations, and `confirmation-selection.test.ts` checks unselected memo preservation. No history restore, page reload, manual draft restoration or conditional expected-value fallback was added. A post-readiness loss still fails unchanged post-write assertions and must be reported as a product defect with its browser reproduction; do not silently refill the draft.

## Verification

- `npx tsc --noEmit`: passed, exit 0; rerun after final behavioral spec/helper edits also passed, exit 0.
- `npm run lint`: passed, exit 0; final rerun also passed with one existing warning, `tests/unit/ai-service/selection-safety.test.ts:40` (`_body` unused); no lint errors.
- `npm test`: **203 files / 2478 tests passed**.
- `pgrep -af '[n]ext dev'`: no running dev server before build. `npm run build`: passed.
- `git diff --check`: passed.
- Playwright collection with nonconnecting synthetic loopback configuration: exit 0, **272 tests / 8 spec files / 4 projects** discovered. This verifies discovery only; no browser or database scenario executed.
- Independent read-only static QA/review found no additional code issues: assertions retained or made exact, cancellation fixture expiry restored in `finally`, denial helper checks UI/redirects/HTML/RSC, and exact financial invariants retained with operation-specific waits. The diff is limited to eight E2E specs, one helper, and this report; no app/lib/prisma/.github or staging changes. This limited review does not establish E2E PASS or resolve B, C/E/F runtime evidence, or H's original mismatch.
- Same-head historical Integration result: **87/87 passed**, confirmed from CI run 39583183592; no new local integration execution claimed.
- Local Playwright browser cache is absent and no dedicated local PostgreSQL fixture/server is provisioned for this task. No new E2E/browser PASS is claimed. C's actual response-body non-disclosure, E's exact post-cancellation browser state, F's post-hydration WebKit preservation, and H's original failing predicate need a fresh configured CI run. B intentionally remains unresolved with enabled contractual assertions.
- Full unit/build commands finished before the final E2E-only additions; their tested production imports did not change afterward. Final typecheck/lint covered the behavioral E2E/helper additions; subsequent edits were whitespace and this report only.

## Round 2 — run 39618718131, base e22b568

Scope: four E2E specs, the class-link issuance integration fixture, and this report. No product/application/library/schema or class-links B changes. No assertions were removed or relaxed; business writes remain UI actions. No commit or push.

### Findings and changes

| Item | Classification and evidence | Test/fixture change |
| --- | --- | --- |
| H — family-list filter removal | **Original mechanism unresolved; test synchronization hardened.** The supplied diagnostics establish that the first URL predicate, removal href, and default filter values pass. The failure is the predicate **after** the removal click; its URL remains byte-identical to the preceding native GET URL. A wrong href or failing first predicate does not explain this run. | Register a bounded URL/load wait before submitting the native GET. Retain the actual live-locator Link click, register its destination wait before clicking, and retain both original URL predicates and the exact href check. Also require the removal link to disappear and all three resulting filter values to be `all`. No direct navigation, repeat-click, or fallback masks a nonfunctional link. This is a candidate synchronization repair, **not a reproduced explanation or verified H fix**. |
| Full journey — two selected classes | **TEST asynchronous discovery defect.** `Locator.all()` snapshots immediately. The original loop could execute zero checks while the streamed composer/options were absent, then find the form only during the checked-count assertion. There was no prerequisite count/visibility assertion. This path is consistent with the reported zero checked controls; no observed trace proves which events ran. | Require exactly two marker-matching class checkboxes before selecting either; check both through the UI, require each to remain checked, retain the exact total of two checked, and require the issuing button to be enabled. No database/API replacement for business actions. |
| Ledger — mobile WebKit 360 timeout | **Exact hung operation unresolved; TEST completion boundary hardened.** CI job 119286135417 confirms a ledger timeout; its safe summary does not contain the hung call. Per the run's own diagnostics, the timed-out test is `integrated-ux-ledger.spec.ts:108` ("save followed by failed authoritative read hides balances and blocks stale confirmation until lookup succeeds"); the guardian-cancellation test passed on this project, so the hardening below targets a different test than the one that hung. `latest()` searches a success sentence retained while the next operation is pending, so it alone cannot establish completion. The source matches the round-1 cancellation/confirmation terminal selectors; there is no evidence that their expected financial state should change. | Before cancellation and after the additional deposit, require the saved deposit receipt, exact current visible ledger, and enabled next-transaction control. Require review/confirmation readiness and bound their clicks. Named steps distinguish these operations. Keep the cancellation status/reason/obligation checks, insufficient-funds rejection, all original independent exact ledger tuples, `D=A+P+R+T`, unchanged cancelled application, and zero Refund check. This does **not** establish which call exhausted the original 90 seconds or claim that the timeout is resolved. |
| Guardian — mobile WebKit 390 evaluate interruption | **TEST read/navigation race.** The revocation/BFCache case calls `noBrowserPii()` after history navigation. Absence of an input can pass while another document is committing; it does not establish that the execution context is stable. | Wait for document load before inspecting URL/storage. Retry the read once only for `Execution context was destroyed`, after another load wait. A returned `false`, any other error, or the retry failing still fails. Preserve the URL, localStorage/sessionStorage, empty-form, price-hiding, and zero-application assertions. |
| Integration — same-date class edit | **FIXTURE midnight defect.** The old `now + 100 days` retained the runner's time of day; at 14:40 UTC it yielded KST 23:40–00:40. Formatting both times onto the start date correctly fails same-date validation before redirect. | Preserve the KST calendar date of `now + 100 days`, pin it to **10:00 KST**, and retain the one-hour duration. All redirect, stale-price, financial/historical immutability, atomicity, concurrency, token, and cleanup assertions remain. |

### Product findings and remaining reproduction

- **B remains the intentional documented product wording gap.** Both tests and all product copy are untouched; the earlier reproduction, impact, and proposed unimplemented fix still apply.
- **H is a suspected navigation defect until a browser rerun distinguishes it from the document-load race.** Reproduction from the supplied run: open the fixture class family list with `page=999`; choose status `all`; submit `조회`; observe the passing class/status URL and `href=/reservation-applications?status=all`; activate `클래스 필터 해제`; observe the identical class-filtered URL instead of the link destination. Impact if reproduced after completed loading: an operator cannot clear the class filter with that link. Repeat on the same fixtures with the new load boundary and capture the clicked anchor, navigation requests, and final filter state. If a fully loaded live Next Link still suppresses navigation, a minimal candidate product fix is a native anchor for this filter removal using the existing `familyListHref` output; **unimplemented and subject to the actual reproduction**. No confirmed additional product defect is claimed.
- The mobile-360 ledger timeout still needs its exact failing stack/call log or a configured browser rerun. A committed wrong tuple after the new operation-specific receipts would be a product finance defect; expected amounts must not be changed to make it pass.

### Round 2 verification

Results below cover the final test edits. Browser/runtime limitations remain separate from static and unit checks.

- `npx tsc --noEmit`: passed. `npm run lint`: passed, with only the existing `_body` warning in `tests/unit/ai-service/selection-safety.test.ts:40`.
- `npm test`: **203 files / 2,478 tests passed**. `npm run build`: passed after `pgrep -f '[n]ext dev'` found no running dev server. `git diff --check`: passed.
- Offline fixture regression using the real `classInputSchema` and KST formatters: **all 1,440 UTC minutes passed** for the pinned fixture. The old fixture is rejected in exactly the 60 minutes from 23:00 through 23:59 KST, including this run's 14:40 UTC. The new fixture preserves the `+100d` KST calendar date, remains future-eligible, roundtrips to 10:00–11:00 KST, and retains exactly one hour. Other tests in the integration file require future eligibility and compare loaded snapshots/revisions; none requires the original wall-clock time. No PostgreSQL integration execution is implied by this check.
- GitHub connected reads confirmed the run's base SHA and per-spec job summaries. The artifact tool returned a ZIP download reference; this sandbox denied the local download (`socket: operation not permitted`), so the unavailable ledger call log was requested separately. No artifact contents beyond the user's H evidence are claimed as inspected.
- A system Chromium executable was found at `/opt/meta-chromium/chrome`. Two Playwright launch attempts failed **before page creation**, first in crashpad socket setup (`setsockopt: Operation not permitted`, SIGTRAP), then with crashpad disabled in sandbox host setup (`shutdown: Operation not permitted`, SIGABRT). These failures do not reproduce H or any app behavior. No dedicated disposable local PostgreSQL server is provisioned. No new browser or PostgreSQL integration PASS is claimed.

