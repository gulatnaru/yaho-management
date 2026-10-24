# Task

Phased implementation PLAN — admin reservation applications UX redesign.

- Status: proposed PLAN for review; no implementation approval is implied.
- Date: 2026-10-20.
- Input: [UX-REDESIGN-ADMIN-APPLICATIONS-SPEC.md](UX-REDESIGN-ADMIN-APPLICATIONS-SPEC.md), read in full (638 lines).
- Repository baseline: `feature/phase21-ai-service`, HEAD `5eb19df`. The SPEC was already untracked when planning began; preserve it. Do not treat existing AI work or its approvals as approval for this redesign.
- This task writes only this PLAN. No application code, tests, schema, migration, settings, deployment, commit, or PR changes are included.
- Authority: current user request → REQUIREMENTS → DECISIONS → ARCHITECTURE → AGENTS → existing implementation. The SPEC has no Open Questions; the technical choices below are proposals for PLAN review.

## Goal

Make a family submission the default unit of admin application work, while keeping each child's application, consent, reservation, and financial allocation independent. The completed flow is `① 신청 확인 → ② 입금 확인 → ③ 예약 확정` on one family detail page. Give links, settings, retention, and pre-reservation returns clear menu homes, and complete the SPEC's parent application flow without changing business policy.

Deliver eight sequential, separately reviewable and shippable phases, ordered by increasing risk: navigation/copy → family reads → detail reads → completion presentation → link management → parent submission → ledger operations → reservation/payment confirmation. Each phase must work with the last shipped phase; none requires an unfinished later phase. These are redesign delivery phases, not replacements for the repository's existing Phase 18/20/21 numbering. Open only one implementation phase at a time.

### Invariants in every phase

1. **No DB migration in any phase.** Do not change `prisma/schema.prisma`, `prisma/migrations/**`, constraints, indexes, or seeds, and perform no rollout-time data rewrite. Existing authorized runtime operations continue writing the existing models through their current business cores. No backfill, synthetic Submission creation, price inference, token rotation on deployment, or schema deployment step. Performance work must first use bounded reads and existing indexes; an index migration would require a separate, explicitly rescoped PLAN.
2. **Preserve all permissions.** Applications, family counts/details, prices, links/groups, actual deposits/returns, settings, and retention remain ADMIN-only. Preserve MANAGER's existing nonfinancial operations and TEACHER's assigned-resource scope. Preserve current account/auth-version/password-change checks. Menu visibility never substitutes for server authorization.
3. Preserve the existing Zod validation, transaction boundaries, lock ordering, conditional writes, uniqueness, idempotency, and reservation/payment/refund/revenue rules. Reuse existing server cores; do not implement financial decisions in components.
4. A family is one `ReservationApplicationSubmission`, never a phone/name match. A legacy application with `submissionId = null` is one display card, not a new persisted family. Separate submissions and companion families remain separate.
5. Preserve collection fields, consent text/version and child-specific results, optional refusal, retention scope/period/batch limits, and purged-state restrictions. Do not reconstruct purged identities from financial records.
6. Existing public URLs and capabilities keep their scope, lifetime, revocation, environment checks, and storage rules. No customer account, new recovery mechanism, automatic bank operation, or AI activation is introduced.

## Current State

| Area | Verified implementation | Design implication |
|---|---|---|
| Navigation | `app/(admin)/layout.tsx` builds flat role-specific links and queries pending **child** applications only for ADMIN; `nav-drawer.tsx` renders desktop horizontal nav/mobile drawer | Introduce logical groups without changing roles or desktop navigation style. Switch the count only when the family query ships. |
| List | `lib/reservation-applications/list.ts`, `queries.ts`: child-based `skip/take`, status filtering, nearest-class ordering, duplicate detection | Grouping an already paginated list is incorrect. Pagination and totals must operate on family identities first. |
| Detail | Child `[id]/page.tsx` contains consent, retention, resolve, and legacy confirmation; submission page contains ledger and modern confirmation | Add complete read detail before relocating actions or redirecting child URLs. |
| Ledger | `ledger.ts` computes availability from deposits minus **all** allocations; `server/reservation-applications/finance.ts` implements deposits, returns, resolve, and atomic confirmation | Expose a consistent server summary; preserve allocation semantics and existing locks. |
| Action/forms | `actions.ts` authenticates ADMIN. Deposit/return forms have request keys. Modern confirmation initially selects all children; warning/general buttons coexist; several actions revalidate only some affected pages | Improve action result contracts and state refresh before making final confirmation the primary workflow. |
| Links | Class card, groups pages, and existing server link/group cores; groups home lists only recent groups; class query can return one matching link | Read all relevant link identities, support legacy and group scopes, and avoid arbitrary `findFirst` selection. |
| Public | Legacy form and shared group/companion form; completion cookies, device capability, consent records, three copy targets and notification/invitation actions already exist | Restructure presentation and drafts around existing submission/capability contracts; retain working behavior rather than replacing cores. |

Preserved decisions include ADR-013/014/017/022 (minimum exposure/navigation/order), ADR-023/043/044/058 (reservation, capacity, purge concurrency), ADR-052–058/060 (applications, consent, privacy, legacy and finance), and ADR-030/051/059/061/062 (environment/release/AI gates). After design approval, Phase 1 records only the approved presentation changes in official documents; it does not rewrite accepted business policy or claim later phases are already implemented.

## Data Model

**Migration requirement: none, for all eight phases.** Existing models provide the required data:

| UX value | Existing source and rule |
|---|---|
| Modern family identity | `ReservationApplicationSubmission.id`; hydrate all its applications, including siblings outside the active filter |
| Legacy identity | Discriminated display key `legacy:<ReservationApplication.id>`; modern key `submission:<id>` prevents identity collisions |
| Quote | `ReservationApplication.quotedAmount`, captured from ADMIN-set `ClassSchedule.applicationPrice`; never fall back to `Program.defaultPrice` |
| Notification | `Submission.depositNotifiedAt`, independent of actual bank records |
| Actual bank records | `ApplicationDeposit` with amount, payer, actual/confirmation timestamps and ADMIN |
| Payment linkage | Payment-target `FundAllocation` and `ReservationApplicationPaymentMapping` → `PaymentItem` → `Payment` |
| Return obligation/history | `ReturnObligation`, its funded allocations, and `ApplicationReturn`; no new Refund meaning |
| Review/processing | Existing per-child statuses, consent booleans/version, requested/confirmed Child, resolution and purge fields; no persisted review-complete flag |
| Links | `ReservationApplicationLink`, `ReservationApplicationGroup/Class`, `upgradedLegacyClassScheduleId`; Group has no user-defined title |

### Authoritative read contracts

