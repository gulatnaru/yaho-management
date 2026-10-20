# Task — Integrated application UX implementation PLAN

- Status: proposed PLAN for review. This document does not authorize implementation, migration, commit, PR, merge, or deployment.
- Date: 2026-10-20. Repository baseline: `feature/phase21-ai-service`, HEAD `c68d7bb`; the integrated SPEC is an existing untracked input. Verify the actual branch and diff again before BUILD.
- Primary input: [UX-REDESIGN-INTEGRATED-SPEC.md](UX-REDESIGN-INTEGRATED-SPEC.md), including INT-01–30. Read it first. This request authorizes writing this PLAN only.
- Constraints: current request → [REQUIREMENTS.md](../REQUIREMENTS.md) → [DECISIONS.md](DECISIONS.md) → [ARCHITECTURE.md](../ARCHITECTURE.md) → [AGENTS.md](../AGENTS.md) → existing implementation. Memory is supporting context only.
- Area 3 reference: [admin applications SPEC](UX-REDESIGN-ADMIN-APPLICATIONS-SPEC.md), Business Rules 2–5/9 and UX-02–14/23–28. The [earlier PLAN](UX-REDESIGN-ADMIN-APPLICATIONS-PLAN.md) is supporting design, not an approval or an additional scope requirement.
- The integrated SPEC supersedes the earlier two-input-step proposal: **① 클래스 선택 → ② 보호자·자녀 정보 → ③ 동의·최종 확인**, followed by a separate submission-result/payment-guide page.
- Artifact scope: this file only. Application code, tests, schema, migrations, requirements, Accepted ADRs, environment settings, and existing SPECs/PLANs remain outside this authoring task.

## Goal

Deliver one connected journey across three areas, in independently reviewable phases:

1. **Area 1 — admin class detail:** prepare the explicit class application price, issue a modern single-class link on the class page, copy/open its current address, and optionally configure a multi-class link.
2. **Area 2 — guardian application:** use three mobile-first input steps, preserve each child's information and consent, submit once, then show only the authorized family's fixed transfer guidance.
3. **Area 3 — admin applications:** find whole family submissions, review each child, record actual bank transactions, and explicitly confirm selected children on one family page.

Keep the Modular Monolith, App Router, TypeScript strict mode, Tailwind, existing shadcn-style primitives, Auth.js, server Zod validation, Prisma/PostgreSQL, Vitest, and Playwright. No new business policies, personal-information fields, public catalogue, automated bank matching, customer accounts, or app-wide navigation redesign are included.

## Current State

| Area | Verified implementation | Consequence for this PLAN |
|---|---|---|
| Class detail | `classes/[id]/page.tsx` guards the application lookup with `isAdmin`. `getApplicationLinkForClass` uses `findFirst` across direct/group links; the card receives a link only when a raw `token` exists. | Preserve the pre-query role guard; replace ambiguous lookup with all relevant link metadata. A missing raw token must not mean no link exists. |
| Link creation | `groups.ts` creates groups and issues links in separate transactions. Issuing a group link deactivates its currently active links. Modern links store hashes only. | Add an atomic, retry-safe create-and-issue path and explicit issue/replace/resume intent. Do not call the existing rotating issue operation from a copy or retry handler. |
| Readiness | The class card uses environment-only `buildApplicationAvailabilityContext`; legacy public routes use DB-first settings with an environment fallback only when no DB settings row exists. Modern public routes require valid DB/scoped synthetic settings. | Admin readiness must follow the relevant public mode's actual settings/consent rules, with environment access shown separately. |
| Guardian | Legacy has one long form and field errors. Modern/companion forms use one long controlled form, index-based child identity, repeated consent, and primarily generic errors. Modern class options lack description/age. | Separate draft interaction from safe public reads/error mapping. Keep both submission payload modes and their current server cores. |
| Completion | Existing completion capability, full-document navigation, scoped fixed amounts, copy/notification/invite actions, and generic legacy guidance already exist. | Begin with presentation improvements using these contracts; preserve guards, cookies, cache handling, and legacy channel links. |
| Admin list | `listReservationApplications` pages 20 child applications; pending count is also child-based. Mobile table hides bank information. | Introduce actual family-key pagination, exact counts, and a single responsive family-card tree. |
| Family detail | Page-local Prisma reads and money sums; bulk confirmation appears before deposit entry. Child review/consent/resolution lives on the child route. Selection defaults to all children and defaults to an existing/new Child choice. | First consolidate authorized reads, then integrate financial mutations and finally explicit confirmation. Keep old child routes operational until full parity. |
| Finance/testing | Existing finance/confirmation cores already implement allocation, return holds, atomic confirmation, and locking. Playwright currently configures Desktop Chromium only; guarded Preview races have a separate runner contract. | Reuse core behavior; add phase-specific desktop/mobile browser coverage without weakening Preview or database safety. Mocked tests do not prove transaction safety. |

Paths in the table are abbreviated under their existing `app/(admin)`, `app/(public)/apply`, `lib/reservation-applications`, and `server/reservation-applications` directories.

## Data Model

**DB migration: NONE in every phase.** Do not modify `prisma/schema.prisma`, add indexes/columns/enums/tables, backfill prices, create legacy Submissions, convert existing data in bulk, or run migration commands for this redesign. Normal user-requested writes use existing models.

| Required value | Existing source / invariant |
|---|---|
| Family identity | `ReservationApplicationSubmission.id`. A display key `submission:<id>` is distinct from `legacy:<ReservationApplication.id>` for a legacy child with null `submissionId`. Never group by name, phone, or companion membership. |
| Link scope/history | `ReservationApplicationLink`, `ReservationApplicationGroup`, `ReservationApplicationGroupClass`, issuer/time, and `upgradedLegacyClassScheduleId`. Multiple groups may include the same class. No new singleton-link uniqueness constraint. |
| Price/quote | ADMIN-entered `ClassSchedule.applicationPrice`, snapshotted into each `ReservationApplication.quotedAmount` at submission. No `Program.defaultPrice` fallback; null is neither zero nor free. |
| Independent states | `depositNotifiedAt`; actual `ApplicationDeposit` rows; each application's existing status. Review progress and wizard progress are presentation state only. |
| Payment linkage | Existing payment-target `FundAllocation` and `ReservationApplicationPaymentMapping` → `PaymentItem` → `Payment`, once per confirmed application. |
| Returns | Existing funded `ReturnObligation`, `ApplicationReturn`, and allocations. Pre-reservation returns remain separate from post-confirmation `Refund`. |
| Consent/retention | Existing per-child booleans, consent version/time, ChildConsent history, requested/confirmed Child references, resolution and purge fields. No new consent category or retention rule. |
| Retry identity | Existing Group/Link primary keys for new issuance operations; existing financial `idempotencyKey` fields. No operation table, stored plaintext token, or new finance status. |

### Money and consistency contract

Use one server-side ledger projection for list/detail/mutation reconciliation, built from the existing `ledger.ts` validation and availability functions:

- `Q`: sum of every original child quote in the submission, including resolved children. An invalid/missing modern quote makes Q unavailable and blocks affected confirmation; never sum null as zero or reinterpret the row as legacy.
- `D`: actual confirmed deposits. `P`: funds allocated to Payment mappings. `R`: outstanding funded return obligations. `T`: completed pre-reservation returns. `A`: unallocated funds.
- Preserve **`D = A + P + R + T`** and **`A = D − P − R − T`**. Existing return allocations include both outstanding and completed return amounts: when using `availableDepositAmount(deposits, allocations)`, do not subtract completed returns again.
- `S`: selected pending children's fixed quotes. `B = max(0, S − A)`. Client S/B updates are feedback only; the confirmation transaction recomputes eligibility and balance after locking.
- An inconsistent ledger is an explicit unavailable/error state, never `Math.max(0, invalidBalance)` or a successful zero-balance display. Aggregate independent relations before joining to avoid deposits × children × returns multiplication.
- Deposits, notification, requests, and pre-reservation returns do not enter Revenue. New-flow confirmation allocates exactly selected quotes once; excess/unallocated/returned funds never become Payment or Refund. Later Refund does not release funds back into this pre-reservation ledger.
- Legacy deposit confirmation is an amount-free timestamp/admin record. Legacy reservation confirmation creates no Payment; retain the separate manual payment path when no payment exists.

