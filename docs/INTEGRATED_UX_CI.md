# Integrated UX CI execution

## Gate A: original inventory and classification

Reconnaissance was completed before mutations using the seven requested specs,
`playwright.ux.config.ts`, `support/db-safety.ts`,
`lib/e2e/local-origin-safety.ts` and `phase2-integration.yml`.
The original `npx playwright test --config playwright.ux.config.ts --list`
inventory contains **61 distinct scenarios, 244 project executions**.
Each listed scenario exists in all four projects; both MANAGER and TEACHER
instances are retained even where dynamic titles share a source line.

| Original spec | Tests/project | RUNNABLE after setup* | BLOCKED | Auth | Original skip / fixture dependency |
| --- | ---: | ---: | ---: | --- | --- |
| class-links | 5 | 5 | 0 | ADMIN, MANAGER, assigned TEACHER | Missing read-only class inventory, fresh per-project issuance classes and real storage states. Issuance intentionally skips non-pristine classes. Valid bank/channel singleton is required. |
| family-list | 10 | 8 | 2 | ADMIN, MANAGER, TEACHER | Missing family, empty-class, privacy-sentinel, global badge fixtures and role states. Empty authenticated server and controlled read-failure states are unavailable. |
| family-detail | 11 | 10 | 1 | ADMIN, MANAGER, TEACHER | Missing review/foreign/purged/unknown-consent/invalid-ledger/confirmed-related fixtures and states; controlled authenticated read-failure state unavailable. |
| ledger | 7 | 7 | 0 | ADMIN, MANAGER, TEACHER | Missing pristine independent zero-deposit two-child families per width/loss/refresh case. |
| confirmation | 5 | 5 | 0 | ADMIN | Missing independent deposited two-child families per width/loss and a full first class for overbooking. |
| completion | 12 | 12* | 0* | Public; self-owned synthetic owner | No skip conditions in original source; owns settings, program/classes/groups/submissions and capability fixture; refuses an existing singleton. One actual-submission case additionally depends on browser Secure-cookie policy. |
| guardian | 11 | 11 | 0 | Public; self-owned synthetic owner | No original skips; self-owned per-test legacy/group/upgrade/companion/device/Child fixtures; refuses existing settings singleton. |
| **Total** | **61** | **58*** | **3*** | | **232 runnable + 12 explicit controlled-server BLOCKED executions** on cookie-supporting engines. |

*“Runnable” describes CI readiness, not a claimed browser pass. Linux browser behavior
is measured in CI. The auth setup probes each actual project's engine with two
synthetic responses at the mandatory `http://127.0.0.1:3000` origin. It checks
whether an HTTP response's Secure HttpOnly cookie is sent on the next request,
without printing or retaining cookie values. A proven false probe additionally
classifies the original completion actual-submission case and the newly added full
journey as BLOCKED on that project. No engine-name heuristic, insecure flag,
response cookie rewrite, or injected application capability is used. The exact
conditional allowlist is in `tests/e2e/support/ux-reporter.ts`.
A missing probe result fails execution. Final project counters come from CI.

The three unconditional blockers are:

- family-list / first-ever zero: requires a separately provisioned empty authenticated server; this suite deliberately has seeded families.
- family-list / failed read: requires a controlled server failure after authentication; no app fault-injection mechanism exists.
- family-detail / shows retry: the same unavailable authenticated detail-read fault mechanism.

Their existing `test.skip` guards remain. The strict reporter accepts only those
exact file/title combinations, plus the two precise cookie-dependent titles after
an actual false probe. All other skips (including missing fixture/auth env and
non-pristine class fixtures), unexpected expected-failure statuses, runner errors,
zero discovery and incomplete execution fail the job. Every run prints discovered,
completed, passed and BLOCKED counts without raw assertion values or capabilities.

## Fixture and authentication architecture