- `FamilyListResult`: family rows, `totalFamilies`, `totalChildApplications`, `matchingChildApplications`, page/totalPages, applied filters, and a separate global pending summary `{ families, childApplications }`. `totalChildApplications` counts **all** children in matching families; `matchingChildApplications` counts children satisfying the combined child predicate. Label these scopes explicitly. Global pending child count counts only `SUBMITTED` applications.
- `FamilyListRow`: identity/kind, display-safe guardian/child names, submitted time, child/class summaries, per-status counts, duplicate flags, notification axis, bank-record axis, and server ledger summary for modern submissions. No phone, birth date, free text, or consent bodies in list props/HTML/RSC.
- `ApplicationWorkflowDetail`: discriminated modern/legacy detail, complete authorized child review data, consent snapshot/version, original requested-child information, processing/retention metadata, ledger/history, and existing reservation/payment links. Do not send the whole Prisma record to client components.
- `LedgerSummary`: `Q` quote total; `D` deposits; `P` payment allocations; `R` outstanding obligated returns; `T` completed returns; `A` available amount. Use the existing `availableDepositAmount` and allocation validation. Return allocations already include completed returns, so never subtract `T` again from that computed availability. Check `D = A + P + R + T` server-side. An inconsistency is an error, not a clamped zero/success display.
- Legacy quote/amount/notification capabilities are explicitly unavailable, not zero or false. A malformed modern row with a missing quote shows an actionable data error and cannot pass modern confirmation; do not silently classify it as legacy. A partially unavailable quote total is unknown, not a sum with null treated as zero.
- `S` (selected pending-child quotes) and `B = max(0, S − A)` may update locally from server-provided values for feedback. The server alone authorizes spending and recomputes all values at commit.

### Family query design

1. Parse GET input with Zod/strict allowlists. Retain existing `status=SUBMITTED|CONFIRMED|REJECTED|CANCELLED|all` semantics. Add `classScheduleId`, `notification=all|received|none|legacy`, and `bankRecord=all|recorded|none|legacy`; keep `page`. Reset page to 1 on filter change.
2. Build one child predicate: status **and** optional class must match the **same** `ReservationApplication`. A family's notification/bank predicates are applied separately to that family. Modern `none` excludes legacy; legacy is not guessed to be unpaid/unnotified. Contradictory filter combinations produce a genuine empty result.
3. In PostgreSQL, build eligible modern submission keys and eligible legacy application keys with a parameterized `Prisma.sql`/`$queryRaw` read, `UNION ALL` the two kinds, compute their ordering keys, and paginate the resulting keys at **20 families**. No unsafe SQL/string interpolation, JS grouping after child pagination, or loading every application's PII into Node for sorting.
4. For `SUBMITTED`, order by the earliest matching pending child's class start, then submission time, then stable kind/ID. Keep pending applications of started/cancelled classes visible. Other statuses order by recent submission, with a stable kind/ID tie-breaker.
5. Hydrate all children and needed ledger aggregates for those selected family keys in bounded batched Prisma reads. Determine duplicate flags using the existing same-class/name/guardian-phone rule across the required comparison set, including beyond this page; keep comparison PII server-only. Aggregate money by target before joining, avoiding multiplicative sums from deposits × applications × returns.
6. Obtain key page, totals, and hydration in one read transaction with a consistent snapshot. Clamp an out-of-range page against current totals; no phantom empty page after the last pending family is processed. Global badge uses the same pending-family definition, independent of list filters; independent requests may naturally see different snapshots.
7. Add local PostgreSQL integration coverage for SQL results, stable ordering, family boundaries, and both counts. Inspect query shape/plans on synthetic datasets using existing indexes, without declaring an unmeasured latency target or adding an index migration.

DB constraints continue enforcing existing relationships/uniqueness/checks. Authorization, supported values, capability scope, and latest business eligibility remain server rules; the UI adds no substitute constraint.

## API

Use App Router Server Components and existing Server Actions; no new public API, bank endpoint, or independently deployed service.

| Contract | Planned handling |
|---|---|
| Admin reads | New server-only family/detail/link/return query modules authenticate with `requireAdminPrincipal()` before reading. Page guards remain too. No shared cross-role cache for PII or financial data. |
| Class reads | Keep ADMIN-only reads in the ADMIN branch **before querying**, not merely before rendering. MANAGER/TEACHER class props/HTML/RSC must not contain prices, application links, counts, or bank state. |
| Deposits/returns | Reuse `recordApplicationDeposit`/`recordApplicationReturn` and their cores. Add typed field errors, safe submitted values, explicit success/ambiguous outcome handling, and current financial result. Reuse one idempotency key for the same attempted transaction until confirmed success; create a fresh key only for a deliberately new transaction. |
| Resolve | Reuse existing child reject/cancel actions and financial resolve core. Derive the affected submission server-side and invalidate its detail, list/badge, and returns views. Require the existing child-specific reason. |
| Modern confirmation | Reuse `confirmApplicationSubmission` and `confirmApplicationSubmissionCore` with explicit selected child IDs, existing/new Child choice, per-child memo, and existing bound overbooking confirmation. Preserve its single atomic transaction and payment mapping. |
| Legacy confirmation | Reuse `confirmApplicationDeposit` and `confirmReservationApplication`; confirmation records a timestamp and creates no Payment. Keep manual payment registration only when no payment exists. |
| Link/price actions | Reuse group/link issue, stop, edit, and explicit legacy-upgrade cores. Add a narrow ADMIN/Zod-checked price-only action in existing class actions, using existing class-update eligibility/conditional-write rules. Never submit a stale full class form just to change price. |
| Public submission | Retain legacy vs group/companion submission actions, payload fields, atomicity, cookies, consent versions, limits, and capability validation. Add allowlisted field/child error paths for actionable validation without echoing arbitrary payloads, internals, or tokens. |
| Public notification/invite | Retain existing completion-authorized actions and idempotency; notification never creates deposits, reservations, or payments. No capability broadening for presentation convenience. |

After a mutation, revalidate the affected family/legacy detail, application list, returns workbench, and relevant count consumers; confirmation also refreshes affected reservation/class/payment views as appropriate. A client workflow coordinator refreshes the Server Component result and reconciles drafts by application ID. Refresh failure must leave a visible stale/error state; it must not announce current balances or trigger an automatic second write. After ambiguous responses, reload/reconcile stored records and reuse the original request identity before offering another attempt.

### URL and navigation compatibility

Menu relocation is logical; retain existing URLs as canonical routes:

| Menu home / purpose | Canonical route |
|---|---|
| 신청·예약 → 예약 신청 처리 | `/reservation-applications` |
| 신청·예약 → 예약 관리 | `/reservations` |
| 클래스 운영 → 신청 링크 관리 | `/reservation-applications/groups` and `/groups/[id]` under the same prefix |
| 결제·정산 → 예약 전 입금 반환 | `/reservation-applications/returns` |
| 운영 관리 → 입금 계좌·안내 채널 | `/reservation-applications/settings` |
| 운영 관리 → 개인정보 보관·파기 | `/reservation-applications/retention` |
| Modern family workflow | `/reservation-applications/submissions/[id]` |
| Legacy workflow | `/reservation-applications/[id]` for `submissionId = null` |