### DB constraints versus server rules

Keep all existing FK, unique, CHECK, payment-mapping, allocation, positive-money, and refund-limit constraints. Server rules still enforce ADMIN authorization, valid capability scope, current consent/configuration, child identity/activity/purge status, current group membership, class eligibility, duplicate bookings, available funds, and explicit overbooking confirmation. UI disabled state and card grouping do not enforce these rules.

Do not change lock order in existing cores. Modern finance/resolve/retention paths serialize Submission → applications (stable ID order) → ClassSchedule (stable ID order) → Child and dependent writes; return operations retain Submission → ReturnObligation. Group issue/edit/stop use Group → ClassSchedule. Legacy confirmation uses application → ClassSchedule → Child. Preserve existing special cases such as explicit legacy upgrade creating a fresh group while holding the class lock; never introduce locking of an existing group after acquiring its class lock. New link transaction details appear under API.

## API

### Authorized reads and route contracts

Use Server Components and existing Server Actions. No new public endpoint, independent service, or bank API is required. New administrative query entry points call `requireAdminPrincipal()` before database access; retain page/action guards too. Class pages query application/price information only inside the ADMIN branch. No shared cross-role cache of PII, tokens, counts, or financial data.

| Planned contract / module | Responsibilities and allowed output |
|---|---|
| `ClassApplicationLinksView` in `link-queries.ts` | All direct links and distinct related groups, including inactive/history entries. Include IDs, current membership, active flags, issuer/time, legacy-upgrade relationship, mode-specific readiness, environment, and whether an address is available. Do not expose token hashes to clients. Only an existing legacy raw token or this mount's successful issuance response supplies an address. |
| Admin readiness projection in `availability.ts` / `runtime.ts` | Separate link existence/activity, class eligibility, settings readiness, consent readiness, and current-environment access. A stopped link in Preview shows both facts. Share settings precedence with the relevant public flow; do not make Preview diagnostics authorize public access. |
| `FamilyListResult` in `family-queries.ts` | Discriminated family rows; `totalFamilies`, all children in matching families, children satisfying the active child predicate, page/totalPages, and separate global pending `{families, childApplications}`. Label every scope. |
| `ApplicationWorkflowDetail` in `detail-queries.ts` | Modern/legacy discriminated detail, child information and consent/version, candidates, resolution/retention history, ledger, return history, actual reservation/payment links. Pass only necessary slices to interactive clients. |
| Ledger projection in `ledger-summary.ts` | Validated Q/D/P/R/T/A from a consistent server snapshot; shared by administrative reads. Public completion continues using its separate capability-limited fixed-quote contract. |
| Public class DTO in `public-queries.ts` | Only permitted ID/scope, program name/description/target ages, starts/ends and location. Legacy class scope remains server-bound. No price, capacity, reservations, safety/insurance/internal metadata, admin diagnostics, or other family's information. |

**Family query algorithm:** validate `status=SUBMITTED|CONFIRMED|REJECTED|CANCELLED|all`, optional `classScheduleId`, `notification=all|received|none|legacy`, `bankRecord=all|recorded|none|legacy`, and positive page with Zod/allowlists. Status and class must match the **same child**. Notification/bank predicates apply to the family; modern `none` does not classify legacy as unpaid or unnotified. Filter changes reset page to 1.

Build eligible modern Submission keys and legacy application keys with parameterized `Prisma.sql`/`$queryRaw`, `UNION ALL`, then order and page at **20 families** before bounded Prisma hydration. For pending, use earliest matching pending child's class start, submission time, stable kind/ID; other states use recent submission and stable kind/ID. Keep pending children in cancelled/started classes visible. Hydrate all siblings, including those outside the filter, and mark which matched. Use a consistent read transaction for key selection/counts/hydration, clamp an out-of-range page, and compute global pending counts with the same identity definition. Duplicate comparison may use phone/name server-side under the existing rule, but no comparison PII enters list DTOs. Review query plans on synthetic data using existing indexes; do not solve performance uncertainty with an unapproved migration.

**Public loading:** resolve mode from server-side link storage, never URL shape. Extend modern/group/companion/upgraded class loading through the minimal public DTO. Preserve guard-first/minimal availability reads and avoid selecting class display data before authorization. A closed or invalid public link returns only the existing generic closed notice, including in HTML/RSC; enriching descriptions must not expose previously hidden data through intermediate RSC values. Preserve distinct ordinary Preview, signed lease, operator-session and companion access conditions.

### Actions and refresh behavior

| Action boundary | Planned change / preservation |
|---|---|
| Class application price | Add a narrow ADMIN-only price action in `classes/actions.ts`, validated with the existing price constraints. Update only `applicationPrice` with existing class-update eligibility and conditional-write/stale-version checks. Do not submit a stale full class form or change program, teacher, capacity, status, or old quotes. |
| Single-class create + issue | New coordinated action in administrative application `actions.ts`, backed by a transaction helper in `groups.ts`. Bind the current class, actor, operation UUID, and observed link-scope revision. Create a normal one-member Group and hashed Link atomically; no separate group screen/name/reselection. Existing links are preserved. |
| Multi-class composition + issue | Reuse group validation/management with the current class initially selected. Make initial create+issue atomic through the same helper. For an existing group, save membership and issue/replace are explicit results/actions; retry issuance against the saved group, never create another group because its issue step failed. |
| Replace / stop / resume | Target an explicit direct-link or group ID and observed revision; verify scope server-side. Use the existing cores, adding operation/revision handling for issue/replace retries. A group operation affects all its included classes and extant group URLs, as existing core behavior requires; show that full scope. Resume issues a new token, never revives an old address. |
| Explicit legacy upgrade | Reuse the existing upgrade core and same old address. Require explicit price/configuration/consent readiness. Reconcile a retry through `upgradedLegacyClassScheduleId` instead of upgrading again. Past amount-free applications remain legacy. |
| Public submit | Preserve legacy form fields and modern JSON payload/core, 1–10 modern children, one child for legacy, honeypot/rate controls, current consent, device ownership and all-or-none persistence. Extend safe error metadata; do not create a server draft on next/back. |
| Deposit / return | Reuse existing actions and finance cores. Preserve one financial idempotency key and frozen attempted payload until the outcome is known; a deliberately new transaction gets a new key. Return typed field errors and minimal receipt identity needed to reconcile existing records. |
| Reject / guardian-requested cancel | Existing child-specific action, reason, and finance-aware core. Derive its Submission server-side and refresh family/list/count/return views. Never close other siblings implicitly. |
| Modern confirm | Existing `confirmApplicationSubmission`/finance core, explicit child selection, explicit new/existing Child choice, optional reviewed memo, existing bound overbooking acknowledgment, one atomic batch and Payment mapping. No per-child loop of separate confirming actions. |
| Legacy confirm | Existing amount-free deposit-confirmation and reservation-confirmation actions. Do not add modern ledger fields, automatic Payment, or modern amount gates. |
| Completion notification / invite | Keep current capability validation and idempotency, first notification timestamp, separate companion ownership, and no Payment/Reservation/Revenue side effect. Presentation changes do not expand capabilities. |

**Issuance atomicity and retries without migration:** validate a stable operation UUID, derive namespaced actor-scoped Group/Link primary IDs from it on the server, and use a transaction-scoped advisory lock for that operation. Encode a digest of the immutable request intent (operation kind, target IDs/class set and observed revision) in those existing IDs; resolve prior IDs by their actor/operation namespace under the lock and reject a different digest. This preserves intent checking even after later group membership changes, without a new stored payload or column. Keep the same operation UUID and frozen intent for an unresolved attempt; a deliberate new operation gets a new UUID. For a new group, create its fresh row, then lock classes in sorted order, recheck eligibility/settings and the observed relevant-link revision, create membership and hashed link, and commit together. Concurrent independent initial issue attempts that observed the same empty scope must recheck under the class lock; the stale one rolls back and displays the now-existing metadata. No arbitrary existing group is chosen or merged. An ADMIN can still explicitly create another independent multi-class scope.