Each of the four matrix jobs receives its own disposable PostgreSQL 16 service,
never a Preview/Production connection. All writes require BOTH database URLs to
match loopback, port 55432, database and user yaho_e2e. The preexisting CI metadata
verification and NOLOGIN anon/authenticated role shim run unchanged before
`prisma migrate deploy`. No schemas, migrations or Production Schema Gate policy
are changed. A seed refuses existing Users, Programs or settings instead of wiping
another test's data.

`ux-seed.ts` calls the app's actual `ensureBootstrapAdmin` (the same mechanism
used by `prisma/seed.ts`), including bcrypt cost 12 and the account-mutation lock.
MANAGER and TEACHER use `createAccountCore`, its live ADMIN authorization, teacher
link validation, audit history and forced temporary-password policy. It passes a
bcrypt-12 hash exactly as the app account action does. `ux-auth.ts` then logs in
through the actual login form/Auth.js server action, completes MANAGER/TEACHER's
required password-change form, signs in again, and saves Auth.js-generated browser
storageState. It checks active role/teacher/forced-change state in the fixture DB.
No session, JWT, password flag or authorization is manufactured or bypassed.

Fixtures have fresh UUID ownership per job, spec and mutating scenario: eight
read-only class states, price-issuance classes, multiple groups, separate
40000/60000 two-child families for ledger and deposited confirmation cases,
existing versus foreign-family Children, an occupied class, confirmed
Reservation/Payment/PaymentItem/mapping/allocation history, purged and unknown
consent originals, and an intentionally inconsistent aggregate ledger. The invalid
ledger fixture uses legal rows with allocations exceeding their source, and
verifies safe read behavior; it changes no constraint. The original guardian and
completion specs own their fixture/capability/expired/revoked lifecycle cases.

Direct writes prepare starting fixture state only. Under-test issuance, guardian
submission, notification, bank recording, return/reject/cancel and confirmation
remain real UI/server actions. Financial records prepared for read-only detail or
confirmation starting states are not substituted for the action under test.

The runner executes specs in this explicit order:
`family-list → class-links → family-detail → ledger → confirmation → completion → guardian → full-journey`.
The list runs before any mutation, so its global pending-family snapshot is stable.
Each spec is a new Playwright process, supplied with the manifest BEFORE import-time
env reads/skip decisions, using exactly one selected project and one worker.
Class-links receives a run-owned valid settings singleton created and removed in
`finally` with an ownership predicate. Completion, guardian and full journey each
require an absent singleton and create/remove their own, with no overwrite.

Runtime credentials, fixture manifests and storageState live only beneath
`test-results/ux-runtime/` (already ignored by the existing `test-results/`
rule), with private file permissions. Browser output uses the sibling
`test-results/ux-output/`; Playwright cleanup cannot delete the runtime manifest
or auth states. No new .gitignore rule is needed. Artifacts are never uploaded;
video, screenshots and traces are disabled. The final always-run step removes
runtime states, reports and withheld server logs. Auth.js uses a fresh masked
runtime secret written to GITHUB_ENV, never a repository/deployment secret.

## Workflow and commands

`.github/workflows/e2e-ux.yml` runs on workflow_dispatch and relevant pull requests
using ubuntu-latest, Node 20 and public-repository standard hosted runners only.
Its four isolated parallel jobs are desktop-chromium, mobile-webkit-360,
mobile-webkit-390 and tablet-webkit-768. Both Chromium and WebKit are installed
with OS dependencies in every job (Chromium performs real auth even for WebKit
projects). Each job has a 40-minute bound and no continue-on-error masking.
No paid services, remote DB, deployment, protected environment or approval gate is
used; service containers disappear with the job.

Order: checkout → Node/npm ci → random auth secret → Prisma generate → browsers →
DB verify → role shim → migrations → seed fixtures → typecheck/lint → production
build → production Next start at fixed loopback origin → real auth/probe → all
UX specs → stop/remove runtime files. The build checks for a next dev process
before touching shared .next output; the workflow starts no dev server.

With the dedicated DB/service environment supplied, the execution entrypoints are:

```sh
# UX_PROJECT is one of the four names above. Both safe DB URLs are mandatory.
export UX_MANIFEST_PATH=test-results/ux-runtime/manifest.json
npx tsx tests/e2e/support/ux-cli.ts seed
# Build before starting any server; start production Next on 127.0.0.1:3000.
npx tsx tests/e2e/support/ux-cli.ts auth
npx tsx tests/e2e/support/ux-cli.ts run
```

Discovery (does not connect to PostgreSQL or start browsers) uses the same safe DB
environment and `npx playwright test --config playwright.ux.config.ts --list`.
The sandbox has no supported PostgreSQL/container runtime; no local browser/DB
execution is claimed. The orchestrator pushes and runs CI after handoff.

## Full original Gate A title inventory

Every row below was discovered in **each** of desktop-chromium,
mobile-webkit-360, mobile-webkit-390 and tablet-webkit-768 (61 × 4 = 244).
R = runnable after setup; B = controlled-server BLOCKED; R/C = runnable if the
actual secure-cookie probe supports the required origin, otherwise BLOCKED.
Full role/suite paths distinguish dynamic cases with identical leaf titles.

| Spec | Original suite and complete test title | All four project classifications |
| --- | --- | --- |
| class-links | Phase 1 existing synthetic class inventory (read only) / hash reload retains metadata; inventory includes multiple groups and closed class navigation | R / R / R / R |
| class-links | Phase 1 existing synthetic class inventory (read only) / copy denial keeps manual address; new tab/copy neither write rows nor rotate tokens | R / R / R / R |
| class-links | MANAGER sensitive inventory denial / class HTML/RSC contains no application card, token, scope management URL or price | R / R / R / R |
| class-links | TEACHER sensitive inventory denial / class HTML/RSC contains no application card, token, scope management URL or price | R / R / R / R |
| class-links | Phase 2 dedicated local synthetic issuance / inline price → atomic issue → safe copy/share/open → metadata-only revisit → scoped dialogs | R / R / R / R |
| completion | Phase 7 public completion presentation / saved quotes, transfer guidance and secondary invitation wrap at every configured viewport | R / R / R / R |
| completion | Phase 7 public completion presentation / copy uses exact values and target-specific announcements without additional writes | R / R / R / R |
| completion | Phase 7 public completion presentation / denied clipboard offers keyboard/mobile manual selection and never reports success | R / R / R / R |
| completion | Phase 7 public completion presentation / unsupported clipboard offers keyboard/mobile manual selection and never reports success | R / R / R / R |
| completion | Phase 7 public completion presentation / notification records only its first timestamp and survives refresh without financial changes | R / R / R / R |
| completion | Phase 7 public completion presentation / lost notification response remains uncertain and refresh reconciles the recorded timestamp | R / R / R / R |
| completion | Phase 7 public completion presentation / invite creation and cancellation resist double clicks; cancel failure retains its address | R / R / R / R |
| completion | Phase 7 public completion presentation / legacy completion retains generic account/channels and never exposes family details | R / R / R / R |
| completion | Phase 7 public completion presentation / invalid completion retains generic account/channels and never exposes family details | R / R / R / R |
| completion | Phase 7 public completion presentation / expired completion retains generic account/channels and never exposes family details | R / R / R / R |
| completion | Phase 7 public completion presentation / all completion mutations and copy buttons are disabled without hydration | R / R / R / R |
| completion | Phase 7 public completion presentation / successful submission replaces the document; reload and back do not restore inputs or resubmit | R/C / R/C / R/C / R/C |
| confirmation | Phase 6 explicit selected atomic confirmation / 360px explicit NEW choice confirms first only; sibling memo draft and original request survive | R / R / R / R |
| confirmation | Phase 6 explicit selected atomic confirmation / 390px explicit NEW choice confirms first only; sibling memo draft and original request survive | R / R / R / R |
| confirmation | Phase 6 explicit selected atomic confirmation / 1280px explicit NEW choice confirms first only; sibling memo draft and original request survive | R / R / R / R |
| confirmation | Phase 6 explicit selected atomic confirmation / lost response reconciles actual Reservation/Payment without replay | R / R / R / R |
| confirmation | Phase 6 explicit selected atomic confirmation / overbooking has one primary action and selection changes discard its approval | R / R / R / R |
| family-detail | Phase 4 read-only family detail / 360px preserves review/ledger/existing-confirmation order and child/list context | R / R / R / R |
| family-detail | Phase 4 read-only family detail / 390px preserves review/ledger/existing-confirmation order and child/list context | R / R / R / R |
| family-detail | Phase 4 read-only family detail / 768px preserves review/ledger/existing-confirmation order and child/list context | R / R / R / R |
| family-detail | Phase 4 read-only family detail / 1280px preserves review/ledger/existing-confirmation order and child/list context | R / R / R / R |
| family-detail | Phase 4 read-only family detail / foreign, missing and malformed child hints remain within the current family | R / R / R / R |
| family-detail | Phase 4 read-only family detail / purge and unknown original states are explicit | R / R / R / R |
| family-detail | Phase 4 read-only family detail / invalid ledger never displays a normal available value | R / R / R / R |
| family-detail | Phase 4 read-only family detail / missing family is a safe not-found response | R / R / R / R |
| family-detail | Phase 4 MANAGER denial / direct family/child URLs reveal no review, consent or ledger | R / R / R / R |
| family-detail | Phase 4 TEACHER denial / direct family/child URLs reveal no review, consent or ledger | R / R / R / R |
| family-detail | Phase 4 controlled read failure / shows retry without a success/zero-balance fallback | B / B / B / B |
| family-list | Phase 3 read-only family list / 360px expansion is separate from detail navigation and return restores context/card | R / R / R / R |
| family-list | Phase 3 read-only family list / 390px expansion is separate from detail navigation and return restores context/card | R / R / R / R |
| family-list | Phase 3 read-only family list / 768px expansion is separate from detail navigation and return restores context/card | R / R / R / R |
| family-list | Phase 3 read-only family list / 1280px expansion is separate from detail navigation and return restores context/card | R / R / R / R |
| family-list | Phase 3 read-only family list / global badge uses families and filter application/removal reset the page | R / R / R / R |
| family-list | Phase 3 read-only family list / no matches offers reset and preserves existing class entry context | R / R / R / R |
| family-list | MANAGER application denial / direct list and context query reveal no application cards/counts | R / R / R / R |
| family-list | TEACHER application denial / direct list and context query reveal no application cards/counts | R / R / R / R |
| family-list | Phase 3 controlled empty/outage server states / first-ever zero has a different message | B / B / B / B |
| family-list | Phase 3 controlled empty/outage server states / failed read displays retry rather than zero or success | B / B / B / B |
| guardian | Phase 8 guardian three-step input / legacy: exactly three input steps, Enter never saves, optional consent is independent, result is separate | R / R / R / R |
| guardian | Phase 8 guardian three-step input / single: exactly three input steps, Enter never saves, optional consent is independent, result is separate | R / R / R / R |
| guardian | Phase 8 guardian three-step input / upgrade: exactly three input steps, Enter never saves, optional consent is independent, result is separate | R / R / R / R |
| guardian | Phase 8 guardian three-step input / group: exactly three input steps, Enter never saves, optional consent is independent, result is separate | R / R / R / R |
| guardian | Phase 8 guardian three-step input / companion: exactly three input steps, Enter never saves, optional consent is independent, result is separate | R / R / R / R |
| guardian | Phase 8 guardian three-step input / middle removal preserves stable fields and optional choices; common consent is reviewed again | R / R / R / R |
| guardian | Phase 8 guardian three-step input / 100000 to 105000 review, second submit-time change, input/consent preservation and explicit resubmission | R / R / R / R |
| guardian | Phase 8 guardian three-step input / field summary opens/focuses the correct child and leaves other input intact | R / R / R / R |
| guardian | Phase 8 guardian three-step input / transport loss blocks duplicate clicks and never automatically retries the action | R / R / R / R |
| guardian | Phase 8 guardian three-step input / revocation hides all prices and clears the active form; BFCache does not revive PII | R / R / R / R |
| guardian | Phase 8 guardian three-step input / device-owned existing Child stays read-only and friend invitation never grants issuer family data | R / R / R / R |
| ledger | Phase 5 same-page bank/return ledger / 360px family 40000/60000 → 30000+70000 → reject → partial return, both entry points agree | R / R / R / R |
| ledger | Phase 5 same-page bank/return ledger / 390px family 40000/60000 → 30000+70000 → reject → partial return, both entry points agree | R / R / R / R |
| ledger | Phase 5 same-page bank/return ledger / 1280px family 40000/60000 → 30000+70000 → reject → partial return, both entry points agree | R / R / R / R |
| ledger | Phase 5 same-page bank/return ledger / lost save response freezes the original transaction; lookup recovers without duplicate execution | R / R / R / R |
| ledger | Phase 5 same-page bank/return ledger / save followed by failed authoritative read hides balances and blocks stale confirmation until lookup succeeds | R / R / R / R |
| ledger | Phase 5 MANAGER financial denial / family and whole-return HTML/RSC disclose no ledger or family marker | R / R / R / R |
| ledger | Phase 5 TEACHER financial denial / family and whole-return HTML/RSC disclose no ledger or family marker | R / R / R / R |