Other domains retain their SPEC menu locations and current URLs: dashboard, children, classes/programs/teachers, payments/revenue, accounts, both distinct AI screens, and own-password/teacher-profile links. No new alias routes, fixed sidebar, or permanent redirect is needed for the four moved management functions.

Only in Phase 8, after feature parity, an authorized request to a modern child URL uses a **temporary** server redirect to its actual submission detail with `applicationId=<id>#application-<id>`. Validate that focus IDs belong to the displayed submission. Do not redirect a legacy application into an invented Submission. Authenticate before ID resolution or redirects; preserve missing/forbidden behavior.

Preserve list status/page/class/bank/notification and stable card anchor through allowlisted, non-PII navigation context. Construct internal return links from parsed fields; never trust arbitrary `returnTo` URLs. Preserve authorized class/returns entry context as well. Public `/apply/[token]`, `/apply/group/[token]`, `/apply/companion/[token]`, and `/apply/complete` stay unchanged. Do not add PII, money, consent, payer names, or capability tokens to new query parameters/history state.

## UI

### Components and server/client boundaries

- Server: role-filtered navigation model, data access, read summaries, family cards, child review/consent/history, retention metadata, link/return lists, and existing reservation/payment links.
- Client islands: drawer/submenu interaction, focused disclosure behavior where needed, workflow drafts/selection and mutation coordination, existing action forms, clipboard controls, and parent wizard. Native disclosure is sufficient for ordinary list expansion.
- Reuse existing shadcn-style `Card`, `Button`, `Badge`, `Disclosure`, `Input`, `Label`, `Select`, `Checkbox`, and `Textarea`. Do not require a new component library or rewrite common UI primitives for this feature.
- Desktop remains horizontal grouped navigation; mobile uses the same authorized labels/order in the drawer with the current group expanded. Match the most specific route, so settings/returns/groups are not incorrectly marked as application processing. Empty role groups are omitted. Closed submenu/drawer controls are not focusable.

### Mobile card layout approach

Use **one semantic card tree for both mobile and desktop**, not a hidden table plus duplicated mobile DOM. Below `md` (768px), family, nested-child, link, and return cards stack vertically. At/above `md`, arrange summary sections within the same card with grid/flex; preserve the same reading order and all three state axes. No column hiding, mandatory horizontal scrolling, or nested clickable-card links.

- Each family `<article>` has a heading, identity/time, class summary, separate notification/bank/reservation labels, contextual duplicate/return indicators, and separate expand/navigation controls. Child rows are vertical items within a disclosure. Never put a button inside a link/summary interaction.
- Full-width stacked actions below `md`, auto-width grouped actions above it. Interactive controls have at least 44px touch height. Use `min-w-0`, wrapping, and break rules for long names, currency, account numbers, and URLs; apply the existing date/time input overflow convention.
- Detail sections are in document order ①/②/③, with anchors and focusable section headings. Mobile has no persistent footer obscuring the keyboard, field errors, or balances. Desktop can place a summary beside the flow using CSS, without changing reading order.
- Disclosures expose expanded state, preserve focus, and open the targeted child on arrival. A client controller may enhance the initial open state; the server validates the target. Stage transitions focus headings; invalid input focuses the first relevant field. Success uses a live status region; failures use a visible alert and field associations. State always has text, not only color.
- Check 360px, 390px, 768px, and desktop widths, long content, keyboard navigation, closed controls, and browser back/forward. Cards must show amounts/statuses/actions without page-level horizontal overflow. This exception applies to the SPEC's redesigned surfaces, not all other domain tables.

### Loading, empty, error, and draft states

List and detail routes get segment loading/error UI; links/returns get explicit loading/empty/failure states in their phases. Distinguish no applications from no filter matches; use the SPEC's exact copy and reset/retry actions. Failed reads are never rendered as 0 families or 0 available won. Form errors retain valid drafts and show affected child/field. Use the SPEC button dictionary and Korean status labels, including return reasons; list cards never execute financial/resolve/confirm actions.

The parent form has two input steps and an existing post-submit result: `① 아이·클래스 선택 → ② 보호자 정보·확인 및 동의 → ③ 신청 완료·입금 안내`. Drafts live only in component memory. Shared required confirmations fan out to every applicable child with the existing version; optional photo choices remain independently overrideable per child. Changed child/class scope requires reviewing the affected confirmations; newly added children do not inherit an unnoticed grant. No automatically checked historical consent or combined required/optional “agree all.”

## Tests

This is a verification design, not an execution report. Vitest covers read contracts, draft transforms, action authorization/validation, and existing cores. Browser tests cover actual interaction, HTML/RSC exposure, layout, focus, and navigation. Real PostgreSQL tests cover SQL and transaction races; UI disabling and mocked unit tests do not establish atomicity.

### Environment and verification gates

- For each implementation phase: targeted tests, `npm run lint`, and the repository-required regression suite. Before `npm run build`, check for a dev process using `pgrep -f 'next dev'` or equivalent independent of port. If one exists, skip build, use `npx tsc --noEmit` + lint + tests, and report that substitution. Do not run build against the dev server's `.next` cache.
- New local DB tests use an explicitly identified nonproduction test database, synthetic fixtures, and owned-row cleanup through the existing safety patterns. Never run them against an arbitrary `DATABASE_URL`, reset/truncate a shared DB, or print credentials/PII.
- Preserve ADR-059 and existing Preview runner guards: approved app/DB identity, matching deployment, schema compatibility, one run, signed/run-owned synthetic scope, and owned cleanup. No automatic CI E2E or general Preview public reception is added.
- Existing `phase20-postgres-races.spec.ts` requires the guarded Preview runner; do not present a plain local Playwright command as equivalent. Run it only through its approved guarded path. If unavailable, report the gate as unverified/blocked for shipping; a separately reviewed local equivalent may be planned, but do not remove its guard.
- Legacy public E2E and `phase18-retention-concurrency.spec.ts` remain dedicated-local tests, excluded from shared Preview where they can affect unrelated data or require closed public behavior. Keep their validation responsibility explicit. New browser suites are local by default; Preview classification requires its existing safety review, never relaxed guards.
- A phase is shippable only after applicable checks pass. Missing permitted DB/browser execution is a recorded release blocker, not a silent skip or a claimed PASS. This PLAN itself runs no application/DB/browser tests.

### Requirements-to-tests traceability

Paths below use the aliases defined in Implementation Order. “Reuse” means run existing coverage; a core test's existence is not evidence of execution in this task.

