# Last run: Phase 20 SHIP candidate and Preview verification

Recorded: 2026-10-08 (Asia/Seoul)

## Phase 20 candidate status

- Candidate commit: `5477377113d6f643d83636edaf4af462b7267f2f` on `feature/phase20-reservation-application-enhancements`; PR [#49](https://github.com/gulatnaru/yaho-management/pull/49) targets `main`.
- The branch base was checked against `origin/main` before commit and had no drift. Only Phase 20 source, tests, schema, and release documents were committed; protected `.gitignore` remains unstaged.
- The Git-integrated Preview deployment for the exact candidate SHA reached `READY`. Local Preview E2E pointers were updated only for the exact deployment origin, allowlist, and SHA; all other protected local environment entries were preserved.
- Preview migration preflight rejected Production references before opening a database client, verified the Preview runtime fingerprint and the existing `12/12` migration checksums, then applied only `20261006090000_phase20_reservation_application_enhancements`. Post-deploy Preview migration inventory and checksums are `13/13`.
- PR CI `quality` and `detect-schema-change` succeeded for the exact candidate SHA. Production Schema Gate run `37601374107` is waiting at `production-migrate` for the GitHub `production` Environment human approval. No Production database access, migration, merge, or bypass occurred.

## Actual guarded Preview E2E

- The guarded `npm run test:e2e:preview` observer completed once against the exact READY candidate: exit `1`, `10` passed, `8` failed, with no Preview safety guard code.
- Its post-run cleanup proof is clean: synthetic marker count `0`, lease count `0`, proof directory count `0`, and advisory lock released. A later safe Preview query again found marker count `0`, lease count `0`, and `13` applied migrations.
- The failed assertions are isolated for BUILD follow-up at `tests/e2e/auth.spec.ts:13`, `tests/e2e/phase20-application-finance-returns.spec.ts:69`, `tests/e2e/phase20-application-group-siblings.spec.ts:53` and `:63`, `tests/e2e/phase20-companion-repeat-privacy.spec.ts:72`, `:83`, and `:94`, and `tests/e2e/phase20-postgres-races.spec.ts:38`. Raw browser output, URLs, tokens, database identities, and fixture values were not recorded.
- Release status: **blocked for BUILD_FIX and a fresh guarded Preview E2E pass**. Production human approval remains pending and is not an authorization to merge.

---

## Authoritative Phase 20 BUILD diagnostic-fix checkpoint (2026-10-08)

- The first guarded exact-head diagnostic was authorized once at commit `5477377113d6f643d83636edaf4af462b7267f2f`. Its wrapper observer did not retain a terminal summary or artifacts after the tooling session yielded; therefore it is **INCONCLUSIVE**, is neither a Preview E2E PASS nor a failure classification, and will not be repeated on that unchanged head. No surviving runner process was found afterward. The prior actual Preview result remains `10` passed / `8` failed with exit `1`.
- `tests/e2e/phase20-application-group-siblings.spec.ts` and `tests/e2e/phase20-companion-repeat-privacy.spec.ts` now assert the exported `APPLICATION_CLOSED_MESSAGE` through the stable `application-closed` test id. This covers all six Phase 20 closed-capability branches, including the companion invitation's expired and revoked cases, without relaxing the closed-link checks.
- The next candidate classifies a public completion failure without outputting page HTML, form data, URLs, tokens, or raw errors: `P20_PUBLIC_COMPLETION_ROUTE_5XX`, `P20_PUBLIC_COMPLETION_STRICT_LOCATOR`, `P20_PUBLIC_COMPLETION_ACTION_ALERT`, or `P20_PUBLIC_COMPLETION_TIMEOUT`. This diagnostic is present in the finance, group, and companion positive flows, and its action-alert check is scoped to the clicked submit button's enclosing form so an unrelated route announcer cannot produce a false classification. It does not claim that the underlying public submission cause is known.
- The guarded PostgreSQL first-confirm race still requires exactly one fulfilled contender and the existing Payment/count/conservation assertions. If that cardinality fails, it now emits only fixed business classes or an allowlisted Prisma code (connection, timeout, schema, constraint, query, pool, or serialization); it never emits a raw error, metadata, SQL, or fixture data. The written matrix remains `12` cases / `10` transaction barriers; the prior live suite stopped at its first case, so this is not recorded as `12` passed.
- Invalid-login smoke preserves its expected credential marker and rejects every 5xx. A missing credential alert now has only fixed safe outcomes for submit 5xx, exposed infrastructure, unexpected authentication, locator ambiguity, or missing expected credential rejection. `CallbackRouteError` and database/auth failures remain fail-closed; no catch-all maps them to invalid credentials.
- Local verification after these diagnostic changes: focused race-barrier and production-smoke tests `2` files / `34` tests PASS; full `npm test` exit `0` (`108` files / `941` tests); `npm run lint`, `npx tsc --noEmit`, and `git diff --check` PASS. Prisma schema is unchanged. A process-only precheck found no `next dev` or active build; the retained-session final retry of `npm run build` completed with exit `0` after route generation. The inconclusive diagnostic cannot prove whether it reached a fixture write, so it is not used as database-write evidence; it left no retained artifact, runner process, or classification. No migration, deployment, commit, push, PR, CI, Production access, approval, or shutdown occurred.
- Fresh independent QA and Review are required before a new exact-head candidate is committed and a guarded Preview rerun is considered. Production Schema Gate run `37601374107` remains waiting for human approval and must not be auto-approved.

---

Latest checkpoint: 2026-10-07 (Asia/Seoul). The earlier three-attempt Phase 20 BUILD stop record is retained below as history; the user explicitly authorized a continuation and implementation is active. Phase 19 is released; Phase 20 is unfinished. Windows shutdown is not scheduled.

## Authoritative Phase 20 review-rework checkpoint (2026-10-07)

- Independent Review returned **CHANGES_REQUIRED** with `2` Major and `1` Minor finding. BUILD_FIX rework `1/3` fixed all three: MANAGER class updates omit `applicationPrice` entirely, companion issuance locks Submission → applications → Group → Class then re-reads its issuer, and ADMIN-only duplicate detection falls back to the nonpurged parent submission guardian phone while retaining legacy application phones.
- Regression coverage proves an ADMIN price commit survives a concurrent MANAGER operational update, ADMIN set/clear and MANAGER supplied-price rejection; companion closed/purged issuer rejection before capability writes and lock ordering; and list plus detail duplicate flags for Phase 20 parent facts and legacy facts, excluding different guardians/classes and purged parents.
- Added one guarded Preview-safe PostgreSQL barrier: closing the final pending issuer versus companion issuance. The matrix now contains `12` written cases and `10` actual transaction-barrier scenarios. It remains **NOT RUN** against Preview/PostgreSQL because the Phase 20 migration is uncommitted and unapplied.
- Final local gates passed: focused review suite `3` files / `45` tests; full `npm test` exit `0` (`108` files / `941` tests); `npm run lint`, `npx tsc --noEmit`, and `git diff --check` exit `0`. The schema is unchanged, so the prior in-process Prisma validate/generate result remains applicable. A port-independent check found `0` `next dev` processes; final `npm run build` exited `0` and all build workers ended.
- No database, network, Preview, platform, migration, deployment, commit, push, PR, or browser execution occurred. Fresh independent re-QA and re-Review are pending before SHIP. Windows shutdown is not scheduled.

## Authoritative Phase 20 BUILD gate checkpoint (2026-10-07)

- Phase 20 implementation and its guarded browser candidates are written. Local final gates passed: `npm test` exit `0` (`107` files, `933` tests), `npm run lint` exit `0`, `npx tsc --noEmit` exit `0`, and `git diff --check` exit `0`. Prisma validation and Client generation each exited `0` after Next loaded the existing environment only in process memory.
- A port-independent process inspection found `0` `next dev` processes before the build. The final `npm run build` completed with exit `0`; its compiler and type/lint stages completed successfully, and the temporary completion marker confirmed the exit after all build workers ended. The sandbox-only first attempt failed with `spawn EPERM`; the authorized local retry is the recorded result.
- The local Playwright safety discovery now excludes only the Preview-proof-required PostgreSQL race spec. Its direct guard remains fail-closed. The focused safety test passed (`1` file, `3` tests), and the focused race-barrier unit suite passed (`1` file, `8` tests).
- The PostgreSQL matrix contains `11` written cases, including `9` actual transaction-barrier scenarios. It is **NOT RUN** against Preview or PostgreSQL: the Phase 20 migration is still uncommitted and unapplied. No database, network, Preview, platform, migration, deployment, commit, push, PR, or browser execution occurred in this checkpoint.
- Preview execution, migration application, platform checks, independent QA, independent Review, and SHIP remain pending. Protected user paths, including `.gitignore`, `.env.local`, `.codex`, paseo, and skill paths, were preserved. Windows shutdown is not scheduled.

## Phase 20 E/F/G/H guarded privacy browser coverage written (not executed)

- Added a guarded, run-owned privacy candidate that covers independent companion consent and no-relationship behavior, same-device confirmed-child repeat with fresh consent and opaque hash rotation, and empty responses for old, wrong, revoked, expired, or independently scoped device capabilities.
- It registers the owned child before an internal child-only retention purge, ages only the fixture's confirmed histories, then proves a preselected stale repeat cannot reactivate or reserve the purged child.
- The group form restores the existing optional Phase 18 request note per child, with the existing 1,000-character limit and health-information guidance. It adds no new collection policy.
- Local verification passed: focused device/group/completion units (`4` files, `16` tests), TypeScript, ESLint, and `git diff --check`.
- Browser execution remains pending the required exact-head commit, deployed Preview migration, signed lease, and wrapper preflight. No database, deployment, or browser run occurred in this checkpoint.

## Phase 20 A/B guarded browser coverage written (not executed)

- Replaced the group-sibling direct core fixture with the actual ADMIN group create, membership edit, stop, and reissue UI path.
- The guarded Preview-only flow tags a group only after exact actor and owned-class proof. Its `finally` recovery also handles a create write that succeeds before the UI reports success.
- It exercises stale-class server rejection with no partial application, then two sibling quotes (10,000 + 12,000), an actual 22,000 deposit, and ADMIN bulk confirmation with two reservations mapped to one two-item Payment.
- Local verification passed: the focused completion/group unit set (`3` files, `13` tests), TypeScript, ESLint, and `git diff --check`.
- Browser execution remains pending the required exact-head commit, deployed Preview migration, signed lease, and wrapper preflight. No database, deployment, or browser run occurred in this checkpoint.

## Phase 20 PostgreSQL race checkpoint

- Wrote bounded real-transaction coverage for device revocation versus verified repeat-child submission, Child identity edit versus existing-child confirmation, and scoped retention purge versus requested-child confirmation. The barrier captures each backend PID inside its own interactive transaction and observes only B's PostgreSQL lock wait before releasing A. It accepts `Prisma.Sql` lock statements by reading SQL string fragments only.
- These tests are written only. Preview/PostgreSQL execution did not run because the Phase 20 migration remains uncommitted and unapplied. No database, network, migration, deployment, commit, push or PR action occurred.
- TypeScript, ESLint and `git diff --check` passed. Focused barrier unit tests passed (`1` file, `8` tests) after the local esbuild spawn received sandbox approval.

## Phase 20 source-fix checkpoint: completion capability and group editor

- Follow-up regression repair: valid non-Preview Phase 20 completion capabilities now use the complete DB settings singleton for their own quoted transfer guide. A page-level server-rendered test covers that guide, missing DB settings fail-closed, Production synthetic denial, unleased Preview denial and terminal empty-guide denial.
- Active BUILD continuation, local-only. This checkpoint fixes the Phase 20 completion page so Production never renders synthetic completion details, Preview renders neither synthetic details nor bank fallback without the signed active lease, and an empty or terminal Phase 20 completion has no active guide controls. Ordinary non-Preview Phase 18 visits without a completion capability retain generic DB-authoritative bank guidance, or legacy environment guidance only when no DB settings row exists.
- ADMIN group create/detail timestamps now use the common KST formatter. The group editor includes every currently selected membership even when it falls outside the first 100 current candidates or is now past/ineligible. It remains selected until the ADMIN explicitly unchecks it; server validation allows only that existing membership preservation and continues to reject a newly added ineligible class.
- Focused unit tests passed: `3` files / `13` tests. TypeScript, full lint and `git diff --check` passed after the regression repair. No browser, Preview, PostgreSQL, migration, deployment, commit, push, PR, CI, QA, Review or SHIP action has run. Positive browser scenarios remain the next bounded BUILD package.

## Phase 20 finance/admin continuation checkpoint (2026-10-07)

- Active BUILD added parent-submission finance guards: the legacy single-application deposit/confirm path rejects `submissionId` applications, while their detail page reads the parent guardian and links to the family finance screen. Child-level reject/cancel remains independent.
- Actual deposits and returns use KST `datetime-local` validation, their technical nullable unique idempotency keys, and distinct business event versus processing timestamps. A repeat completed return finds its matching key before the remaining-balance check; a foreign-obligation key, over-return, invalid past-date input, unfunded obligation and out-of-range amount fail closed. Return execution checks that allocations for the exact obligation equal its required amount.
- The family ADMIN screen shows declared and actual payer, class date, deposit/confirmation date and actor, and return/processing date, reason and actor in KST. Bulk confirmation defaults only a capability-requested exact child candidate; ambiguous candidates require an operator choice. A bare overbooking flag cannot authorize an overbook: each previously shown warning carries an application ID, locked class ID, stable `NEW` or existing-child choice, and selected-set fingerprint. The core recomputes and compares every value after its locks, so a missing, altered or selection-stale binding produces a fresh warning. Multiple valid bindings remain only while the selection stays unchanged.
- Local gates at this checkpoint: focused Vitest finance/ledger/admin-authority/legacy-confirm suites passed (`38` tests), with an additional focused server binding and KST calendar/integer-bound set passing (`28` tests); final TypeScript and ESLint passed; Prisma schema validation and Client generation passed using `.env.local` only in process memory; and the complete local Vitest suite passed (`105` files, `918` tests). No PostgreSQL integration, Preview/browser execution, database access, migration application, commit, push, PR or deployment was performed. Production build is intentionally deferred to the later package gate.

# Phase 19 Preview E2E release report

Recorded: 2026-10-04 (Asia/Seoul)

## Final release state

- **State:** complete and released.
- **Phase 19 PR:** [#47](https://github.com/gulatnaru/yaho-management/pull/47), merged at `c7d9bcb8a10a3722328b1f5dc60dae6b1b293b23`.
- **Cleanup recovery commit:** `ebd00451431e8d589b8d1626eb140f1454a05529`.
- **Metrics PR:** [#48](https://github.com/gulatnaru/yaho-management/pull/48), merged at `98b2c175d22295a705ef36b5b0c0a437de92b5cf`.
- **Current main:** `98b2c175d22295a705ef36b5b0c0a437de92b5cf`.
- **QA and review:** independent QA PASS and review PASS with no remaining findings.

## Verification

- Full suite: PASS (`868` tests).
- Focused cleanup coverage: PASS (`9` tests).
- Lint, TypeScript check, and build: PASS. No local Next.js development process was running for the build.
- Diff check: PASS.
- Exact-head PR #47 CI: `quality` PASS, `detect-schema-change` PASS, `production-migrate` SKIPPED, and `production-schema-gate` PASS.
- PR #47 made no `prisma/schema.prisma` or `prisma/migrations/**` change. Production migration was therefore correctly skipped.

## Live Preview E2E

- The final guarded command `npm run test:e2e:preview` completed with exit code `0`, `8` passed, and `0` failed.
- The Preview advisory lock was released, synthetic marker count was `0` after the run, and generated Playwright artifacts were safely cleaned up.
- The runner accepted only the approved Preview project and origin, checked the exact deployed commit and runtime identity, and ran with local protected values that were never output or committed.
- Preview migration status was verified as `12/12` repository migrations applied, with no missing, incomplete, unexpected, or checksum-mismatched migration.

### Preview migration inventory

The manually approved Preview migration procedure applied the six previously pending migrations:

- `20260913170000_phase16_account_access_management`
- `20260929073840_phase18_reservation_applications`
- `20260929150958_phase18_application_consent_retention`
- `20260929155124_phase18_refund_terms_acknowledgement`
- `20260929162100_phase18_child_personal_data_purge`
- `20260930043249_phase18_application_resolution_note_purge`

The remaining repository migrations were already applied, producing the final `12/12` state. No reset, `db push`, resolve, seed, data mapping, or unscoped deletion was used.

## Cleanup recovery

- Preview cleanup now runs its existing FK-safe, run-scoped cleanup transaction with a 10-second acquisition wait and a 60-second transaction timeout. The outer advisory-lock lifetime remains 15 minutes.
- Cleanup failure output uses a fixed safe enum and synthetic run ID; it never includes raw Prisma diagnostics, credentials, URLs, or fixture data.
- A targeted cleanup timing diagnosis on a confirmed empty run completed in 4665 ms, near Prisma's former default interactive-transaction timeout. The recovery change was independently tested, QAed, and reviewed before the final live gate.
- An observer parser originally omitted numeric characters from diagnostic-code matching. A corrected synthetic parser check passed. The authoritative final E2E outcome remains the wrapper's exit code `0` and its `8/0` test total.

## Production release verification

- The Phase 19 application deployment `dpl_DF427RSQ2gdYw7PfCSbFgsTdwRar` reached READY for PR #47's exact merge commit. Its read-only `/login` smoke returned HTTP `200`.
- The current Production deployment is `dpl_GWJ4QiK74fTaXrcsqCTPQrYounRQ`, READY for current main `98b2c175d22295a705ef36b5b0c0a437de92b5cf`; Vercel reports that it owns the Production alias.
- No Production database connection, query, migration, or mutation was performed by this release workflow.

## Historical resolution summary

- Vercel protection bypass, Preview database migration state, browser runtime availability, and Preview administrator credentials initially blocked the manual gate. Each was corrected through approved Preview-only configuration or operator steps.
- A post-test cleanup path then exceeded the default Prisma transaction budget. The recovery commit introduced the bounded cleanup budget and safe fixed-code reporting.
- Earlier failed or inconclusive manual attempts are resolved history. The final exact-head live Preview E2E passed and release gates were completed.

## Metrics ledger

- QA rejections: `3`; review rejections: `3`; QA and review rework total: `6`.
- Findings: Critical `1`, Major `11` events (`10` distinct, because the Production fingerprint finding repeated), Minor `3`.
- CI failures: `0`.
- One additional live-E2E recovery build was performed after the test gate; it is distinct from QA and review rework.
- The append-only metrics row was merged via PR #48 with cause `VALIDATION`.

## Working tree and next work

- Local `main` is synchronized to the final metrics merge. The two Phase 19 local feature branches were safely deleted after merge.
- The user-owned `.gitignore` modification and this local report remain unstaged and uncommitted. Secret and environment files remain uncommitted.
- Phase 20 work continues on `feature/phase20-reservation-application-enhancements` from base `98b2c175d22295a705ef36b5b0c0a437de92b5cf`. Do not shut down the machine.

## Phase 20 current checkpoint

- **Current stage:** `$yaho-build` implementation, same-role continuation **attempt 3 of 3** on `feature/phase20-reservation-application-enhancements`; attempt 1 ended before the full approved scope and attempt 2 ended at an external usage-window limit, without an implementation finding. QA rework `0`, review rework `0`, total rework `0`, implementation-CI rework `0`, and CI failures `0`. QA, review, SHIP commands, and live Preview execution have **not** run. The accepted plan is preserved in `docs/PHASE20_PLAN.md`.
- **Current implementation checkpoint:** additive schema/migration, group/settings foundations, private completion, device repeat scope, companion scoped application/invitation issue/revoke flow, and separate pre-reservation ledger cores are in BUILD. ADMIN submission finance detail shows quoted child totals, verified deposits, allocations and the return queue. Actual deposits support explicit idempotency keys; terminal child funds are held FIFO before excess; partial returns retain history and cannot exceed their obligation. Selected confirmation/bulk confirmation UI, guarded Preview lease and additional service/race coverage remain in active implementation.
- **Current local verification:** Prisma Client generation and Prisma schema validation passed using the existing Next environment loaded only in process memory; no value was printed. `tsc --noEmit`, `npm run lint`, full `npm test` (99 files, 875 tests), and `npm run build` passed. The build was preceded by an elevated process-only check that found no `next dev` process. No Phase 20 E2E result is claimed at this checkpoint.
- Confirmed scope is consolidated in `REQUIREMENTS.md` Phase 20: multi-schedule application groups, multi-child atomic submission with child-level applications, separate friend-family invitation and consent, bank-transfer-only completion guidance and notification, pre-reservation deposit/return tracking, ADMIN settings, same-device repeat application, privacy/authorization/concurrency rules, and guarded Preview E2E candidates.
- Existing Phase 18 links and data must remain compatible. Unpriced legacy links keep their existing Phase 18 behavior until ADMIN explicitly sets the real class price and upgrades them; they are not assigned `Program.defaultPrice` or automatically closed. Existing reservation, attendance, Payment, Refund, Revenue, privacy retention/purge, and ADR-059 Preview safety rules remain in force except where Phase 20 explicitly extends intake.
- Price investigation found no prior authoritative final application amount: `Program.defaultPrice` is a base price, ClassSchedule has no price, and the post-reservation Payment form accepts an independent ADMIN-entered amount.
- On 2026-10-05 the user decided that ADMIN sets each class's final application amount and the submitted child amount is fixed at submission. `Program.defaultPrice` is not an automatic final amount or fallback.
- The user also decided to support cumulative partial and overpayments plus multiple partial pre-reservation returns. Net available funds below the charge block confirmation; sufficient funds allow it; excess and rejected/cancelled unreturned funds remain return-needed until the return balance reaches zero. Existing Payment maps only the fixed charge once, and excess or pre-reservation returns never enter Revenue.
- These decisions and the full Phase 20 intake, privacy, settings, repeat-device, compatibility, concurrency, and conditional Preview E2E policy are recorded in accepted ADR-060. Phase 20 Open Questions are `없음`; BUILD remains in progress.
- Phase 19 remains fully complete with the QA, review, Preview 8/8, migration 12/12, CI, merge, current Production READY verification, and no-direct-Production-DB facts recorded above.
- The machine has not been shut down.
- Windows shutdown is authorized only after every required gate and this report are complete; it is not scheduled and there is no pending approval. No commit, push, PR, CI, Preview/Production access, deployment, migration application, `db push`, reset, resolve, seed, or database write has been performed in Phase 20 BUILD.
- Attempt 3 verification checkpoint: offline Prisma datamodel diff against `HEAD:prisma/schema.prisma` found no missing Phase 20 tables or enums; the `tokenHash` uniqueness is represented by the matching named UNIQUE constraint. Prisma format/validate/generate, TypeScript, ESLint, and the full unit suite passed before the final Preview helper amendments (`103` files, `885` tests). A production build completed after a process-only check found no `next dev`; its safe output reached the final route table. Subsequent focused TypeScript and Preview lease/safety tests passed (`18` tests). Live Preview, PostgreSQL integration, and browser execution remain **NOT RUN** because this uncommitted migration must first reach an exact committed head and be manually applied to the approved Preview database.
- Remaining BUILD work: positive run-owned browser A–H fixture flows, fully scoped Phase 20 FK cleanup, and the complete guarded PostgreSQL race matrix still require implementation. These are not claimed as complete.
- Attempt 3 follow-up checkpoint: repeat-device responses now stay in a private no-store API and prefill only the exact DeviceSubmission guardian and granted active child fields; the public form renders the existing full Phase 18 consent text and requires fresh per-child consent. Retention now locks Submission → Application → Child, removes DeviceChild grants, and leaves a non-PII requested-child purge tombstone so a purged selected child cannot later be recreated through NEW confirmation. Group-scoped synthetic Preview settings avoid mutation of the shared settings singleton. A Phase 20 FK cleanup helper now removes group-rooted ledger, invitation, device, mapping and payment dependencies before the existing marker cleanup. Focused device, retention, Preview lease/cleanup, group, finance and schema tests passed (`50` tests); TypeScript and targeted ESLint passed. The full suite and production build need rerunning after these amendments. Live Preview, PostgreSQL integration and browser execution remain **NOT RUN**.
- Attempt 3 latest local checkpoint: the complete unit suite passed (`103` files, `886` tests), full ESLint and TypeScript checks passed, and Prisma validation passed through the existing Next environment loader in memory without printing values. Preview timing is finite and ordered: 22-minute browser global timeout, 24-minute signature/lease lifetime, and a 25-minute advisory-lock transaction for browser time plus two 60-second cleanup phases and startup margin. The guarded PostgreSQL race suite is allowlisted but has not been executed. The prior build process produced `.next/BUILD_ID` and exited; its terminal output was truncated before a route table, so this report does **not** record a new build PASS after the final timing/cleanup amendments. Live Preview, PostgreSQL integration and browser execution remain **NOT RUN**.

## Phase 20 final automatic-execution stop record

### State and reason

- **Overall:** BLOCKED. **Blocked stage:** BUILD. SPEC and PLAN are accepted; business Open Questions are empty.
- The third BUILD attempt ended with a partial final response that explicitly left positive finance, companion/repeat browser flows and the PostgreSQL race matrix incomplete. It did not satisfy the full BUILD completion contract. The `yaho-orchestrate` skill caps an agent invocation at three attempts, so no fourth automatic retry or next stage was started.
- Technical checkpoint ID: `P20-BUILD-INCOMPLETE-AGENT-OUTPUT`. This is an invocation/completion failure, not a formal QA or Review finding and not a GitHub CI failure.
- Agent attempts: **3/3**. QA rework: **0**. Review rework: **0**. Total QA/Review rework: **0**. CI implementation rework: **0**. GitHub CI failures: **0**. No repeated formal finding or unresolved formal QA/Review finding is recorded because neither independent validation stage has run.
- This report-only stop record was saved to fulfill the user's explicit final-result recording instruction. No feature source or test was changed after the BUILD agent ended.

### Implemented work, awaiting validation

- Additive application-group, multi-child submission, companion, device capability, quoted class price, pre-reservation deposit/return/allocation, settings and Preview lease schema/core/UI work.
- ADMIN selected sibling confirmation, exact quoted PaymentItem mapping, separate actual deposit and partial return workflows, and one-time legacy setting import.
- Existing consent wording/version in the new public form; private device-proven guardian/child prefill and fresh consent; requested-child purge tombstone and parent PII cleanup.
- In-app Preview project/runtime fingerprint, signed scope, active lease and read-only advisory-lock checks; group-owned synthetic settings; FK-ordered run-scoped cleanup. These additions still require independent QA/Review and actual Preview execution.
- Money mapping leaves actual bank `depositedAt` in the pre-reservation ledger and uses ADMIN final processing time for `Payment.paidAt`; existing Revenue filtering was not edited. This mapping still needs its final focused assertion and independent validation.
- Changed areas: `REQUIREMENTS.md`, `docs/DECISIONS.md` (ADR-060), `docs/PHASE20_PLAN.md`, `prisma/schema.prisma`, new migration, class pricing UI/actions/queries, reservation application ADMIN groups/settings/submissions/returns, public group/companion/completion, repeat API, reservation application server cores and retention, Preview runner/lease/cleanup/config, and related unit/E2E tests. The user-owned `.gitignore` change is preserved separately and unstaged.

### Migration

- New file: `prisma/migrations/20261006090000_phase20_reservation_application_enhancements/migration.sql`.
- Existing migration files are unchanged. No Phase 20 migration has been applied to Preview or Production.
- Production schema gate and mandatory human Environment approval remain required at a later SHIP stage; no approval is currently awaiting action because no Phase 20 PR exists.

### Verification

- Latest BUILD checkpoint: unit **103 files / 886 tests PASS**, full lint PASS, TypeScript PASS, Prisma validation PASS. Focused device/retention, lease/safety and cleanup tests passed as recorded above.
- Final build gate: **INCONCLUSIVE after the final amendments**; successful compilation/type checking or a BUILD_ID alone is not recorded as a verified complete build.
- Phase 20 live Preview E2E / actual PostgreSQL races: **NOT RUN**. The public group positive flow and one concurrent-confirm race have been written but are unexecuted; finance/companion/repeat positive scenarios and the complete race coverage remain unfinished. Negative boundary checks do not substitute for these scenarios.
- QA: **NOT RUN**. Review: **NOT RUN**. SHIP: **NOT STARTED**. Diff check was clean at the stop checkpoint.
- No Phase 20 DB write, migration application, deployment, commit, push, PR, CI, merge or release verification occurred. No secret/environment file was output or committed.

### Git and release state

- Branch: `feature/phase20-reservation-application-enhancements`.
- Current HEAD/base: `98b2c175d22295a705ef36b5b0c0a437de92b5cf` (Phase 19 metrics merge). There is no Phase 20 commit SHA.
- Working tree: Phase 20 tracked and new files are uncommitted and unstaged; `.env.local` remains ignored; user/protected paths are preserved.
- Phase 20 PR number/URL: none. CI: not started. Merge: not started. Deployment: not started. Phase 19 release facts remain unchanged above.

### Remaining blocking work and recovery

1. Finish the real positive finance, partial return, companion, same-device repeat and purged-child browser scenarios; finish the separate actual PostgreSQL race matrix, including group removal, device revoke, deposit/return/confirmation, purge and existing-payment races.
2. Verify interruption cleanup and foreign-data protection; finish the financial time-axis assertion; run final local gates after all remaining edits and obtain a conclusive build exit result.
3. Run fresh independent QA and Review, then SHIP under the existing gates, followed by exact-head guarded Preview E2E and migration/release procedures. Preserve this work and all counters when starting an explicitly authorized recovery; do not silently reset the exhausted invocation counter.
- No nonblocking follow-up is classified yet; the items above are required completion work.
- **Windows shutdown: NOT SCHEDULED and NOT EXECUTED**, because BUILD and required release gates remain incomplete.

## Phase 20 authorized continuation — ACTIVE

- The prior automatic three-attempt stop record above is retained as history. The user explicitly authorized a new BUILD continuation on 2026-10-06; it is active and does not alter the historical counters.
- PostgreSQL safety continuation: retention locks parent submissions with `EXISTS ... FOR UPDATE OF`, then Application rows, then Child rows, and accepts explicit internal scopes without widening an empty scope to the ADMIN-wide sweep. Selected existing children are re-read under lock during bulk confirmation; new-child identity creation is serialized by a non-logged transaction advisory hash. The Phase 20 cleanup first commits only marker-proven child IDs to the lease, then aborts before mutation when a foreign reservation, consent, safety record, device grant, companion member, requested-child application, payment item, or Refund reference is present. It deletes application rows before their RESTRICT `Reservation` rows and retains the lease after an interrupted cleanup. The migration adds explicit legacy-upgrade provenance and preserves historical legacy confirmation while requiring every new submission to have a positive quote and null duplicated guardian/legacy-deposit fields.
- Current focused verification: Prisma client generation and `npx tsc --noEmit` passed. Five focused unit files passed (`49` tests): retention, finance returns, legacy link upgrade, Phase 20 lease and schema migration checks. Prisma format could not run in the sandbox because its schema engine download was refused; generation succeeded after the approved engine download. Live PostgreSQL, migration application, guarded Preview/browser E2E, full test/lint/build, QA, Review and SHIP remain **NOT RUN**.
- This continuation completed the finance/return browser-spec implementation in `tests/e2e/phase20-application-finance-returns.spec.ts`. Its run-owned fixture uses only `E2E_P11_${runId}_` records, group-scoped synthetic settings, the existing signed Preview lease, and the shared Phase 20 FK-ordered cleanup path. New Preview run IDs use `preview-` plus base64url encoding of a full 128-bit UUID, so the synthetic marker plus short child suffix remains within the public 50-character input limit; historical cleanup IDs remain accepted. The unexecuted spec covers public atomic two-child submit, exact private completion amount/bank/payer and actual clipboard values, idempotent deposit notification and bank-record key, ADMIN actual deposit, selected confirmation, exact one-item Payment mapping, rejected-child/excess return obligations, multiple partial actual returns scoped by owned obligation ID, completed return-history visibility on the owned submission, and no `Refund` record. It never selects or empties a shared return queue.
- A first-submit repeat-device defect was fixed: the private no-store endpoint now always returns `{ guardian, children }`, including a fail-closed empty DTO, so a missing/invalid device cookie cannot crash the public form. Deposit notification now requires at least one quoted `SUBMITTED` application; an eligible repeat succeeds without updating its timestamp, while terminal, purged, expired, and unknown capabilities remain denied. The ADMIN submission page renders the notification state, and public group/companion schedule labels use the existing KST formatter.
- Focused unit tests passed: `6` files / `34` tests (Preview safety/cleanup/lease, device DTO, completion notification, finance return). TypeScript, full ESLint, and diff check passed. The attempted local Playwright listing was refused by the existing local-origin guard because the configured base URL was not `http://127.0.0.1:3000`; no browser, Preview, DB, migration, or deployment was started. Live Preview and PostgreSQL race execution remain **NOT RUN** because the Phase 20 migration and source are still uncommitted and must satisfy the exact-head Preview gate first.
- Remaining BUILD packages are companion/repeat positive browser coverage and the complete guarded PostgreSQL race matrix. Final full unit/build gates, independent QA, review, SHIP, and Preview execution remain pending.

### Continuation checkpoint: group, companion and repeat capability hardening

- Group edits now take the group and sorted class locks, validate the exact future scheduled positive-price membership again, and affect future submissions only. Explicit group reissue and stop invalidate all active group URLs. Public submit rechecks the group/link-or-invite scope, current membership and current class price/state after the matching lock order.
- Same-device repeat scope now requires the latest non-purged device submission guardian to match the current Child guardian. Requested existing Child fields are re-read under the Device then sorted Child lock and must match the authoritative identity and guardian. A successful same-guardian resubmit rotates the opaque hash on the same Device row, preserving later grants; a different guardian receives a separate Device row with no copied grants.
- Companion issue/revoke is transaction-scoped and verifies a non-purged issuer with a pending application, an active eligible group and current classes. Completion notification/invite mutations check the signed active Preview lease. The legacy public link route now uses the DB settings singleton when present and only falls back to legacy environment settings while the row is absent.
- Added ADMIN group membership editing and stop/reissue controls, focused unit coverage for group URL lifecycle and guardian-change repeat denial, and guarded browser coverage for independent companion consent, friend privacy, same-device repeat, fresh consent and revoked invitation. Browser execution is still **NOT RUN** pending the exact-head committed Preview migration gate.
- Focused unit tests passed: `3` files / `9` tests. TypeScript and lint passed; `git diff --check` passed. Full suite/build, PostgreSQL race matrix, scoped purge helper coverage and finance history display remain pending BUILD work.

### Continuation checkpoint: legacy URL upgrade and public scope

- ADMIN can explicitly convert a priced, eligible legacy class link to a one-class group in one transaction after the database settings singleton is valid. The stored raw token becomes a hash in the same link row, so the guardian keeps the original `/apply/[token]` URL. The old class-link upsert rejects an already upgraded class; no price backfill, automatic conversion or token regeneration occurs.
- The legacy public route recognizes the upgraded hash and renders the group form at that original URL. Group and companion public queries now require a future scheduled positive-price class in the database query, require ready consent content, and reject synthetic groups in Production. Public class DTOs still exclude price.
- Group stop can be explicitly resumed only by issuing a new group URL after eligibility checks; existing URLs remain invalid. Public form labels now have unique input associations for guardian and child fields. Guarded companion browser fixtures inherit the project headers in isolated contexts and assert independent submissions/consents with no Relationship creation.
- Focused legacy/group/device/completion tests passed: `4` files / `17` tests. TypeScript, lint and `git diff --check` passed. Browser and Preview execution remain **NOT RUN** pending the exact committed head and Preview migration gate.

### Continuation checkpoint: scoped cleanup negative and recovery coverage

- Phase 20 cleanup now treats a recovery run with no remaining group as fail-closed when the lease-proven anonymous Child still has a `ReservationApplication` (including `requestedChildId`) or `ChildSafetyInfo` reference. After a successful group-rooted cleanup has removed every checked dependency, it deletes only the inactive, purged, lease-proven anonymous Child; marker-named Children remain for the existing historical marker cleanup path.
- `tests/unit/e2e/phase20-cleanup.test.ts` now uses synthetic in-memory Prisma delegates and records every `deleteMany`. The 12 passing cases cover the runtime/lease registration guard; recovery-tombstone proof; foreign PaymentItem, Reservation, ReservationApplication and Refund denial; DeviceChild, companion member, Relationship, consent, safety and requested-child denial; no delete before rejection; committed proof surviving a later failed destructive transaction and recovery retry; recovery-only foreign-reference denial; and application deletion before its RESTRICT Reservation.
- Local-only verification for this checkpoint: focused Vitest `1` file / `12` tests PASS; `npx tsc --noEmit` PASS; `npm run lint` PASS; `git diff --check` PASS. Full unit suite and production build were intentionally not run in this scoped continuation. No browser, Preview, PostgreSQL, migration, deployment, commit, push, PR, CI, or live data operation was run.

### Continuation checkpoint: PostgreSQL race-barrier safety helper

- `tests/e2e/support/phase20-race-barrier.ts` now owns the guarded PostgreSQL race synchronization used by the existing Phase 20 race cases. It starts its eight-second deadline before A, obtains each PostgreSQL backend PID inside that transaction, pauses A only after its selected row/advisory lock query has completed, begins B, and observes only B's `pg_stat_activity` lock wait. Each invocation has a closure-local A release gate; every barrier failure releases A and awaits the started transactions before returning a fixed safe error code.
- Added seven synthetic unit tests for successful observation, A rejection before lock, no selected lock, B PID failure, missing expected wait timeout, observer failure cleanup, and state isolation across consecutive races. The existing E2E `race(...)` call shape and the 10-second acquisition / 20-second transaction budgets remain in place.
- Local-only verification: focused Vitest `1` file / `7` tests **PASS**; `npx tsc --noEmit` **PASS**; `npm run lint` **PASS**; `git diff --check` **PASS**. The actual guarded PostgreSQL suite, browser/Preview execution, device/edit/purge coverage, full unit suite, production build, migration application, QA, Review, SHIP and all remote operations remain unfinished or **NOT RUN**.

### Continuation checkpoint: race diagnostic review fix (2026-10-08)

- The active BUILD_FIX resolves `P20-REVIEW-RACE-DIAGNOSTIC-PRISMA-INCOMPLETE`. Race diagnostic output now classifies interactive transaction `P2028`, Prisma unknown requests, and `P2010` raw-query SQLSTATEs using only a fixed allowlist. The SQLSTATE lookup is a `Map`, so untrusted metadata values such as `toString` and `__proto__` cannot resolve inherited object properties. The diagnostic never returns raw messages, metadata, SQL, URLs, credentials, or fixture data.
- Added three focused diagnostic unit tests covering `P2028` and unknown-request classification, allowlisted versus unallowlisted `P2010` SQLSTATEs, and inherited-property-shaped untrusted metadata. The review-required exactly-one-fulfilled race assertion and existing financial count/conservation assertions remain in place.
- Final local gates are conclusive: focused diagnostic test **1 file / 3 tests PASS**; full `npm test` **109 files / 944 tests PASS**; `npx tsc --noEmit` **PASS**; `npm run lint` **PASS**; `git diff --check` **PASS**. A process-only precheck found no `next dev`; the final `npm run build` completed with exit **0**.
- Prisma schema/migrations are unchanged. Prisma validation passed with exit **0** after Next's `.env.local` loader supplied values only to the validation child process in memory; its stdout/stderr was retained only in memory and the recorded result contains no environment values, connection strings, or CLI details. No migration, database, browser, Preview, Production, deployment, commit, push, PR, CI, merge, approval, or shutdown action occurred.
- The candidate remains at existing uncommitted HEAD `5477377113d6f643d83636edaf4af462b7267f2f`; no new commit was created. The user-owned `.gitignore` change remains untouched and unstaged. Explicit continuation counters are preserved: QA rework **2/3**, Review rework **2/3**, total rework **4/6**. The current Review finding is fixed in source and awaits fresh QA and Review.
- PostgreSQL coverage is distinguished precisely: **12** guarded cases are written. The first current live guarded case failed; the later **11** cases were **NOT RUN**. Separately, the original live run remains recorded as **10 PASS / 8 FAIL**; it is not described as wholly unexecuted. Existing live causes (auth callback route error, public completion failure, and zero-fulfilled race) remain open and no new live diagnostic claim is made.

### Continuation checkpoint: live QA race and public-action repair (2026-10-08)

- Current committed candidate is `96ddbdd454989f4e25ef1ffb8beef63ce37d21e2`, pushed as PR #49. The guarded live QA run recorded four failures: three Phase 20 public submissions (finance, group sibling, and companion) stayed pending at 15 seconds without validation, closed-link, core-failure, Prisma, or HTTP 5xx markers; the first PostgreSQL race failed with `PRISMA_P2010`. The later **11** written race cases were **NOT RUN**. The existing `.last-run.json` supplies failed identifiers but no aggregate pass/fail/skip totals, so its aggregate count is explicitly **UNKNOWN** and no result is inferred from absent wrapper stdout.
- Read-only Vercel request metadata for the exact Preview deployment recorded three public submit POSTs, all HTTP 200; no duration field was available. This confirms that the requests reached and returned from Preview, but does not prove the client-side cause. The shared public `GroupApplicationForm` now passes its bound Server Action directly to `useActionState`; its existing `pending || submitted` guard, full-document completion navigation, completion privacy, and repeat-submission idempotency remain unchanged. Fresh QA and Review must independently assess that client-protocol hypothesis.
- A separately guarded Preview probe completed after exact deployment, approved URL, app runtime fingerprint, database/direct identity, and migration preflight. In a fresh diagnostic advisory-lock namespace and read-only transactions, bare `SELECT pg_advisory_xact_lock(...)` reproduced `PRISMA_P2010` with a void-deserialization classification; the established scalar `SELECT 1 AS "locked" FROM pg_advisory_xact_lock(...)` fulfilled. Finance now uses that scalar form. The query-shape regression test and the actual probe preserve the exactly-one-fulfilled and financial conservation assertions.
- The Preview runner now creates a run-owned durable JSON observer before spawning Playwright. It stores only fixed phase/playwright/cleanup/error states, a validated numeric-or-null child close exit code, and `testCounts: "UNKNOWN"`; raw child stdout/stderr remain in process memory only. It records `RUNNING`, `INTERRUPTED`, nonzero and zero exits, and preserves a known cleanup failure through the top-level failure handler. No new E2E run was made from this uncommitted repair.
- Root's approved read-only cleanup audit found all checked synthetic ownership/process counts at zero and **13** applied migrations. The exact-candidate CI run `37705948914` is **SUCCESS**. Production Environment approval gate `37705945161` remains pending and was not approved. No Production access, deployment, migration apply, data write, commit, push, PR mutation, merge, or shutdown action occurred in this checkpoint.
- Final local gates after the repair: focused regression tests **4 files / 37 tests PASS**; full `npm test` **110 files / 950 tests PASS**; `npx tsc --noEmit` **PASS**; `npm run lint` **PASS**; Prisma validation through Next's in-memory environment loader **PASS** (exit 0); `git diff --check` **PASS**; process-only check found no `next dev`; `npm run build` **PASS** (exit 0). Prisma schema and migrations are unchanged. The user-owned `.gitignore` change remains untouched and unstaged. Rework counters are preserved: QA **3/3**, Review **2/3**, total **5/6**.