## Gate C: final coverage and added scenarios

Final discovery succeeds with **68 scenarios/project, 272 executions, 8 specs**.
This is separate from the original Gate A baseline of 61/project and 244.

| Final spec | Total/project | Runnable with supported cookie | Unconditional BLOCKED | Additional BLOCKED after false cookie probe |
| --- | ---: | ---: | ---: | ---: |
| class-links | 5 | 5 | 0 | 0 |
| completion | 13 | 13 | 0 | 1 |
| confirmation | 7 | 7 | 0 | 0 |
| family-detail | 11 | 10 | 1 | 0 |
| family-list | 10 | 8 | 2 | 0 |
| full-journey | 1 | 1 | 0 | 1 |
| guardian | 13 | 13 | 0 | 0 |
| ledger | 8 | 8 | 0 | 0 |
| **Total/project** | **68** | **65** | **3** | **2 if measured unsupported** |

Thus CI has 260 runnable and 12 unconditional BLOCKED executions before the
engine probe. For `n` projects with an actually measured unsupported cookie policy,
the classification becomes `260 - 2n` runnable and `12 + 2n` BLOCKED. This document
does not claim a browser or PostgreSQL pass; CI supplies those results.

Seven scenarios were added (all run in each project unless explicitly conditional):

1. full-journey: `real ADMIN login → class creation/prices → issued link → two children → bank record → selected reservation only`.
2. completion: `expired companion capability exposes no issuer family or input form`.
3. confirmation: `explicit existing Child choice creates one reservation without creating or rewriting a Child` (also performs a nonzero real refund and revenue attribution verification).
4. confirmation: `another family's Child is absent from choices and a forged UI submission is rejected atomically`.
5. guardian: `expired authentic price proof preserves both drafts and consents until explicit fresh review`.
6. guardian: `response lost after server commit never creates a duplicate application`.
7. ledger: `guardian cancellation reserves return money; confirmation cannot spend it and a partial return never increases available amount`.