| Requirement / ADR basis | Required outcome | Positive / refusal / race cases | Level and planned location | Phase |
|---|---|---|---|---|
| UX-01/27/28; ADR-017 | Correct menu homes, names, old routes, and useful context links | ADMIN all groups; MANAGER/TEACHER only existing scope; direct booking presets; desktop/drawer parity; AI gates unchanged | unit `tests/unit/admin/navigation.test.ts`; browser `E/admin-applications-navigation.spec.ts` | 1, regression all |
| UX-02/03; SPEC list rules; ADR-060 | Family identity, page, and count accuracy | >20 families and boundary siblings; single-child families; same phone in two submissions; companion separate; legacy mixed in; processed last page | unit `U/family-queries.test.ts`; local PostgreSQL `tests/integration/reservation-applications/family-list.test.ts`; browser `E/admin-applications-family-list.spec.ts` | 2 |
| UX-04; SPEC combined filter rule | Status and class match the same child, family bank scope explicit | Child A has target status, child B target class: reject family; true same-child match; all siblings visible; contradictory/invalid filters | same family query/integration/browser tests | 2 |
| UX-05/24; ADR-013/055–058 | Minimum list exposure, correct legacy/purged labels | No phone/DOB/notes/consent bodies in list HTML/RSC; null money not 0; purged names never rebuilt; focused child detail | `U/family-queries.test.ts`, `U/detail-queries.test.ts`; `E/admin-applications-family-list.spec.ts`, `E/admin-applications-detail.spec.ts` | 2–3 |
| UX-06/08/09; ADR-060 | Notification, bank, confirmation independent; balances conserved | Notice/no deposit; deposit/no notice; 30+70 deposits for 40+60 quotes; excess 110 → R=10, A=100; allocations/returns not subtracted twice | `U/ledger-summary.test.ts`; reuse `U/phase20-ledger.test.ts`, `U/phase20-finance.test.ts`; browser `E/admin-applications-ledger-workflow.spec.ts` | 2–3, 7–8 |
| UX-07/14; ADR-053/060 | Same-page review, deposit, selection, result; correct Payment links | Review all consents; save deposit then confirm without navigation/reload; modern payment view; legacy no automatic Payment and manual registration only when absent | `U/detail-queries.test.ts`; reuse `U/admin-actions.test.ts`, `U/confirm.test.ts`; `E/admin-applications-detail.spec.ts`, `E/admin-applications-confirmation.spec.ts` | 3, 7–8 |
| UX-12/13; ADR-060 | Child resolve and partial/complete returns share one funded obligation | Required child reason; other sibling unchanged; late deposit after resolve; return20 of60 → R40/T20; both entry points; over-return and simultaneous returns refused | `U/return-queries.test.ts`, `U/admin-actions.test.ts`; reuse `U/phase20-finance.test.ts`; `E/phase20-application-finance-returns.spec.ts`, `E/phase20-postgres-races.spec.ts` | 7 |
| UX-10/11; ADR-023/044/058/060 | Explicit selection, atomic confirmation, latest eligibility/capacity | One child then sibling; selected batch all-or-none; stale child/status; inactive/purged child; duplicate reservation; invalid memo/missing choice errors; warning replaced and invalidated after selection change | reuse `U/phase20-finance.test.ts`, `U/confirm.test.ts`, `U/admin-actions.test.ts`; `E/admin-applications-confirmation.spec.ts`, `E/phase20-postgres-races.spec.ts`; local retention race reuse | 8 |
| UX-08–13; ADR-060 | Repeated/concurrent requests never spend a deposit twice | Two ADMIN confirmations; return vs confirmation; partial deposits vs resolve; duplicate keys; committed response lost then retry; conservation and Payment mapping verified in DB | reuse `U/phase20-finance.test.ts`; guarded `E/phase20-postgres-races.spec.ts`; `E/admin-applications-ledger-workflow.spec.ts` browser response-loss case | 7–8 |
| UX-15/16/17; ADR-052/060 | Correct link identity, explicit destructive changes, fixed old quotes | Single/multi groups, >50 historical entries, multiple groups per class, converted alias, no raw-token copy on revisit; copy does not rotate; issue failure retries existing group; price/group edits do not change old quotes | `U/link-management-queries.test.ts`, `U/admin-actions.test.ts`; reuse `U/phase20-groups.test.ts`; `E/admin-applications-link-management.spec.ts`, `E/phase20-application-group-siblings.spec.ts` | 5 |
| UX-18/19; ADR-054/056/060 | Two input steps, one atomic submit, child-specific current consent | Next does not write; edit/back retains memory draft; all mandatory false initially; optional child A/B differ; mandatory omission refused; added/changed child review; server field errors retain valid inputs | `U/application-draft.test.ts`, `U/group-application-form.test.ts`, `U/group-public-action.test.ts`, `U/public-action.test.ts`; `E/phase20-application-group-siblings.spec.ts`, dedicated-local `E/phase18-reservation-application.spec.ts` | 6 |
| UX-20; ADR-060 | Only authorized self completion shows money and notification | Three distinct copy targets; already-notified refresh/click idempotent; denied/expired completion has no child/money data; legacy does not acquire amount/payer/notice | `U/completion-guide.test.ts`, `U/phase20-completion-page.test.ts`; reuse `U/phase20-completion.test.ts`; `E/phase20-application-group-siblings.spec.ts` | 4, 6 |
| UX-21/22; ADR-052/060 | Public data minimization, device/companion ownership, no back/retry exposure | Inspect HTML/RSC before submit for absent price/capacity; invalid/closed links same message; stolen/expired/revoked capability; other-family/phone lookup denied; current consents; back/forward/BFCache and duplicate submit | `U/public-queries.test.ts`, `U/group-public-action.test.ts`, `U/complete-navigation.test.ts`; reuse `U/phase20-devices.test.ts`; `E/phase20-companion-repeat-privacy.spec.ts`, existing guarded PG races | 4, 6 |
| UX-23; REQUIREMENTS17; ADR-050/053/060 | No permission widening through any moved/new surface | MANAGER/TEACHER direct URL, query, action and HTML/RSC denied; disabled/stale account; ADMIN allowed; MANAGER class view contains no application fields; TEACHER assignment scope retained | reuse `tests/unit/auth/authorization.test.ts`; new query tests + `U/admin-actions.test.ts`; all new admin browser suites include role-boundary cases | every phase |
| UX-24; ADR-055–058 | Existing retention scope, limits, record preservation | Purged read UI; only eligible confirmed-application children; 1y/5y rules and existing batch caps; purge vs confirmation; no finance-derived PII restoration | `U/detail-queries.test.ts`; reuse `U/retention.test.ts`; dedicated-local `E/phase18-retention-concurrency.spec.ts` | 1/3 presentation, 8 regression |
| UX-25/26; UI-GUIDELINES; SPEC mobile/accessibility | Real card layout, usable focus, distinct error/loading/empty states | 360/390/768/desktop, long names/URLs, mobile keyboard, keyboard disclosures, failed clipboard, failed read vs 0, stale save/refresh and retained inputs | each affected browser suite; page/action query unit tests for failure contracts | every affected phase |