For an existing group, take the operation advisory lock, then lock Group and classes in their existing order; check the operation-derived Link ID **before** any deactivation. A replay returns the committed link metadata and current scope without rotation or reactivation, even if a later operation has stopped/replaced it. Validate actor, intended scope and operation kind; a reused ID with a different payload is a conflict. Reuse transaction-level helpers rather than nesting the currently separately committing create/issue cores. Operation IDs and request digests are concurrency identifiers, never authorization or public capabilities.

Raw modern tokens are returned only on the original successful issuance response and held in component memory. On a lost response or later reload, reconcile through metadata and display “address available only at issue time”; explicit confirmed replacement is required to obtain another address. Do not reconstruct a token from the operation ID, persist it in browser storage/logs, or rotate silently to make a retry look successful. Existing legacy plaintext storage is not expanded. Use normal current-origin public URLs, with no admin bypass parameters or inferred Production hostname.

**Mutation refresh:** after success, revalidate the affected class/link/group views, child/family detail, application list/global pending counts and returns where applicable; confirmation additionally refreshes related reservation/class/Child/payment/revenue readers. Use one family workflow coordinator to refresh server data and reconcile drafts by application ID. Refresh failure displays an explicit stale/retry state and blocks spending based on stale amounts. It must not issue another write. Financial response loss is reconciled against the same idempotency key/receipt, with that payload frozen; status-based confirmation reconciliation reads the actual reservations/mappings rather than replaying the batch. Preserve each still-valid unprocessed sibling's draft.

### URLs and context

- Keep `/reservation-applications`, `/submissions/[id]`, child `/[id]`, `/groups`, `/groups/[id]`, `/returns`, `/settings`, and `/retention` under the current application prefix. Provide purpose-labelled contextual links for link management, bank settings, retention and the full return workbench; do not restructure unrelated global menus or AI pages.
- Only Phase 8 may temporarily redirect an authenticated modern child-detail request to its real family with `applicationId=<id>#application-<id>`, after content/action parity. Validate membership before focusing. Legacy and missing/forbidden requests retain their existing behavior. No permanent cached redirect.
- Carry only allowlisted status/page/class/notification/bank filters and stable card/child anchors. Rebuild internal return URLs, never trust arbitrary `returnTo`. Preserve class/return-workbench entry context and focused family position. No PII, amounts, consent, payer names, or new capability query parameters/history state.
- Keep all existing public `/apply/[token]`, `/apply/group/[token]`, `/apply/companion/[token]`, `/apply/complete` routes, tokens and cookies. Explicit conversion and explicit replacement remain different actions.

## UI

### UI-only versus structural work

| Classification | Included changes | Boundary |
|---|---|---|
| **UI-only (U)** | Korean labels, action emphasis, single-column/mobile layouts, disclosure, read-only summaries, shared copy feedback/manual fallback, consent grouping, wizard-local draft/step/focus behavior, telephone keypad. | No new DB query/action semantics, policy, authorization, persistence, or finance calculation. UI-only work still uses BUILD when implemented. |
| **Structural reads (R)** | All-link inventory/readiness, minimal public class DTO, actual family pagination/counts, consolidated detail and ledger projections. | Server authorization, select minimization, filter/count semantics and route data contracts require explicit tests. |
| **Structural actions (A)** | Price-only save, atomic issuance/retry coordination, safe error mapping, mutation refresh/reconciliation, same-page bank/return/resolution and explicit batch confirmation wiring. | Reuse existing rules and cores; transaction wiring and capability boundaries are not mere styling. |
| **Excluded** | Schema/migration/backfill, new money/refund/privacy policies, public price/capacity, automatic payments or account/status service, app-wide menu/AI redesign. | Escalate a true requirement conflict to SPEC/PLAN review; do not silently add scope. |

### Components and execution boundaries

- Shared presentational elements live in `components/application-ux/`: `CopyControl`, `FormFeedback`, and `StepIndicator`. Reuse `components/ui/{button,card,input,label,select,textarea,checkbox,disclosure,badge,warning-banner}.tsx`. Do not replace the UI library or change global primitives to fit one screen.
- Area 1: server `ClassApplicationLinksView` feeds an ADMIN-only `ApplicationLinkCard`, `LinkScopeList`, `LinkReadiness`, and client islands for `ApplicationPriceForm`, `MultiClassLinkComposer`, and impact confirmation. Existing management screens reuse these domain components.
- Area 2: client `ApplicationWizard` owns only memory drafts; `ClassSelectionStep`, `GuardianChildrenStep`, `ConsentReviewStep`, `ChildDraftCard`, and `PublicClassCard` accept the public DTO. Legacy/modern wrappers adapt existing payload formats. `CompletionGuide` stays a separate capability-authorized result component.
- Area 3: server family cards and child review/consent/history use `ApplicationStateSummary`, `FamilyApplicationCard`, `ApplicationReviewCard`, and `LedgerSummary`. Client `WorkflowController` coordinates the existing forms, explicit selections, error focus, and refresh. Public components never import administrative DTOs or financial queries.
- Keep one semantic card tree for desktop and mobile; use responsive grid/flex to arrange it. Do not render a hidden desktop table containing more PII or a second duplicated mobile form.

### Interaction and privacy details

Use `md` = 768px; verify 360px, 390px, breakpoint and desktop widths. Stack mobile actions with at least 44px touch targets, wrap long URLs/names/amounts, and use width-safe date/datetime inputs. Avoid a sticky bottom bar in this plan so keyboards, safe areas, content and consent remain visible. Disclosures have separate expand/navigation controls; no nested interactive links. Show textual state, field-linked errors, heading focus after step changes, error-card opening/first-error focus, live copy/save feedback and focus restoration after confirmation dialogs.

Wizard children use stable ephemeral keys, not array indices. Keep a submitted index→draft-key snapshot while a request is pending and prevent structural edits until it completes; safely map allowlisted server child-index errors back to that snapshot. Class candidates are local choices, not reservations: removing a candidate invalidates affected assignments without silently replacing them. One candidate may be fixed for a single-class link; multiple candidates require explicit assignment per child.

All consent boxes start unchecked. Display the four required confirmations separately, and two optional photo choices separately per child, with unchanged original text/version and no combined “agree all”. Shared required confirmations are explicitly tied to the visible set of children/classes and fan out into existing child fields only after review. Adding a child or changing an assignment invalidates shared required acknowledgment for the changed scope; removing a child updates the target list. Unchanged children's optional choices stay independent, and new children never inherit another child's choices. Do not fetch historical consent as a default grant.

Next/back/step links use non-submit controls. Enter before step 3 performs the appropriate validation/navigation and never calls the persistence action. Validate only visible-step fields for progression, then all payload fields on final submit; hidden required controls must not trap browser validation/focus. Only `신청서 제출` sends one final request; pending/transition states suppress click and Enter resubmission. All three input steps and their props/HTML/RSC omit prices; modern guidance says `정확한 입금액과 계좌는 신청 완료 후 안내합니다.`

Failed valid-form interactions retain memory drafts; never persist PII/consent/payer names in URL/localStorage/sessionStorage/logs. Distinguish safe validation, transient failure, and definitive closed access using fixed allowlisted action outcomes; an access-closed outcome removes the form and clears the draft without disclosing internal reasons. Ambiguous transport failure preserves the current authorized draft and prompts reconciliation/retry, with no automatic resubmission or assumed success. Do not claim server-side exactly-once public submission under lost responses; preserve the existing protection and avoid adding a new submission service in this redesign.

