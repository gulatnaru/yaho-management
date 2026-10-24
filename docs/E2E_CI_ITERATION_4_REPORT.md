# Integrated E2E Iteration 4

Baseline: [run 39624046205](https://github.com/gulatnaru/yaho-management/actions/runs/39624046205), HEAD `bf25c36`, branch `feature/phase21-ai-service`. The connected job summaries identify 272 executions: 239 PASS, 15 FAIL, 18 BLOCKED. Desktop: 61/4/3; tablet WebKit: 60/3/5; each mobile WebKit: 59/4/5 (PASS/FAIL/BLOCKED). Ledger was 8/8 and Confirmation 7/7 in each project.

## Evidence boundaries

The supplied failure descriptions and connected baseline summaries establish the failing scenarios. Historical artifact ZIP contents/browser traces were unavailable in this environment. This iteration does **not** claim to have observed the historical click, wire response, completed re-query or underlying database state after those failures. No local Chromium/WebKit plus PostgreSQL E2E run was performed. The 272-test collection check is discovery, not a passing matrix.

Source inspection and real component-handler unit reproductions support the findings below. Remaining browser-specific questions are explicitly unresolved; bounded, privacy-safe diagnostics make the next full CI execution distinguish them without changing financial/auth behavior.

## P0 — reservation/payment integrity

**Classification:** demonstrated test synchronization defect; the historical financial product outcome remains unobserved. No financial product code changed.

`integrated-ux-full-journey.spec.ts` previously called `latest()` after confirmation, which only required the workflow container to contain `저장 결과와 최신 서버 원장을 확인했습니다`. `WorkflowController.run()` sets freshness to pending without clearing the prior message. Thus the preceding deposit's success paragraph satisfies the old assertion while confirmation's save **and** its authoritative read can still be pending. The new workflow-controller unit case reproduces both pending phases with deferred real handler promises: the old success text remains, while the first paragraph is `저장·서버 원장 확인 중…` and further writes are blocked. Only the receipt-matching server read makes the first paragraph current.

The journey now requires the selected application's confirmation row to disappear, the **first** status paragraph to equal `서버 원장 확인됨`, the success text, and the route's mutation/read Server Action requests to finish. Row disappearance is tied to `pending` filtering of that exact application in `WorkflowController`; `workflowReceiptPresent()` checks its CONFIRMED status, Reservation, PaymentItem and matching ApplicationPaymentMapping before accepting the read. Only after these signals does a 5-second bounded read-only DB poll wait for the linked records. There is no fixed sleep and no action retry.

| Required trace | Source/test evidence and next-run measurement |
| --- | --- |
| 1. Confirm-button timing | Selected row checkbox and `NEW` combobox asserted first; click-request and completed-click timestamps bracket the actual Playwright click. |
| 2. Action execution/response | Ordered POST request/response/requestfinished ordinals, HTTP status and elapsed time; successful receipt UI is required because HTTP 200 alone is insufficient. First POST is the mutation, the following POST is the authoritative read in the coordinator source. |
| 3. Latest server re-query | Exact current first paragraph, selected-row disappearance and finished read transport precede DB polling. Unit reproduction holds the read unresolved and verifies pending. |
| 4. Target Application ID | The original submitted `first.id` drives the selector and every DB read; exact application/submission equality asserted. Stable numeric SHA-256-derived identity tags correlate phases in uploaded diagnostics. |
| 5. Child ID / NEW or existing | Explicit `NEW` UI choice; pre-confirmation Child IDs captured; resulting application Child ID must be new and equal the Reservation Child ID. Child identity tag recorded. |
| 6. Reservation | Required linked Reservation, original class, exact one-reservation count, identity tag. |
| 7. Payment + PaymentItem | Required nested records; exact amount/paidAmount/totalAmount **40000**, refundedAmount **0**, PAID status; identity tags. |
| 8. ApplicationPaymentMapping | Mapping must point to the same PaymentItem; count remains one after reload; identity tag. |
| 9. D/A/P/R/T | Exact final **100000/60000/40000/0/0** retained; `assertFamilyLedger` still requires **D=A+P+R+T** and checks allocation destinations. Snapshot diagnostics run even when the UI wait fails. |
| 10. Unselected sibling | Checkbox must remain unchecked and the complete original sibling DB row must remain equal; equality fact and identity tag recorded. |

QuotedAmount immutability before/after subsequent class-price changes remains asserted. Deposit's intentional duplicate click and single-deposit assertion remain. Diagnostic DB read failures are marked separately and do not replace the primary confirmation failure.

Files: `tests/e2e/integrated-ux-full-journey.spec.ts`, `tests/e2e/support/integrated-ux-sync.ts`, `tests/unit/reservation-applications/workflow-controller.test.ts`, shared diagnostic files listed below.

If CI reaches the verified receipt/read signals but DB links are absent, treat that as a product defect: reproduce with this unchanged journey on disposable local fixtures, capture the correlated app/child/receipt facts, and investigate the confirmation transaction's relation creation/receipt projection. Impact: an apparently confirmed application lacks its reservation/payment integrity. A proposed minimal repair must address the proven transaction/projection inconsistency; this iteration intentionally applies none without evidence/authorization.

## P1a — class-links copy guidance and other failures

**Classification:** confirmed wording mismatch; approved minimal product change applied. Existing `CopyControl` hardcoded `복사하지 못했습니다. 직접 선택해서 복사해 주세요.`; class-links specs require exactly `복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.`.

`CopyControl.failureMessage` defaults to the unchanged original text. `ApplicationLinkCard` passes the required text to both the raw legacy control and the newly issued control through optional `IssuedLinkControls.copyFailureMessage`. Group/completion callers retain their defaults. Clipboard-denied E2E checks assert the exact message, unchanged address and full manual selection for both legacy and newly issued addresses. Handler tests exercise denied clipboard, retained read-only address, selection, successful explicit retry, scoped override and default behavior.

**Missing `신청 링크 주소`: unresolved historical fixture/projection/hydration mechanism; no speculative product/fixture mutation.** The seeded legacy fixture has an active plaintext direct link and applicationPrice 40000. `getClassApplicationLinks.projectLinks()` exposes active stored plaintext independently of applicationPrice; `ApplicationLinkCard.rawLinks` renders it independently of price as well. Changing legacy price to null therefore has no demonstrated causal basis. The read-only test now asserts active plaintext count=1 and upgraded scope count=0 before requiring exactly one nonempty address. New issuance additionally waits for action success/response and records issued group/active-link counts versus address presence. Fingerprint/no-write assertions remain.

Reproduction: run class-links legacy copy case or the atomic issuance case with the existing fresh per-project fixtures. If the DB fixture assertions pass but no address appears after the completed action/current projection, impact is inability to copy/share the valid address. Inspect the current-scope membership, raw-path projection and issuance receipt link ID against the active scope; fix only the first demonstrated mismatch. No product defect was established locally.

**`25,000원` versus `참가비: 미설정`: synchronization hazards demonstrated in source; exact historical cause unresolved.** The dedicated price fixture intentionally starts at null. `ApplicationPriceForm` is a controlled input initialized from that price and its submit handler reads React state. Filling/clicking visible SSR before hydration does not prove that the intended draft reached that handler. Separately, the action's saved notice precedes `router.refresh()` and does not certify the new card projection. Tests now require attached input/form handlers before filling/submitting, completed action transport, the exact saved notice, **`참가비: 25,000원` in the server card**, and exact DB applicationPrice=25000. The expected amount and fixture remain unchanged; no reload hides a stale projection.

Reproduction/diagnosis: the issuance case records priceBefore, requestedPrice, storedPrice and displayedPrice. Stored old/null means the intended mutation was not saved (inspect hydrated input, validation/action outcome); stored=25000 with a stale displayed card after refresh establishes a display/projection problem. Impact: misleading issuance readiness/fee display. Proposed minimal product repair, only if proven, is to correct the stale server projection/revalidation or controlled draft handoff that the trace identifies; none is applied here.

Product files: `components/application-ux/copy-control.tsx`, `app/(admin)/classes/_components/application-link-card.tsx`, `app/(admin)/classes/_components/multi-class-link-composer.tsx`.

Test files: `tests/e2e/integrated-ux-class-links.spec.ts`, shared sync helper, `tests/unit/reservation-applications/legacy-link-card-interactions.test.ts`.

## P1b — family-list filter-clear navigation

**Classification:** unresolved historical navigation failure; test hydration readiness/diagnostics added, no navigation product fix claimed or applied.

`ApplicationStatusFilter` renders a Next Link with `familyListHref({ ...filters, classScheduleId: undefined, page: 1 })` inside a native GET form; there is no custom click/submit cancellation handler in that component. The expected href remains `/reservation-applications?status=all`. The baseline already waited for native GET document load and the new href; those are insufficient to establish that the Link's React handler was attached. No source-only evidence proves a broken router after full hydration.

After the existing GET-load/href/filter checks, the test now waits for the Link's attached handler, verifies the drawer is hidden and its actual pointer target is unobstructed, and uses **one real click**. A document-bubble listener samples `defaultPrevented` after React's root handler. Safe diagnostics record clicked/handler/href/hit/menu facts, matching GET request count, final URL, all three filter values and page reset, including on timeout. A zero request count alone is not called a defect because a prefetched router result may avoid a fresh request. No `page.goto()` substitutes for the clear click and no click is repeated.

Reproduction: existing global-badge/filter-reset case in all four projects. If hydrated, correctly hit, correct-href clicks still leave the class/page query in place, impact is inability to clear the class filter via its provided navigation. Compare interception, request and final-state facts to locate the failure. Proposed minimal fix, only after that evidence, is to repair the specific Link/event/router handling while retaining `familyListHref` generation and status/filter/page policy. This iteration has no basis for choosing that product change.

Files: `tests/e2e/integrated-ux-family-list.spec.ts`, shared sync/diagnostic helpers.

## P1c — mobile WebKit guardian price card

**Classification:** unresolved historical browser failure; test synchronization strengthened without a guardian product change.

`ApplicationWizard.next()` awaits `checkPrices()` before advancing to step 3; a deferred real-handler unit test proves the form stays disabled in step 2 while the re-query is unresolved, then shows exact 60000→65000 / 100000→105000 review and preserves both drafts. Therefore a blanket claim that step 3 is rendered before the price re-query is unsupported. The changed review intentionally retains the old displayed summary until the guardian explicitly accepts the changed price; that is required review behavior.

The shared guardian helper now waits for hydrated Next handling and a visible class inventory, enumerates candidates after readiness, checks every selected candidate, and records counts. Consent-step entry requires the enclosing fieldset to become enabled after async checking finishes and any observed recheck transport to finish; it does not require Submit to be enabled when a changed price still needs approval. The operator price-change helper now requires hydrated controlled input/submit handlers, the completed save, the refreshed **exact** card price and exact DB price, without reloading away the original projection.

The failing scenario retains both exact before/after review assertions and final quoted amounts `[70000, 40000]`. Added checks require the accepted summary's 65000/105000 and then 70000/110000, read both preserved child names/birthdates in input step, and verify common/optional consents remain. There is no weaker money assertion and no auto-resubmission.

Reproduction: the existing two-price-change scenario in mobile-webkit-360 and mobile-webkit-390, with the same fresh guardian fixtures. The operator's stored/displayed price facts distinguish an unsaved admin draft from stale admin projection; subsequent ordered guardian-recheck/field-enable/review facts distinguish incorrect candidate assignments or actual stale guardian data. If correct stored prices and completed refresh still leave a stale WebKit UI, impact is an incorrect displayed current price/total. The proposed minimal product fix must correct the demonstrated stale state/projection handoff while preserving explicit price review, draft/consents and submission protections; none is applied without that reproduction.

Files: `tests/e2e/integrated-ux-guardian.spec.ts`, `tests/e2e/support/integrated-ux-guardian.ts`, shared sync helper, `tests/unit/reservation-applications/guardian-wizard.test.ts`.

## Safe diagnostics and protected behavior

`ux-trace.ts` accepts a bounded list of explicit event names and explicit **numeric/boolean-only** fields. Identity tags hash only run-owned record IDs; no capabilities, raw IDs, financial payloads, names, phone numbers, request/response bodies, headers, cookies, credentials or browser storage are emitted. `ux-reporter.ts` projects only schema-accepted trace annotations into the existing `results.json`/`statuses.json` artifacts; arbitrary annotations/stdout/attachments remain excluded. Unit tests cover rejection of PII/string/unknown fields and preservation in both existing artifact projections.

Shared files: `tests/e2e/support/integrated-ux-sync.ts`, `tests/e2e/support/ux-trace.ts`, `tests/e2e/support/ux-diagnostics.ts`, `tests/e2e/support/ux-reporter.ts`, `tests/unit/e2e/integrated-ux-sync.test.ts`, `tests/unit/e2e/ux-diagnostics.test.ts`.

`waitForReactHandler` uses the installed React 19 host `__reactProps$` attachment to establish test readiness without invoking handlers. This is a **private-runtime, test-only dependency**: framework changes may require updating it; absence fails bounded readiness rather than bypassing UI. Unit tests cover missing, wrong, unrelated and attached handlers. It is not proof of browser compatibility; CI remains required.

No schema/migration, fixture seed, finance Core, permission, DB policy, cookie/auth policy, workflow configuration, Ledger spec, Confirmation spec or completion product code changed. All 18 BLOCKED admission conditions remain. Protected duplicate-deposit, return-allocation, ledger identity, selected-child-only, sibling, quote immutability, lost-response and permission/PII assertions remain. No commit/stage/push was performed.

## Verification

- Focused real-handler/privacy/helper tests: **85/85 PASS**.
- Full E2E collection: **272 executions in 8 files**, unchanged projects/scenarios/admission. Collection used synthetic loopback connection metadata only and made no DB connection.
- Typecheck: **PASS**, `npx tsc --noEmit`, after all source edits.
- Lint: PASS, zero errors; existing unrelated `_body` unused-variable warning in `tests/unit/ai-service/selection-safety.test.ts:40`.
- Full unit suite: **2486/2486 PASS in 204 files**, `npm test`.
- Production build: **PASS**, `npm run build`; `pgrep -f '[n]ext dev'` found no running dev server before build.
- Final verification scope: full suite/build preceded a test-only Promise generic annotation and final E2E locator/diagnostic-fact corrections. The changed guardian handler test passed again **29/29** after the type annotation; final standalone typecheck, full lint, 272-test collection and `git diff --check` all passed after the final source corrections. Product runtime code was unchanged after the successful full suite/build.
- Browser/DB E2E: not run locally; no claim that baseline failures are now passing. Full CI rerun must retain Ledger 8/8 and Confirmation 7/7 per project and the 18 expected BLOCKED outcomes.

## Next

Review the uncommitted tree and rerun the existing full integrated E2E CI workflow on fresh disposable per-project databases. Inspect the existing safe diagnostic artifacts if any scenario still fails. Preserve the unresolved classifications until that execution establishes the actual browser/action/DB sequence. Product fixes outside the approved class-links wording change remain subject to the user's stated boundaries (P1b only if a real navigation defect is proven; P0/P1c document only).