No new refund-policy/fee/tax/retention calculations are applicable: none is changed. No new DB-constraint/migration tests are needed because schema and migrations are excluded; retain existing regression tests instead. Browser layout assertions are not used to prove server rules, and repeated core tests are required only where the affected integration adds a new risk.

## Acceptance Criteria

1. Every UX-01–28 criterion is owned by the traceability table and the phases below. A phase acceptance gate covers only its delivered behavior; the redesign is complete only after Phase 8 and the full cross-phase regression.
2. Each phase can ship without unfinished routes/components or a migration. Each has a concrete revert path and leaves previous operational workflows accessible.
3. All existing permissions, account-state checks, legacy behavior, public capability boundaries, consent/retention rules, and financial/reservation invariants remain true.
4. Final ADMIN flow completes review → actual bank record → latest balance → explicit atomic confirmation on one family page, with correct return and reservation/payment links.
5. List page/count/filters operate on actual families and match the documented scope; no split family across pages or cross-sibling filter match.
6. Mobile/desktop cards, focus, error handling, query/back context, and SPEC terminology pass browser verification; unauthorized information is absent from HTML/RSC and action/read results.
7. Delivery evidence names the exact commit and environment/check results; no skipped DB race or browser gate is reported as passed. Planning completion alone does not satisfy implementation acceptance.

## Risks

| Cross-phase risk | Mitigation |
|---|---|
| Read redesign misstates money or joins multiply amounts | Shared server projection from existing allocations, separately aggregated sums, conservation assertions and DB-backed scenarios; no UI financial fallback |
| Large family/legacy union is costly without new indexes | Page identities first, batch hydrate, compare duplicates server-side, inspect plans on synthetic volume; keep schema immutable and report a measured blocker if unresolved |
| Menu movement accidentally exposes ADMIN data | One server-filtered model; ADMIN guard inside new query entry points; direct URL/action/RSC tests; no ADMIN queries in MANAGER/TEACHER branches |
| A partially delivered redesign removes old operations | Keep child/returns/class workflows until their replacements ship; defer modern child redirects until Phase 8; make each earlier phase additive or presentational |
| RSC refresh loses drafts or displays obsolete balances | Reconcile by stable application ID, keep valid drafts, invalidate warnings, distinguish stale data, and reload stored outcomes after ambiguous writes |
| A rollback reverses legitimate money/token changes | Revert application changes only. Persisted records, quoted amounts, link invalidations, and submitted consents remain authoritative; no compensating transactions or token resurrection |
| Unrelated AI branch changes contaminate delivery | At BUILD start recheck the actual branch/base and use a dedicated `feature/admin-applications-ux-*` branch/isolated checkout without discarding existing changes |

## Implementation Order

### Scope accounting and shared gates

| Phase | Increasing risk / independently shippable outcome | Estimated files, including tests |
|---|---|---|
| 1 | Presentation: menu homes, navigation, and terminology | 25–30 |
| 2 | Family read/query correctness: cards, filters, pages, counts | 13 |
| 3 | Detail read/PII scope: complete ordered review and history | 14 |
| 4 | Public completion capability presentation: guidance and controls | 8 |
| 5 | Link/price writes: management home and explicit issue workflow | 17 |
| 6 | Public submission/consent: staged input with existing atomic submit | 21 |
| 7 | Financial writes: integrated deposits, resolve, and returns | 16 |
| 8 | Reservation/payment writes: explicit atomic confirmation and child redirects | 17 |

File paths below use these exact prefixes to keep inventories readable:

- `A/` = `app/(admin)/`
- `R/` = `app/(admin)/reservation-applications/`
- `P/` = `app/(public)/apply/`
- `L/` = `lib/reservation-applications/`
- `U/` = `tests/unit/reservation-applications/`
- `E/` = `tests/e2e/`

`M` means modify an existing file; `C` means create a file. Counts include tests and documentation. Counts are estimates of files touched **within that phase**, not time estimates, and overlapping files are intentionally counted again in later phases. Existing tests listed only as “reuse/run” do not count as edited files. Do not pre-build a future phase's UI or services to make a phase appear independently shippable.

Each phase follows approved PLAN → developer `$yaho-build` subagent → independent `$yaho-qa` → `$yaho-review` → fixes as needed → normal `$yaho-ship` gates. This task performs only PLAN. Before BUILD, recheck approval and the baseline; before shipping, apply the existing CI/release/merge authorization rules. No phase authorizes deployment, Production writes, or merge by itself.

Rollback instructions assume that phase is the latest shipped release. If later phases already depend on it, first roll back those dependents in reverse order, or prepare a reviewed compatibility fix; do not delete a query/component still used by a later release. Use normal revert commits/redeployment, with no force push, DB restore, or data compensation.

### Phase 1 — Navigation, menu homes, and vocabulary

**Goal / risk:** Lowest risk: presentation and navigation only. Group the complete menu as specified, move the four management entry points out of the processing-list header, and normalize direct-booking/context labels without changing any action or query behavior. Until Phase 2, label the old badge explicitly as a pending **child application** count, not families.

**Files / estimated scope:** 25 base files (22 M / 3 C), up to 30 including at most five existing E2E selector/copy updates.

| Change | Files |
|---|---|
| M (2) | `A/layout.tsx`; `A/_components/nav-drawer.tsx` |
| C (1) | `lib/admin/navigation.ts` — typed, role-filtered navigation groups |
| M (7) | `R/page.tsx`; `R/groups/page.tsx`; `R/groups/[id]/page.tsx`; `R/settings/page.tsx`; `R/settings/settings-form.tsx`; `R/retention/page.tsx`; `R/returns/page.tsx` |
| M (3) | `A/revenue/page.tsx`; `A/revenue/loading.tsx`; `A/revenue/error.tsx` |
| M (7) | `A/reservations/page.tsx`; `A/reservations/new/page.tsx`; `A/reservations/_components/reservation-form.tsx`; `A/reservations/[id]/page.tsx`; `A/children/[id]/page.tsx`; `A/children/[id]/_components/child-history-card.tsx`; `A/classes/[id]/page.tsx` |
| M (3) | `REQUIREMENTS.md`; `docs/DECISIONS.md`; `docs/UI-GUIDELINES.md` — record approved UX direction and pending phase ownership, without changing policies |
| C (2) | `tests/unit/admin/navigation.test.ts`; `E/admin-applications-navigation.spec.ts` |

Potential existing assertion updates are limited to relevant navigation/title cases in `E/phase11-core-operations.spec.ts`, `E/phase12-class-reservation-operations.spec.ts`, `E/phase13-child-history.spec.ts`, `E/revenue-report.spec.ts`, and `E/phase20-application-group-siblings.spec.ts`; preserve their behavioral assertions. Recheck other affected label references during BUILD and report any scope expansion.