Keep repeat-child lookup bound to the existing device capability and exact identity rules. A late lookup may offer owned children but must not overwrite guardian fields already edited; lookup failure is a visible recoverable state, not “no children”. Companion input never inherits inviter data/consent. Success clears/hides draft content and uses existing full-document completion navigation; verify back/forward, reload and BFCache behavior. Add only a client restoration guard if needed to clear a stale success form; do not replace cache/cookie/capability policies.

All surfaces distinguish loading, first-use empty, filtered empty, read failure, validation failure, write failure/unknown outcome, pending, stale after refresh and success. Failures must not masquerade as zero families, no link, zero balance, or a completed write.

## Tests

This section specifies future verification. No implementation tests, lint, build, DB operation, or E2E are executed by writing this PLAN.

### Per-phase execution and environment gates

1. For each implementation phase, BUILD runs targeted Vitest and required regressions, `npm test`, and `npm run lint`; QA independently verifies its acceptance criteria and Review checks the diff. Before any `npm run build`, check `pgrep -f 'next dev'` or equivalent independent of port. If dev is running, skip build, use `npx tsc --noEmit` + lint + tests, and report the substitution. Do not share an active dev `.next` cache with build.
2. Add `playwright.ux.config.ts` for the new **local-only** UX specs, reusing the current config's environment loading, local-origin/DB checks, worker isolation and web-server rules. It refuses Preview mode. Projects: Desktop Chromium (e.g. 1440×900), mobile WebKit/iPhone behavior at 360px and 390px. Select only the new `integrated-ux-*.spec.ts` files; retain the existing config and Preview runner allowlists/flags. Run new suites on an explicitly identified isolated nonproduction PostgreSQL DB with synthetic fixtures and owned cleanup.
3. Existing Preview-safe Phase 20 suites remain callable only through the guarded runner, with app/DB/deployment/schema identity checks, one run, signed synthetic lease, owned cleanup and current artifact policy. Existing `phase20-postgres-races.spec.ts` is Preview-runner-only; do not invoke it under the new local config. New SQL/issuance races get a separate dedicated-local-DB suite. No new test files are automatically added to Preview admission. Legacy public/retention-global tests stay on their existing dedicated-local path.
4. No Production E2E, general Preview public reception, real personal data, shared-DB resets/truncation, CI E2E rollout, environment-guard bypass, or schema gate changes. Retain Production synthetic-data rejection. Operator-session permission is not companion/lease permission.
5. **Every phase must pass both desktop and mobile verification.** Automated mobile WebKit is a Safari-engine regression check, not proof of actual iOS Safari behavior. Also complete the phase's real iPhone/iOS Safari end-to-end checklist in an allowed synthetic environment (approved run-owned Preview scope where supported, otherwise the permitted local test setup). Do not claim this gate passed if a device/setup is unavailable; record it as pending. Desktop checks include keyboard operation and browser back/forward; Safari checks include touch, VoiceOver, keyboard/date input, copy/new-tab behavior and history/cache where applicable.
6. Record the tested revision, browser/device versions, viewport, safe scenario IDs, results and unresolved failures in the phase's QA handoff. Capture no real PII, raw capability URLs/tokens or credentials in reports/artifacts; retain existing safe Preview reporting. Missing environments or failed checks are not PASS.

The existing `vitest.config.ts` includes unit tests only. Add a separate `vitest.integration.config.ts` for I suites, retaining aliases but selecting only `tests/integration/reservation-applications/**/*.test.ts`. Require explicit local-test DB identity checks before constructing Prisma clients or fixtures, and synthetic owned cleanup. These suites run separately from `npm test`; a missing safe DB is pending verification, not a silent pass. No default test command should start using an arbitrary environment DB.

### Requirements-to-tests traceability

Path aliases used below and in phases: **U** = `tests/unit/reservation-applications/`; **I** = `tests/integration/reservation-applications/` (new local PostgreSQL suites); **E** = `tests/e2e/`. “Existing” means reuse/regression, not rewrite the core to satisfy the test.

| Requirement / ADR basis | Required result | Positive / refusal or race cases | Level | Planned test locations |
|---|---|---|---|---|
| INT-01–07; ADR-052/060 | Correct scope/readiness, atomic issue, explicit destructive intent and one-time address | Issue one class; all related links; hashed raw missing; copy/open no writes; cancelled dialog; stale scope; lost response; same/different operation concurrent issue; unrelated links unchanged | Unit + local PG integration + desktop/Safari E2E | U `link-queries.test.ts`, `class-link-issuance.test.ts`, existing `availability.test.ts`, `phase20-groups.test.ts`, `links-and-resolve.test.ts`, `admin-actions.test.ts`; I `class-link-issuance.test.ts`; E `integrated-ux-class-links.spec.ts` |
| INT-05/25/27; ADR-052/059/060 | Existing URL modes, settings precedence and environment boundaries | DB-valid/env-invalid; DB-invalid/env-valid; absent-row legacy fallback; Preview ordinary denied; signed owner lease allowed; session not accepted for companion; Production synthetic denied | Unit + existing guarded E2E + local E2E | U existing `content-and-config.test.ts`, `public-queries.test.ts`, `group-public-action.test.ts`, `phase20-completion-page.test.ts`, `admin-manual-session-action.test.ts`; E existing Phase 18/20 suites and `integrated-ux-class-links.spec.ts` |
| INT-08–13/28; ADR-054–056/060 | Three input steps, stable children/assignments, scoped required and independent optional consent | Next/back no write; add up to 10, refuse 11/remove-last; remove middle; edit class; differing photo choices; missing mandatory field/consent; Enter; current version; error in another step | Unit draft/action + desktop/Safari E2E | U `application-draft.test.ts`, `field-errors.test.ts`, existing `group-application-form.test.ts`, `group-public-action.test.ts`, `public-action.test.ts`, `validation.test.ts`; E `integrated-ux-guardian.spec.ts`, existing `phase20-application-group-siblings.spec.ts` |
| INT-14–17/25/26; ADR-050/052/055/058/060 | Public data minimization, current device ownership and completion-only fixed amounts | All three input steps contain no prices/capacity in DOM/HTML/RSC/responses; invalid/closed link no class data; other/expired device denied; purged/inactive/identity-tampered child denied; invalid/expired completion no own amounts; storage/history privacy | Unit + local PG integration where racing + desktop/Safari E2E | U existing `public-queries.test.ts`, `phase20-devices.test.ts`, `phase20-completion.test.ts`, `phase20-completion-page.test.ts`, `complete-navigation.test.ts`; I `workflow-races.test.ts`; E `integrated-ux-guardian.spec.ts`, existing `phase20-companion-repeat-privacy.spec.ts` |
| INT-15/19; ADR-060 | Notification is first-timestamp-only and independent of bank and booking | Repeated notify preserves timestamp; no Payment/Reservation/Child/Revenue change; record bank deposit without guardian notification | Unit + E2E with DB assertions | U existing `phase20-completion.test.ts`, `admin-actions.test.ts`; E `integrated-ux-completion.spec.ts`, `integrated-ux-ledger.spec.ts` |
| INT-18/19/30; precursor UX-02–06; ADR-001/013/060 | Real family pagination/count/filter semantics and contextual return | 21+ families, multi-child page edge, mixed statuses, status/class cross-child false match, legacy/null, same phone separate families, pending cancelled class, page shrink and exact global badge | Unit + real PG integration + desktop/Safari E2E | U `family-queries.test.ts`, `navigation.test.ts`, existing `queries.test.ts`; I `family-queries.test.ts`; E `integrated-ux-family-list.spec.ts` |
| INT-20/21/24/29; ADR-060 | Current server ledger after deposit/return/resolution, independent siblings | Partial/excess/late deposits; partial returns; reason required; over-return denied; same key replay, changed-attempt payload frozen; lost response/refresh failure; two-admin deposit/return/resolve races; no Payment/Revenue before confirm | Unit + real PG integration/races + desktop/Safari E2E | U `ledger-summary.test.ts`, `workflow-controller.test.ts`, existing `phase20-ledger.test.ts`, `phase20-finance.test.ts`, `admin-actions.test.ts`; I `workflow-races.test.ts`; E `integrated-ux-ledger.spec.ts`, existing `phase20-application-finance-returns.spec.ts`, guarded `phase20-postgres-races.spec.ts` |
| INT-20/22/23; ADR-001/003/005/023/043/044/058/060 | Explicit selected atomic confirmation and exactly-once payment mapping | Empty selection rejected; subset/full; insufficient A; duplicate/closed/inactive/purged/ownership invalid; overbooking consent changed/reset; two admins; confirm vs return/purge/last-seat; unchanged unselected sibling; legacy no auto-Payment | Unit + real PG integration/races + desktop/Safari E2E | U existing `confirm.test.ts`, `phase20-finance.test.ts`, `admin-actions.test.ts`; I `workflow-races.test.ts`; E `integrated-ux-confirmation.spec.ts`, existing `phase18-reservation-application.spec.ts`, `phase20-postgres-races.spec.ts`, `phase18-retention-concurrency.spec.ts` in their permitted runners |
| INT-21/23/24; ADR-007/034–041/060 | Pre-reservation returns stay distinct from Refund; existing post-confirmation money rules | No Refund/Revenue for pre-reservation return; linked Payment exact; later manual partial/full refund within existing cap; over-refund denied; refunded amount not made available for a sibling | Existing unit + E2E regression with DB sums | U existing `phase20-finance.test.ts`; E existing `payment-refund-lifecycle.spec.ts`, `revenue-report.spec.ts`, `phase20-application-finance-returns.spec.ts` |
| INT-12/16/24/26; ADR-006/008/050/054–058/060 | ADMIN-only reads/actions and preserved consent/retention/safety boundaries | ADMIN success; MANAGER/TEACHER direct route/action/query denied before data; class HTML/RSC lacks count/money/token; no safety info in list; optional decline/withdrawal history preserved; purge/transaction history remains | Unit + integration for purge races + role E2E | U new read-contract tests, existing `admin-actions.test.ts`, `retention.test.ts`, `consent-migration.test.ts`, `matching.test.ts`; E new phase suites plus existing `phase16-account-access.spec.ts`, `phase18-retention-concurrency.spec.ts` |
| INT-28–30; ADR-014/017; UI-GUIDELINES | Accessible touch/keyboard flow and honest states on every surface | 360/390/desktop; long text/date/URL; no horizontal overflow/hidden bank state; focus/dialog/VoiceOver; copy denied fallback; read/write failure vs empty; safe return context | SSR/pure unit + browser interaction + actual Safari checklist | U new phase component/feedback tests; all planned `integrated-ux-*.spec.ts` suites (the class-link suite expands in Phase 5) and per-phase QA device evidence |