| Requested Gate C behavior | Actual scenario evidence |
| --- | --- |
| Price change requires explicit review; second change writes zero rows | guardian / `100000 to 105000 review, second submit-time change, input/consent preservation and explicit resubmission`; mutations now use real ADMIN UI in a separate context. |
| Expired price proof preserves input and consent | New guardian / `expired authentic price proof preserves both drafts and consents until explicit fresh review`; authentic proof ages through expiry, no proof forging. |
| Lost submission response cannot duplicate application | New guardian / `response lost after server commit never creates a duplicate application`; real action executes before response abort; existing transport-loss case also remains. |
| Middle child removal preserves other drafts | guardian / `middle removal preserves stable fields and optional choices; common consent is reviewed again`. |
| Explicit existing-Child linking | New confirmation / `explicit existing Child choice creates one reservation without creating or rewriting a Child`; DB Child snapshot unchanged. |
| Another family's Child access denied | New confirmation adversarial UI-triggered action rejects a foreign Child atomically; guardian device-owned Child scenario denies another device/family's repeat selection. |
| Duplicate actual deposit record clicks | Full journey records one real admin deposit while clicking twice, then asserts exactly one ApplicationDeposit/idempotency mapping. Notification-only completion scenarios assert zero financial effects. |
| Return versus confirmation available amounts | ledger width cases reject and partially return; new cancellation case verifies A=0 while R=60000 blocks confirmation, a further actual deposit permits only the selected child, and returning money never increases A. |
| Explicit overbooking re-confirmation | confirmation / `overbooking has one primary action and selection changes discard its approval`; now also explicitly reconfirms through UI and asserts capacity+1 only after approval. |
| Revoked link / expired capability | class-links scoped stop/reissue; guardian / `revocation hides all prices and clears the active form; BFCache does not revive PII`; completion expired-family and new expired-companion capability scenarios. |
| MANAGER / TEACHER direct URL denial | Separate role scenarios in class-links, family-list, family-detail and ledger, using actual policy-compliant authenticated accounts, including HTML/RSC non-disclosure assertions. |
| Legacy Phase 18 path | guardian `legacy` and `upgrade` three-step cases; completion legacy guidance and class-links legacy-copy metadata scenario. |
| Friend-invite family isolation | guardian / `device-owned existing Child stays read-only and friend invitation never grants issuer family data`, plus completion invitation creation/cancellation/expiry. |
| Back, refresh and BFCache do not restore PII | completion / `successful submission replaces the document; reload and back do not restore inputs or resubmit` uses the actual three-step flow; guardian revocation and no-browser-storage assertions remain. |