**Components / behavior:** Shared grouped navigation model, desktop submenus and mobile drawer; current section expansion; ADMIN's two separately named AI links; `직접 예약 등록`, `예약 내역 보기`, `결제 내역 보기`, and `매출 집계` consistency. Existing management routes remain canonical. Settings retains all six fields/import/HTTPS validation; retention retains its manual action and confirmation, not a new destructive control on detail.

**Tests / exit gate:** UX-01/27/28 and applicable UX-23/25/26. Verify all three roles, direct bookmarks, current-group matching, mobile focus/closed menus, desktop overflow at 768px, class/child booking presets, and unchanged AI guards. Reuse existing authorization, settings/config, and retention tests. Do not add business-rule tests for text alone.

**Risks:** Wrong active group due to overlapping URL prefixes; inaccessible nested nav; label-based test breakage. **Rollback:** Revert this phase's code and presentation-document changes; old URLs and action implementations already remain. No data or token action is needed. Phase 1 ships with the existing application list and processing screens.

### Phase 2 — Family list, exact filtering, pagination, and counts

**Goal / risk:** Low-to-moderate read/query risk. Make the family card the default at `/reservation-applications`, including legacy one-child cards, three independent state axes, and correct family/child counts. No write controls on cards.

**Files / estimated scope:** 13 files (4 M / 9 C).

| Change | Files |
|---|---|
| M (4) | `L/list.ts`; `R/page.tsx`; `R/_components/application-status-filter.tsx`; `A/layout.tsx` |
| C (3) | `L/family-queries.ts`; `L/ledger-summary.ts`; `R/_components/application-family-card.tsx` |
| C (2) | `R/loading.tsx`; `R/error.tsx` |
| C (4) | `U/family-queries.test.ts`; `U/ledger-summary.test.ts`; `tests/integration/reservation-applications/family-list.test.ts`; `E/admin-applications-family-list.spec.ts` |

**Components / behavior:** Server-rendered family card with child disclosure, status filter GET form, pagination, distinct initial-empty/filter-empty/error states, and class-scope removal. Implement the family query contract above and switch the global badge to `대기 N가족`; display pending child count separately. Until Phase 3 adds focused family review, each child-review link can use its working existing child-detail route; primary family navigation uses the existing submission page. Keep all siblings on a card and mark which match the filter.

**Tests / exit gate:** UX-02/03/04/05/06 and applicable UX-23–26/28. Real DB tests verify union ordering/pagination/counts and same-child predicates; browser tests verify expandable cards, query restoration, data minimization, mixed statuses, and every viewport. Test duplicate comparison across pages, no implicit family merging, null legacy amounts, notification without deposit, and amount conservation. Inspect read plans and query batching.

**Risks:** Family splitting, double-counted joins, mistaken legacy filters, heavy scans. **Rollback:** Revert Phase 2 to the existing child table/query/count wording; leave existing queries/components available for that release. This phase has no writes or generated data to undo. Phase 1 remains shipped.

### Phase 3 — Unified detail reads and ordered review surface

**Goal / risk:** Moderate read/PII risk, without changing mutation contracts. Show complete child review, consent, processing/retention information and server ledger summary in the existing submission detail, in ①/②/③ order. Keep old operational forms/entry points usable until their dedicated phases.

**Files / estimated scope:** 14 files (3 M / 11 C).

| Change | Files |
|---|---|
| M (3) | `R/submissions/[id]/page.tsx`; `R/[id]/page.tsx`; `R/_components/application-family-card.tsx` |
| C (5) | `L/detail-queries.ts`; `R/_components/application-workflow.tsx`; `R/_components/application-review-card.tsx`; `R/_components/application-ledger-summary.tsx`; `R/_components/application-history.tsx` |
| C (4) | `R/submissions/[id]/loading.tsx`; `R/submissions/[id]/error.tsx`; `R/[id]/loading.tsx`; `R/[id]/error.tsx` |
| C (2) | `U/detail-queries.test.ts`; `E/admin-applications-detail.spec.ts` |

**Components / behavior:** Shared server workflow shell with ordered sections, child review/consent disclosures, `tel:` contact, original quote and server financial projection, KST dates, history, retention-management link, and actual reservation/payment links. Link cards to a validated focused child. Reuse existing deposit/confirmation components as operational slots, reordered after review; keep current child resolve and global return entry points visible. Legacy detail uses the same section vocabulary with its existing amount-free operations. Do not activate redirects or imply a new review-complete state.

Batch authorized detail/retention reads rather than performing one full detail query per child. Represent purged fields as `(파기됨)` with purge time; do not display a financial payer as a substitute guardian. Companion navigation is ADMIN-only and remains a separate family with separate totals.

**Tests / exit gate:** UX-05/06/14/24 and the read portion of UX-07, plus UX-23/25/26/28. Verify consent four-required/two-optional with historical version, optional refusal, completed families, per-child status, purged views, focused disclosures, all legacy exception labels, financial summaries and navigation context. A GET must cause no status/consent/audit write. Existing writes must still work through their current forms/links.

**Risks:** PII over-selection/client serialization, lost child-detail content, misleading summaries. **Rollback:** Revert the new detail projection and layout. Child URLs have not redirected, and every original write entry point remains. No financial state or consent record changes on view.

### Phase 4 — Completion guidance and accessible copy/notification presentation

**Goal / risk:** Moderate public read/capability risk, below editing links or submissions. Improve the already functioning completion experience while preserving its existing authorization and mutation cores.

**Files / estimated scope:** 8 files (7 M / 1 C).

| Change | Files |
|---|---|
| M (2) | `P/complete/page.tsx`; `P/complete/completion-guide.tsx` |
| C (1) | `P/complete/_components/completion-copy-button.tsx` |
| M (3) | `U/completion-guide.test.ts`; `U/phase20-completion-page.test.ts`; `U/complete-navigation.test.ts` |
| M (2) | `E/phase20-application-group-siblings.spec.ts`; `E/phase20-companion-repeat-privacy.spec.ts` |

**Components / behavior:** Accessible, distinct account/amount/payer copy controls; visible clipboard fallback; explanatory notification/result text; secondary `친구 보호자 초대` section; mobile amount/account wrapping. Preserve the existing “received, not confirmed” heading where already correct. Keep legacy generic guidance and expired-capability fallback within their existing scope. A three-step visual is added only in Phase 6 when the two actual input steps exist; do not imply an unshipped wizard.

**Tests / exit gate:** UX-20/22/25/26 and completion parts of UX-21/24/27. Test self-only details, expired/invalid completion with no child amounts, legacy missing features, three different clipboard values/failure, refresh/double notification idempotency, invite separation, and back navigation privacy. Reuse current completion/action tests, keeping cookie/config/Preview guards unchanged.