No new unit tests are required for every spacing/text edit or for assertions mirroring markup. Use existing SSR/pure Vitest patterns for contract/draft/error logic and browser tests for actual event/focus/layout behavior. No added browser-testing library is assumed. The DB-constraint row requires regression assertions, not new migrations; unchanged refund/privacy policy is verified for preservation, not newly specified. Pricing, refund fees, expanded PII and global navigation tests are inapplicable because those changes are excluded.

## Acceptance Criteria

- All INT-01–30 have an owning phase and the tests above; precursor Area 3 requirements apply only to the integrated scope.
- ADMIN can prepare and issue a single-class modern link entirely in class context, while existing raw/hash/upgraded/multi-class scopes, explicit replace/stop semantics and environment guards remain correct.
- Guardians complete exactly three input steps and a separate result page, with stable child assignments, correct consent and field errors, no pre-submit price exposure and no capability/privacy regression.
- Admin families are actual paginated submissions, and one detail supports review → actual bank record → current A → selected atomic confirmation, including child resolution and the same return ledger.
- Permissions, locked eligibility checks, fixed quotes, `D=A+P+R+T`, one-time Payment mapping, legacy manual payment, refunds and retention hold in positive, refusal and concurrency cases.
- Each phase passes its desktop and mobile WebKit checks and actual iOS Safari checklist, including failure/empty states and relevant role/payload tests. Phase 8 passes the full integrated journey and existing core regressions.
- No schema/migration/data conversion or policy change is introduced. Rollback always preserves committed business records.

## Risks

| Risk | Mitigation / stop condition |
|---|---|
| A supposedly cosmetic change changes a query, action or public DTO | Classify U/R/A in each phase and review the corresponding server/authorization tests. Never sign off structural work from screenshots alone. |
| Shared UI imports admin data into public HTML/RSC | Separate DTO/modules; minimal queries before rendering; inspect raw initial HTML and RSC/navigation responses, not only visible DOM. |
| Hashed-token retry rotates a distributed link or loses scope | Atomic transaction, operation-derived existing primary IDs, scope revision checks and metadata-only reconciliation. Never solve lost raw response by storing plaintext or auto-replacing. |
| Family summaries, balances or counts disagree under filters/concurrent writes | Family-key paging and snapshot reads, validated shared ledger projection, bounded aggregates and explicit stale-state handling. Verify on real PostgreSQL. |
| Wizard edits misapply consent/error or restore PII via Safari cache | Stable draft keys, submitted snapshot mapping, scope-bound confirmation, full-document success and actual Safari back/forward/BFCache verification. |
| Money is recorded twice or return funds reused | Preserve idempotency/attempt identity and existing transactional cores, reconcile unknown outcomes, prove conservation/payment mapping under races. |
| Legacy/new-flow behavior becomes unified incorrectly | Server-derived discriminated mode, separate legacy money absence, compatibility tests before route consolidation. |
| Baseline deploy/schema/other-feature differences | Recheck source state before BUILD; keep unrelated Phase 21 work untouched. Schema compatibility problems follow existing release policy; this PLAN grants no schema/deployment authorization. |
| Safari or isolated DB unavailable | Record that verification as pending and withhold the phase PASS; do not replace it with a Chromium screenshot or mocked transaction result. |

## Implementation Order

Implement on `feature/<name>` through the required BUILD developer subagent after approval. The top-level planning session does not edit work code. Run **one phase at a time**, with QA → Review → BUILD fixes → revalidation before proceeding. These are delivery slices of the one integrated feature; numbering does not start new product Phase 22–29 work.

Order is based on the most consequential boundary changed: presentation → read contracts → capability-sensitive link writes → public PII/consent submission interaction → financial mutations → booking/payment allocation. Each phase lists its hard dependencies; execute the numbered order even where read-only pieces could technically be developed independently.

| Phase | Area / deliverable | Risk | Type | Hard dependencies |
|---|---|---|---|---|
| 1 | Completion guidance and shared feedback | Low | U | Approved integrated PLAN |
| 2 | Class link inventory/readiness | Moderate: read/role accuracy | U + R | 1 |
| 3 | Actual family list/counts/context | Moderate: grouping/PII | U + R | 1–2 |
| 4 | Family review/detail/ledger reads | Moderate–high: detailed PII/financial projection | U + R | 3 |
| 5 | Class price and safe link issuance/composition | High: capability-changing writes | U + A | 2–4 |
| 6 | Guardian three-step input and safe error contracts | High: public PII/consent persistence boundary | U + R + A | 1, 5 |
| 7 | Same-page bank, resolution and returns | Very high: financial writes | U + A | 4, 6 |
| 8 | Explicit atomic confirmation and final integration | Highest: Reservation/Child/Payment/consent | U + A | All previous phases |

For concise file inventories: **C** = `app/(admin)/classes`; **R** = `app/(admin)/reservation-applications`; **P** = `app/(public)/apply`; **L** = `lib/reservation-applications`; **S** = `server/reservation-applications`; **X** = `components/application-ux`. U/I/E test aliases are defined under Tests. **M** means modify an existing file; **N** means create. All paths in a phase are planned, not already changed.

### Phase 1 — Completion guidance and shared feedback