`support/integrated-ux-invariants.ts` reads actual disposable PostgreSQL rows
independently of UI summaries. It checks one Payment mapping per reservation,
PaymentItem amount/discount/paid consistency, allocation destinations, actual return
totals and **D = A + P + R + T**. The journey verifies no Reservation/Payment from
application or notification, actual admin-only deposit, immutable quoted amounts,
selected-only Reservation/Payment/PaymentItem/mapping and unchanged sibling.
The new existing-Child confirmation scenario submits a real 10000 partial refund
after a 40000 payment; it verifies PaymentItem/refund totals, unchanged application
allocation and paidAt, and separate payment-date, refund-date and class-date revenue
attribution in the real revenue UI. No refund policy or revenue rule is changed.

## Local verification / handoff

- `npx tsc --noEmit`: PASS.
- `npm run lint`: PASS, zero errors; one existing unused `_body` warning in `tests/unit/ai-service/selection-safety.test.ts`.
- `npm test`: PASS, 200 files and 2449 tests, including 11 new focused manifest/privacy/reporter safety tests.
- `npm run build`: PASS; no `next dev` process existed before the build; compiled, typechecked and generated all 19 static pages.
- Safe-environment `npx playwright test --config playwright.ux.config.ts --list`: PASS, 272 tests in 8 files. The first attempt without DB env was safely rejected before loading specs; listing with dedicated loopback URL metadata succeeds without connecting to PostgreSQL.
- Browser/database execution remains unperformed here because the sandbox cannot run PostgreSQL/container services. The orchestrator will push and dispatch the new CI workflow.
- No commits, pushes, deployments, remote DB access, migrations/schema edits or Production Schema Gate changes were performed by this build-out.