**Risks:** Accidentally passing self-only data into the generic guide; treating notification as confirmation. **Rollback:** Revert only completion presentation and tests; existing cookies, notification timestamps, and invitations remain valid under current rules. No notification/invite reversal. Works with the existing unstepped input forms.

### Phase 5 — Link management home and class-scoped issue workflow

**Goal / risk:** Moderate-to-high write/token risk. Make existing single/group links discoverable in one home, and provide explicit class price → readiness → issue/copy actions without changing token or quote policy.

**Files / estimated scope:** 17 files (12 M / 5 C).

| Change | Files |
|---|---|
| M (3) | `A/classes/[id]/page.tsx`; `A/classes/_components/application-link-card.tsx`; `A/classes/actions.ts` |
| M (6) | `R/groups/page.tsx`; `R/groups/[id]/page.tsx`; `R/groups/group-create-form.tsx`; `R/groups/group-edit-form.tsx`; `R/groups/group-link-button.tsx`; `R/actions.ts` |
| C (3) | `L/link-management-queries.ts`; `R/_components/application-link-item.tsx`; `A/classes/_components/application-price-form.tsx` |
| C (2) | `U/link-management-queries.test.ts`; `E/admin-applications-link-management.spec.ts` |
| M (3) | `U/phase20-groups.test.ts`; `U/admin-actions.test.ts`; `E/phase20-application-group-siblings.spec.ts` |

**Components / behavior:** Paginated card home with optional class scope and separate legacy/group identities; identify groups by classes/times/counts/readiness/issue metadata, not a nonexistent title. Preserve historical/cancelled class memberships for viewing. Show every ordinary group containing a class and explicitly label upgraded-legacy aliases; never collapse unrelated links by class. Do not retain the current “latest 50 only” discovery limit.

Class card `이 클래스 신청 링크` shows target, ADMIN-entered `이 클래스 신청금액`, settings/consent readiness, and actual reception state. A narrow price form saves the existing field without copying `프로그램 기본 가격(참고)` or modifying past quotes. New single-class modern issue uses an explicit one-class group. Group create → issue → copy is one visible workflow with separate saved outcomes: after successful create/failed issue, retry issuing the saved group, not create again.

Reuse existing cores for stop/replace/resume/legacy upgrade. Show affected classes and existing-submission preservation before destructive actions. Hold modern raw tokens only in the issuance component's memory; no copy button or reconstruction on a later revisit. Copy never rotates a token. Retain legacy copy/reissue/stop and explicit original-address upgrade. Link to the Phase 2 list with removable class scope. Include loading/empty/error and double-action prevention.

**Tests / exit gate:** UX-15/16/17 and UX-23/25–28. Test all readiness/action states, wrong-role direct price/link actions, groups beyond the former limit, multi-group class membership, historical memberships, creation/issue partial failure, raw-token revisit behavior, copy vs replace, old-public-address compatibility, and unchanged submitted quotes/consent. Reuse existing group-edit vs submit/stop races through the guarded suite where applicable.

**Risks:** Invalidating the wrong group, accidental price fallback, duplicate group creation, token loss/false copy promise. **Rollback:** Revert UI/query/action adapters. Keep all legitimately created groups, price values, and link changes. A link already replaced/stopped stays that way; never revive an old token or backfill quotes. Old class/group screens support the same persisted models and remain navigable.

### Phase 6 — Parent two-step input and post-submit third stage

**Goal / risk:** High submission/consent/privacy risk. Deliver the complete parent three-stage experience across legacy, group, explicitly upgraded single-address, and companion entry points, with unchanged atomic submit/capability rules.

**Files / estimated scope:** 21 files (16 M / 5 C).

| Change | Files |
|---|---|
| M (3) | `P/[token]/page.tsx`; `P/[token]/_components/reservation-application-form.tsx`; `P/[token]/actions.ts` |
| M (3) | `P/group/[token]/page.tsx`; `P/group/[token]/group-application-form.tsx`; `P/group/[token]/actions.ts` |
| M (3) | `P/companion/[token]/page.tsx`; `P/complete/page.tsx`; `L/public-queries.ts` |
| C (4) | `P/_components/application-steps.tsx`; `P/_components/application-child-fields.tsx`; `P/_components/application-consent-step.tsx`; `L/application-draft.ts` |
| C (1) | `U/application-draft.test.ts` |
| M (4) | `U/group-application-form.test.ts`; `U/group-public-action.test.ts`; `U/public-action.test.ts`; `U/public-queries.test.ts` |
| M (3) | `E/phase18-reservation-application.spec.ts`; `E/phase20-application-group-siblings.spec.ts`; `E/phase20-companion-repeat-privacy.spec.ts` |

**Components / behavior:** Shared step indicator and child/consent presentation, with separate legacy/group payload adapters. Step 1 shows only allowed program description/age/date/time/location, existing device-owned child selection, new-child fields, one class per child, and child-count limits. Step 2 takes shared guardian information, modern declared payer only where already supported, original consent texts, named child/class application scope, optional per-child overrides, and final submission summary. Only `신청서 제출` invokes persistence; next/back buttons do not submit or silently create drafts server-side.

Pure draft transforms use stable ephemeral child keys; map server child-index errors against the submitted snapshot so removal/reordering cannot attach errors/consent to the wrong child. Guard Enter/default-submit behavior by active step. Preserve valid values and consent choices on validation or latest-state failure; route errors to the right step/field. No price/capacity fields in public form props, payloads, hidden fields, HTML, or RSC. Final server submission still validates current link/classes/prices/device/consent in the existing transaction.

Reuse existing completion navigation. On successful submit hide/clear the in-memory draft and replace input navigation as already supported; test browser back/forward and BFCache restoration so submitted PII and a stale submit form do not reappear. No PII/token drafts in URL, browser storage, analytics, or new cookies. Every new request gets current unchecked consent. Companion families never inherit inviter identity, child selection, or payment results.

**Tests / exit gate:** UX-18/19/21/22/25/26/27 and UX-20 regression. Cover normal/legacy/upgraded/companion routes, add/remove/edit/back, differing optional consent, mandatory omissions, changed class scope, safe repeat-child selection, atomic multi-child failure, field focus/value retention, current consent version, invalid link uniformity, raw HTML/RSC minimization, and browser history privacy. Reuse group-removal/token-revocation/device-purge races; keep dedicated-local legacy public tests out of Preview.

**Risks:** Unintended submit from “next”/Enter, consent fan-out mistakes, BFCache PII, public price leakage. **Rollback:** Revert to the prior single-form components/actions, keeping original submission payload/storage format. Preserve already submitted applications, consent snapshots, cookies, and invites. No conversion or resubmission of prior records. Phase 4's completion guide continues to work.