**Goal:** improve the existing post-submit result without changing any data, authorization, query or action contract. Owns INT-14/15/28/29 presentation; security/financial behaviors remain regression requirements.

**Files:** M `P/complete/page.tsx`, `P/complete/completion-guide.tsx`; N `X/copy-control.tsx`, `X/form-feedback.tsx`, `playwright.ux.config.ts`, `E/integrated-ux-completion.spec.ts`; M `U/completion-guide.test.ts`, `U/phase20-completion-page.test.ts`. Reuse `complete-navigation.test.ts` and completion/notification/invite tests unchanged where applicable.

**Components / separation:** U only: use `CopyControl` with explicit target-labelled success and selectable manual-copy fallback, plus `FormFeedback`. Keep `신청이 접수되었습니다`, explain transfer → notification → operator verification, name the secondary area `친구 보호자 초대`, and preserve legacy generic bank/channel guidance. Do not alter `completion-actions.ts`, capability lookup, amounts, first notification timestamp, cookies or cache behavior.

**Tests:** existing valid/invalid/expired completion and notification tests; denied Clipboard API, per-target copied value, pre-hydration disabled actions, invite failure/cancel, no new financial rows. Test setup adds the local-only browser matrix and rejects Preview mode.

**Desktop E2E:** modern and legacy result pages; own fixed totals; keyboard copy/fallback and invite/notify actions; invalid completion does not recover a family's amounts.

**Mobile Safari E2E:** mobile WebKit at 360/390 and actual iOS Safari: long account/payer wrapping, touch target, native clipboard denial/manual selection, notification status announcement, reload/back behavior. Completion remains outside the input-step indicator.

**Risks:** misleading “paid/confirmed” wording, clipboard constraints, losing legacy channel links. **Rollback:** revert presentation components and their consumers together to the existing guide. Keep every capability, notification, invitation, submission and fixed quote; no data rollback or new address is needed.

### Phase 2 — Class link inventory and truthful readiness

**Goal:** make all relevant link scopes and independent readiness facts visible before changing how issuance works. Owns INT-02–06 read/display, INT-25–29 boundaries.

**Files:** M `C/[id]/page.tsx`, `C/_components/application-link-card.tsx`, `L/queries.ts`, `L/availability.ts`, `L/runtime.ts`, `R/groups/[id]/page.tsx`; N `L/link-queries.ts`, `C/_components/link-scope-list.tsx`, `C/_components/link-readiness.tsx`, `U/link-queries.test.ts`, `E/integrated-ux-class-links.spec.ts`; M `U/queries.test.ts`, `U/availability.test.ts`. Add focused runtime cases to `U/content-and-config.test.ts`.

**Components / separation:** R replaces `findFirst` as this view's source and projects all direct/upgraded/group scopes/history. Use membership and upgrade relation to describe `이 클래스 전용`, `기존 주소를 전환한 링크`, and `여러 클래스 통합`; do not invent stored subtype or arbitrarily choose among singleton groups. U places the card after basic class information, shows existing price without a new save yet, scope/issuer/time/raw-address availability and separate stopped/class/settings/consent/environment facts. Existing mutation paths remain their existing explicit operations until Phase 5. Add copy/open only for an actually available current raw URL; opening is an ordinary same-origin new tab with no bypass or submission.

**Tests:** all relevant scopes including no raw token, multiple groups, inactive/history; DB/env precedence by mode; preview-stopped combination; class closed but existing applications still reachable. ADMIN query success; MANAGER/TEACHER perform no application query and receive no token/price/count metadata.

**Desktop E2E:** inspect raw HTML/RSC per role; copy and new-tab open produce zero new domain rows and no token rotation; reload a hashed link shows metadata and no false “미발급”.

**Mobile Safari E2E:** 360/390 automated and actual Safari: long addresses/labels, expand scope versus navigate, copy fallback/new tab, and both environment/status notices remain visible. Ordinary Preview opens only the generic public closed page.

**Risks:** readiness accidentally broadens public access; “most recent” hides another valid scope. **Rollback:** revert the read adapter/card together while preserving ADMIN query guards and all links. Existing group management remains the operational fallback; no token or link activity is changed by rollback.

### Phase 3 — Family list, exact counts, filters and return context

**Goal:** page and count real submissions and make three independent states visible on all widths. Owns INT-18/19/26/28–30, plus class-context entry from INT-30.

**Files:** M `R/page.tsx`, `R/_components/application-status-filter.tsx`, `R/_components/application-table.tsx` (remove its use from this route), `L/list.ts`, `L/queries.ts`, `app/(admin)/layout.tsx`, `app/(admin)/_components/nav-drawer.tsx`, `C/_components/application-link-card.tsx`; N `L/family-queries.ts`, `L/navigation.ts`, `L/ledger-summary.ts`, `R/_components/family-application-card.tsx`, `R/_components/application-state-summary.tsx`, `R/loading.tsx`, `R/error.tsx`, `vitest.integration.config.ts`, `U/family-queries.test.ts`, `U/navigation.test.ts`, `U/ledger-summary.test.ts`, `I/family-queries.test.ts`, `E/integrated-ux-family-list.spec.ts`.

**Components / separation:** R implements the family query/count/ledger contracts and allowlisted navigation. U renders one responsive card tree with all siblings, matched-child markings, separate guardian-notification/bank-record/confirmation axes and subordinate return/duplicate flags. List views show no phone/DOB/request/consent bodies and no financial action controls. Legacy gets explicit unsupported/amount-unrecorded labels. Navigation changes are limited to correct family counts and application-specific/context links, including `이 클래스 신청 보기`; preserve existing settings/link/retention/returns discoverability without a global menu redesign.

**Tests:** real PostgreSQL union/pagination/snapshot behavior; >20 families and boundary siblings; same-child status/class predicate; modern none vs legacy; all/matching/global count distinctions; no aggregate multiplication; cancelled-class pending inclusion; shrinking last page and filter reset; no cross-submission phone grouping. Verify ledger error is not zero.

**Desktop E2E:** filter/page/expand/detail/back preserves the same family card and class context; global pending family badge matches the server definition; no hidden PII in HTML/RSC; 0 data, 0 matches and failed read are distinct.

**Mobile Safari E2E:** automated 360/390 and actual Safari: all three state axes/amounts stay visible, no table overflow, touch expansion differs from detail navigation, and back restores filters/page/anchor. Verify 768px transition as well.

**Risks:** split families, misleading badge units, accidental PII or miscomputed availability. **Rollback:** restore child-list/count consumers together, labelled as child counts, and keep old URLs/records unchanged. Remove only new UI/query use; no family data is merged or deleted.

### Phase 4 — Consolidated family review and authoritative detail reads

**Goal:** provide the complete family review surface and a validated ledger/history without changing financial-write semantics. Owns read portions of INT-20/21/24/30 and consent/retention/role boundaries.

**Files:** M `R/submissions/[id]/page.tsx`, `R/[id]/page.tsx` (context links only), `L/queries.ts`, `L/ledger-summary.ts`; N `L/detail-queries.ts`, `R/_components/application-review-card.tsx`, `R/_components/ledger-summary.tsx`, `R/submissions/[id]/loading.tsx`, `R/submissions/[id]/error.tsx`, `U/detail-queries.test.ts`, `E/integrated-ux-family-detail.spec.ts`; extend `U/ledger-summary.test.ts` and `U/navigation.test.ts`.

**Components / separation:** R replaces page-local queries/sums with the authorized detail/ledger projection. Batch candidate/retention reads where possible, preserving existing eligibility and no automatic child linking. U orders ① child review/consent/request/retention, ② bank ledger/return history, ③ existing confirmation surface; show original submitted text distinctly from a later reviewed reservation memo. Preserve existing forms and child-action links while later phases integrate them. Read-only child selection hints are not approval. Keep old child detail fully working and do not redirect yet.

**Tests:** detail minimization/authorization, all siblings/statuses, photo decline vs withdrawal history, versioned original confirmation/consent text, purged placeholders, no safety info in lists, requested-child candidates, existing reservation/payment and retention links. Validate Q unknown for malformed modern quote and ledger conservation after partial confirmation/return; post-confirmation Refund never increases A.

**Desktop E2E:** section order, child deep-link opens/focuses the authorized child, detailed consent/retention/history reachable, old child route still operational, bank/confirmation forms retain existing behavior.

**Mobile Safari E2E:** automated 360/390 and actual Safari: long consent disclosure and request text, document reading order, VoiceOver labels, deep-link focus, ledger wrapping and no obscured sections/actions with the keyboard open.

**Risks:** exposing detail PII in list/shared clients, unknown quotes treated as free, incomplete original-content parity. **Rollback:** restore the original family detail/read path and old child links. Since no new write behavior exists, all ledger/consent/resolution/history records remain intact and no redirect must be undone.

### Phase 5 — In-context price and safe link issuance/composition

**Goal:** complete Area 1's direct modern single-class issue and opt-in multi-class management, with atomicity and safe retries. Owns INT-01–07 and relevant INT-25–27/29/30.

**Files:** M `C/actions.ts`, `C/[id]/page.tsx`, `C/_components/application-link-card.tsx`, `R/actions.ts`, `R/groups/page.tsx`, `R/groups/[id]/page.tsx`, `R/groups/group-create-form.tsx`, `R/groups/group-edit-form.tsx`, `R/groups/group-link-button.tsx`, `S/groups.ts`, `S/links.ts`, `L/link-queries.ts`; N `C/_components/application-price-form.tsx`, `C/_components/multi-class-link-composer.tsx`, `C/_components/link-impact-confirmation.tsx`, `U/class-link-issuance.test.ts`, `I/class-link-issuance.test.ts`; M `U/admin-actions.test.ts`, `U/phase20-groups.test.ts`, `U/links-and-resolve.test.ts`, `E/integrated-ux-class-links.spec.ts`.

**Components / separation:** A implements the narrow price action and operation-key/revision/transaction design under API; refactor transaction helpers only as needed, preserving legacy public/upgrade semantics. U shows inline price save and refreshed readiness, then `신청 링크 발급`. Keep returned token/address in memory through the current-page refresh, but reconcile it with the current active Link ID so a concurrent replacement/stop cannot leave a stale copy button. `MultiClassLinkComposer` starts with the current class, checks each explicit price, and reuses existing group editing. Group pages and class context share the same operation behavior. Confirm replace/stop/resume/legacy upgrade with their distinct SPEC text, affected classes and cancel action.

**Tests:** rollback between group creation/link insertion; duplicate same-operation calls, conflicting payload and independent stale issues; two admins; response loss; replace replay after a later stop; same-page refresh and raw-token loss on remount; no plaintext persistence; never mutate unrelated scopes. Price save preserves all other class fields and existing quote/payment data. Test amountless legacy with null price still open until explicit upgrade, pre-/post-upgrade submissions, group removal during public submit and token revocation races.

**Desktop E2E:** price → one-click single-class issue → visible issuer/time/address → copy/open → revisit metadata only; optional multi-class composition; cancel/execute each warning; lost response reconciles metadata without a second group/token. Open the public page using existing forms, without generating a test submission automatically.

**Mobile Safari E2E:** automated 360/390 and actual Safari: inline numeric price input, long scope dialog, cancel/focus restoration, copy denied/manual fallback, new tab and returning to the class context. Preview label/closed public behavior and authorized synthetic-only behavior remain distinct.

**Risks:** distributed URL invalidation, duplicate groups, stale raw address, legacy auto-upgrade and lock inversion. **Rollback:** revert new action entry points and transaction-helper changes together to existing group/legacy management. Preserve issued groups/hashes/membership/explicit prices; existing group pages can manage them. Never reactivate an old token, unset prices, rewrite quotes, or rotate a link to reverse deployment. A response-lost token remains unavailable; only a later explicit replacement supplies another.

### Phase 6 — Three-step guardian input and safe errors

**Goal:** complete Area 2 while retaining existing payload/storage modes and public capability boundaries. Owns INT-08–17/22 (submission)/25–29.

**Files:** M `P/[token]/page.tsx`, `P/[token]/_components/reservation-application-form.tsx`, `P/[token]/actions.ts`, `P/group/[token]/page.tsx`, `P/group/[token]/group-application-form.tsx`, `P/group/[token]/actions.ts`, `P/companion/[token]/page.tsx`, `L/public-queries.ts`; N `P/_components/application-wizard.tsx`, `P/_components/class-selection-step.tsx`, `P/_components/guardian-children-step.tsx`, `P/_components/consent-review-step.tsx`, `P/_components/child-draft-card.tsx`, `P/_components/public-class-card.tsx`, `X/step-indicator.tsx`, `L/application-draft.ts`, `L/field-errors.ts`, `U/application-draft.test.ts`, `U/field-errors.test.ts`, `E/integrated-ux-guardian.spec.ts`, `E/support/integrated-ux-guardian.ts`; M `U/group-application-form.test.ts`, `U/group-public-action.test.ts`, `U/public-action.test.ts`, `U/public-queries.test.ts`, `E/phase18-reservation-application.spec.ts`, `E/phase20-application-group-siblings.spec.ts`, `E/phase20-application-finance-returns.spec.ts`, `E/phase20-companion-repeat-privacy.spec.ts` for changed interaction selectors/steps only.

**Components / separation:** U adds the memory-only wizard/draft/consent/focus interaction specified under UI. R supplies the minimal enriched class cards for normal, upgraded, group and companion routes. A adds fixed-message guardian/child field errors and coarse safe outcome types; allowlist only known schema paths and bounded child indices. Keep validation schemas/rules unchanged; map messages rather than returning raw Zod issues or submitted values. Existing cores, repeat-child endpoint and completion/security modules remain unchanged unless a demonstrated compatibility defect requires separately reviewed work within these constraints.

**Tests:** stable child keys after middle removal, add/remove bounds, one assignment per child, candidate removal/no silent reassignment, shared required-scope reset and independent optional values, no auto consent, late/failed repeat lookup, unchanged identity/read-only profile behavior, cross-step errors with snapshot mapping and preserved values. Assert exact three input steps, no persistence from next/back/Enter, final all-or-none submit, pending/transition duplicate suppression. Preserve atomic failure/races for removed class, revoked token and purged child. Inspect HTML/RSC and payloads for public minimization; retain legacy amount-free completion and modern self-only result.

**Desktop E2E:** all four modes (legacy, upgraded old URL, new group single/multiple classes, companion); final review edit/back; required and optional consent; server validation and network failure; closed access hides the form; success → full-document result → back/forward/reload does not restore PII or a live submit form. Existing Preview suite assertions remain; do not widen admission to run the new specs there.

**Mobile Safari E2E:** automated 360/390 and actual iOS Safari: phone keypad, date picker/invalid future date, software-keyboard visibility, multi-child disclosure focus, long original consent, Enter behavior, touch correction from summary, clipboard result guide, back/forward/BFCache after successful submission. Use VoiceOver on step/error/consent targets.

**Risks:** wrong child consent/error binding, hidden browser validation, pre-submit price leakage, stale device identity and cache-restored PII. **Rollback:** revert wizard/public-read/error-contract consumers together and restore long-form wrappers/payload adapters. Keep prior submissions, quoted amounts, consent snapshots, invites and cookies unchanged. Phase 1 completion still consumes the existing result contract; never resubmit/convert historical applications during rollback.

### Phase 7 — Same-page bank records, resolution and shared returns

**Goal:** finish family review → actual deposit/return/resolution → current balances on one page before changing confirmation selection. Owns INT-19–21/24/29/30 financial-record portions.