### Phase 7 — Same-page bank records, child resolution, and shared returns

**Goal / risk:** High financial write/concurrency risk. Complete the money and child-resolve portions of the integrated family page and expose completed return history globally, while preserving the existing confirmation operation for Phase 8.

**Files / estimated scope:** 16 files (11 M / 5 C).

| Change | Files |
|---|---|
| M (7) | `R/actions.ts`; `R/submissions/[id]/deposit-form.tsx`; `R/returns/return-form.tsx`; `R/returns/page.tsx`; `R/_components/application-resolve-form.tsx`; `R/submissions/[id]/page.tsx`; `R/_components/application-workflow.tsx` |
| C (3) | `R/submissions/[id]/workflow-controller.tsx`; `L/return-queries.ts`; `R/_components/application-return-card.tsx` |
| C (2) | `U/return-queries.test.ts`; `E/admin-applications-ledger-workflow.spec.ts` |
| M (4) | `U/admin-actions.test.ts`; `U/phase20-finance.test.ts`; `E/phase20-application-finance-returns.spec.ts`; `E/phase20-postgres-races.spec.ts` |

**Components / behavior:** Client coordinator preserves valid review/form drafts across server refresh. Place per-child reject/guardian-requested cancel with reason in section ①. Section ② separates declared payer, notification, actual bank transaction inputs/history, and Q/D/P/R/T/A. Notification never gates bank input. Record every actual partial/excess/late deposit in full; after success refresh all summary/status/obligation data on the same page. The success message uses the refreshed authoritative A, not a stale amount in the previous response.

Reuse the same `ReturnForm` and obligation card in family context and global returns. Global filters distinguish incomplete (including partial), partial, completed, and all; paginate history and retain family context. Show actual return date, processing date/ADMIN/reason and outstanding balance; `반환 이체 기록` records a transfer already made. Completed obligations are read-only; reject over-return, stale balance, and duplicate completion in the existing core. No financial history is hidden when all children are resolved. Include unknown-outcome reconciliation and field/error/draft preservation for all moved forms.

**Tests / exit gate:** UX-08/09/12/13 and bank-record part of UX-07; UX-06/23/25/26 regressions. Cover 30+70 deposits, 110 excess, cancellation of a 60 quote from a funded 40+60 family, 20 partial return leaving R40/T20, late deposit, same obligation from both workbenches, no-notification recording, reason enforcement, stale/over-return, double keys, response loss, two ADMIN returns, and deposit/return/resolve concurrency. Assert unchanged Payment/Revenue before confirmation and DB conservation, not merely badges.

**Risks:** Duplicate financial write after uncertain response, missed revalidation, using return funds for reservations, resolving a sibling unintentionally. **Rollback:** Revert adapters/coordinator and return to separate existing deposit/child/return workflows. Deposits, obligations, return records, resolutions, and keys remain untouched; never delete or compensate a real transaction as a deployment rollback. Child URLs still have not redirected.

### Phase 8 — Explicit atomic confirmation and final child-route consolidation

**Goal / risk:** Highest risk: reservation creation, Child/consent linkage, payment allocation, overbooking, and concurrency. Finish the same-page workflow, then connect old modern child URLs to it only after parity is verified.

**Files / estimated scope:** 17 files (16 M / 1 C).

| Change | Files |
|---|---|
| M (9) | `R/[id]/page.tsx`; `R/submissions/[id]/page.tsx`; `R/submissions/[id]/confirmation-form.tsx`; `R/submissions/[id]/workflow-controller.tsx`; `R/_components/application-confirm-form.tsx`; `R/_components/deposit-confirm-button.tsx`; `R/_components/application-review-card.tsx`; `R/actions.ts`; `L/detail-queries.ts` |
| M (3) | `U/admin-actions.test.ts`; `U/phase20-finance.test.ts`; `U/confirm.test.ts` |
| M (4) | `E/admin-applications-detail.spec.ts`; `E/admin-applications-ledger-workflow.spec.ts`; `E/phase20-postgres-races.spec.ts`; `E/phase18-reservation-application.spec.ts` |
| C (1) | `E/admin-applications-confirmation.spec.ts` |

**Components / behavior:** Keep selection initially empty and require an explicit existing/new Child choice. Mark existing requested-child hints without treating candidate matching as ADMIN consent or overwriting the Child. Preserve current candidate eligibility and device-request ownership checks. Provide per-child reservation memo drafts with the safety-information exclusion guidance; do not alter the submitted request/consent text.

Show selected count, original quotes, S, A and B beside the single primary `선택한 아이 {n}명 예약 확정`. Explain every known block near the action; amount sufficiency never promises all server checks passed. Bind overbooking acknowledgment to the existing selection/child/class mechanism, show class/capacity/current/final-overage details, and **replace** the normal button with `정원 초과 확인 후 예약 확정`. Invalidate acknowledgments when selection/linkage/class context changes and retain final locked server revalidation.

On success refresh the server result, show each actual reservation/payment link, remove processed children from pending selection, and keep unselected siblings/drafts. One selected batch yields one existing atomic result and correct single Payment linkage, never partial-success UI or a new manual payment prompt. On concurrency failure reconcile the latest state and preserve only still-valid selection/inputs; never automatically retry a reservation write.

Legacy detail keeps amount-free `기존 방식 입금 확인 기록`, the same review/deposit/confirm vocabulary, its old confirmation core, and manual Payment registration only when absent. No new Submission or ledger is created. Enable the authorized temporary modern-child redirect only when all child content/actions, history, consent, retention links, return functionality, and context restoration are available on family detail.

**Tests / exit gate:** UX-07/10/11/14/28 and all remaining financial/permission/privacy gates. Test empty/partial/full selection, explicit linkage and memo, all-or-none failure, two ADMIN confirm, confirm vs return, latest class/capacity change, warning replacement/reset, duplicate/inactive/purged child, purge race, existing request ownership, Payment totals/mapping, and each legacy exception. Verify modern child bookmarks focus the right child after auth while legacy bookmarks keep their route. Run the full UX-01–28 matrix and existing reservation/payment/refund/revenue/retention/auth regressions in permitted environments before declaring the redesign complete.

**Risks:** Hidden implicit selection, stale overbooking approval, duplicate Reservation/Payment, incomplete redirect parity, legacy financial regression. **Rollback:** Revert Phase 8, including the temporary child redirect, to restore the earlier operational detail/forms. Keep every committed reservation, payment, consent and allocation intact; existing server protections prevent replay. Never cancel a booking, delete a payment, alter a quote, or reopen a processed application to undo a UI release.

### Final handoff

Deliver per-phase Changed/Tests/Lint/Build/Risks/Next evidence and a reviewable diff on the approved feature branch. This PLAN ends at design review. Implementation, browser/DB verification, operational changes, and shipping require their normal subsequent roles and approvals; none is performed by creating this document.