**Files:** M `R/actions.ts`, `R/submissions/[id]/page.tsx`, `R/submissions/[id]/deposit-form.tsx`, `R/_components/application-resolve-form.tsx`, `R/returns/return-form.tsx`, `R/returns/page.tsx`, `L/detail-queries.ts`; N `R/submissions/[id]/workflow-controller.tsx`, `R/_components/application-return-card.tsx`, `L/return-queries.ts`, `U/workflow-controller.test.ts`, `U/return-queries.test.ts`, `I/workflow-races.test.ts`, `E/integrated-ux-ledger.spec.ts`; M `U/admin-actions.test.ts`, `U/phase20-finance.test.ts`, `E/phase20-application-finance-returns.spec.ts`. Reuse guarded `E/phase20-postgres-races.spec.ts` without changing its admission.

**Components / separation:** A coordinates existing financial/resolution actions, typed safe errors/receipts, invalidation and refresh. Preserve finance core calculations and idempotency fields. `WorkflowController` keeps drafts keyed by application ID, freezes an unresolved financial attempt, and prevents confirmation against unrefreshed values. U places child-specific reject/requested-cancel reasons with review, bank notification separate from actual payer/amount/KST dates, and Q/D/P/R/T/A with same-page return history. Reuse `ReturnForm`/return cards against the same obligations from family and full returns workbench; label `반환 이체 기록`. Retain partial and completed history and contextual return navigation; never describe the button as executing a bank transfer.

**Tests:** explicit synthetic fixture family quotes 40,000 + 60,000 KRW (test values only): partial deposits 30,000 + 70,000; actual payer mismatch; no guardian notification; reject the 60,000 child so R=60,000/A=40,000; return 20,000 so T=20,000/R=40,000/A=40,000. Assert all conservation terms, original Q and no Payment/Refund/Revenue before confirmation. Add excess/late deposits, same-key replays, changed-attempt payload blocked, response loss/refresh failure, two-admin deposit/return/resolve, over-return/stale obligation rejection, and read-after-write on both return entry points.

**Desktop E2E:** review/reason → actual bank save → automatic ledger/obligation refresh on the same page; retained review drafts; no manual browser refresh required; partial returns through either entry point share history. Failed refresh shows stale state, not a new available balance or automatic retry.

**Mobile Safari E2E:** automated 360/390 and actual Safari: numeric amount and KST datetime input, keyboard-safe inline errors, long ledger/history, accessible live success, uncertain-result retry using the same transaction identity, unchanged unprocessed sibling drafts and return-to-list position.

**Risks:** duplicate financial rows, false success from stale projection, sibling resolution or return fund reuse. **Rollback:** remove coordinator/action adapters and restore the prior separate deposit/child/return UI, reverting contracts with consumers. Preserve every deposit, idempotency key, obligation, completed return, reason and processed status. Never delete/compensate a recorded transaction as deployment rollback; old child routes remain a fallback until Phase 8.

### Phase 8 — Explicit selected confirmation and integrated handoff

**Goal:** finish one-page confirmation safely, then consolidate modern child-route entry after parity. Owns INT-20–24/30 and final INT-01–30 regression.

**Files:** M `R/submissions/[id]/confirmation-form.tsx`, `R/submissions/[id]/workflow-controller.tsx`, `R/submissions/[id]/page.tsx`, `R/_components/application-review-card.tsx`, `R/_components/application-confirm-form.tsx`, `R/_components/deposit-confirm-button.tsx`, `R/[id]/page.tsx`, `R/actions.ts`, `L/detail-queries.ts`, `L/navigation.ts`; N `E/integrated-ux-confirmation.spec.ts`; M `U/admin-actions.test.ts`, `U/confirm.test.ts`, `U/workflow-controller.test.ts`, `U/phase20-finance.test.ts`, `U/navigation.test.ts`, `I/workflow-races.test.ts`, `E/integrated-ux-family-detail.spec.ts`, `E/integrated-ux-ledger.spec.ts`, `E/phase18-reservation-application.spec.ts`. Reuse existing reservation/payment/refund/revenue/retention/role suites in their allowed environments.

**Components / separation:** U starts selection empty and requires an explicit existing/new Child choice; requested-child/candidate hints do not silently select or overwrite an existing Child. Provide reviewed per-child memo drafts with the existing safety-information exclusion guide. Show selected n, fixed quotes, S, server A and B beside `선택한 아이 {n}명 예약 확정`. Existing overbooking warning has target/class/capacity/current count and binds to the exact selection/Child choice; changing context resets acknowledgment and the server rechecks after locking. During that warning, use one clear confirm-overbooking action rather than two competing primary actions.

A passes one selected batch to the unchanged finance confirmation core, retains all-or-none results and actual mapping/reservation links, refreshes server data and removes only processed choices. Reconcile concurrency/unknown outcomes by actual state without automatic re-confirmation. Keep insufficient-funds and other block reasons separate; enough A is not a promise that duplicate/class/child/capacity checks passed. Legacy uses its original timestamp-only deposit/confirmation core and conditional manual-payment link. Enable authenticated temporary modern-child redirect only after review, consent/history, reject/cancel, returns, retention and memo functionality are all available on the family page.

**Tests:** empty/subset/all selection; explicit new/existing choice, no implicit auto-link; S/A/B; insufficient available amount despite sufficient total deposits; atomic failure of one selected child; unselected sibling unchanged; exactly one mapping per application and correct Payment totals; two-admin confirmation, confirm vs return/purge, competing last seat, duplicate/inactive/purged/ownership invalid cases; changed selection invalidates overbooking confirmation. In the Phase 7 fixture, confirming only the remaining 40,000 child yields D=100,000, P=40,000, R=40,000, T=20,000, A=0; no reuse of the returned/held money. Test manual post-confirmation partial/full refund via existing limits and unchanged Revenue rules. Test legacy no Payment and old bookmarks/auth/missing/foreign-child focus handling.

**Desktop E2E:** complete class price/link → guardian three-step submission → ADMIN family filter/review → deposit → selected confirmation, checking database records and Payment links. Include modern/upgraded/legacy and multi-class/companion boundaries, reason/return workflow, two ADMIN sessions, overbooking reset and filter/page/card return restoration. Run the full traceability matrix and core regressions before marking the integrated feature done.

**Mobile Safari E2E:** automated 360/390 and actual Safari: the same full journey, one-child selection from siblings, explicit Child choice, deposit refresh before confirmation, live result and surviving sibling draft, overbooking confirmation/focus, clipboard/new-tab, back/forward privacy and original-route focus. Desktop/Safari parity includes no overflow or hidden bank/confirmation state.

**Risks:** duplicate Reservation/Payment, money allocated from returns, implicit child selection, stale overbooking acknowledgment or redirect with missing parity. **Rollback:** revert Phase 8 UI/action contract changes and the temporary redirect first, restoring direct child-detail access and earlier family controls. Keep all committed Child/Reservation/Payment/PaymentItem/consent/mapping/allocation/Refund records and resolved states. Existing server checks prevent replay. Deployment rollback never cancels reservations, deletes payments, changes quotes or reopens processed applications.

### Release and rollback gates

- A phase is reviewable only with its file diff, test results, desktop/mobile WebKit evidence, actual Safari checklist and explicit residual risks. Run QA and Review in their read-only roles; all fixes return to BUILD. No implementation phase is approved by this document's existence.
- Roll back application commits in reverse dependency order, including their changed contract consumers and tests. Retain old operational routes until Phase 8 parity; revert its temporary redirect before rolling back earlier family infrastructure. No DB rollback, compensation transaction, data conversion, raw-token restoration or guard relaxation is part of the rollback procedure.
- Before any later SHIP action, verify the actual schema-change result is **no schema change**, required checks, allowed environment and tested revision. Existing Production/schema human gates and separate approval rules remain in force. This task does not request SHIP or deployment.
- Open business questions for this scope: **none**. Technical choices are specified above. Unavailable test environments are future verification prerequisites, not permission to relax guards. Free/on-site payment exceptions, broader retention, transaction correction/reopening and automatic privacy destruction stay outside this PLAN.
- Next step after review is explicit approval of this integrated PLAN, then Phase 1 through the required `yaho-build` developer subagent. Stop here for this PLAN-only request.
