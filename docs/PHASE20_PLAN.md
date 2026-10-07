# Phase 20 accepted implementation plan

Status: accepted by the project owner on 2026-10-06. This document is a recovery checkpoint for the approved Phase 20 scope; it does not reopen product decisions.

## Scope and invariants

- Extend Phase 18 links without changing legacy one-class, one-child, no-price behavior. A new `ReservationApplicationGroup` contains arbitrary scheduled classes; a new link stores only a SHA-256 hash of a 256-bit opaque token.
- Store `ClassSchedule.applicationPrice` as an administrator-set positive integer. A group can open only when all its classes have that price. Submission snapshots the selected class price into each `ReservationApplication.quotedAmount`; `Program.defaultPrice` is never a fallback.
- A parent submission owns guardian data, payer declaration and multiple child applications. Each child selects one class and has independent status, consent and subsequent reservation. Companion invitations create another scoped submission only and never establish a Child relationship or consent proxy.
- Keep public data capability-scoped, `no-store`, and minimal. Device and completion capabilities are HTTP-only Secure cookies/tokens represented only as hashes at rest; direct owner identity, cross-guardian access, phone-only ownership and PII in RSC/local storage are prohibited.
- Record verified pre-reservation deposits, allocations, return obligations and returns in a separate ledger. It supports partial and excess deposits and partial returns. It must balance deposits between availability, payment mapping, pending return obligation and completed return. A confirmation creates exactly the selected quoted PaymentItems only after enough available money exists.
- Keep current Payment/Refund/Revenue post-reservation policy unchanged. Do not create a Payment, Reservation or revenue row from guardian notification or deposit verification alone.
- Settings are a singleton ADMIN-only database record with bank and validated HTTPS social URLs. DB settings are authoritative; legacy environment values may only be imported through an explicit ADMIN operation and incomplete DB settings fail closed.
- Preserve Phase 18 consent, availability, retention and privacy behavior. New guardian-level PII is purged once every child application is purged. Lock order is Submission -> Application -> Class -> Child for confirmation, Group -> Link -> class membership -> Device -> Child for public submission and Submission -> Application -> Deposit -> allocations for finance.

## Delivery sequence

1. Add additive Prisma schema and migration with compatibility checks.
2. Implement group/link/price/settings validation and ADMIN controls.
3. Implement atomic public multi-child submission, companion scope and private completion DTOs.
4. Implement device capability, notification and retention extensions.
5. Implement verified-deposit ledger, selected bulk confirmation and partial-return workflow.
6. Add ADMIN list/detail/return/settings and public group/repeat/invite screens.
7. Add focused unit tests and guarded Preview E2E candidates. Preview intake stays closed unless the existing guarded lease path validates the approved Preview deployment and run scope.
8. Run Prisma format/validate/generate, typecheck, lint, unit tests and build when no Next development process is active.

## Explicitly preserved constraints

- No `prisma db push`, reset, seed, production DB access, data backfill, secret output, commit, push or PR in this build role.
- Existing Phase 18 records retain their fields and links. New migration is additive and does not hard-code bank account data, prices or environment values.
- Every new financial and settings endpoint/action requires `requireAdminPrincipal`; MANAGER and TEACHER are denied server-side.

## Recovery implementation contract

- New group links use SHA-256 hashes of 256-bit opaque tokens. Legacy links continue to use their existing class/token pair. A legacy link can be explicitly upgraded only after the ADMIN sets the class price and settings are ready; there is no price backfill.
- Submission writes guardian values once and retains each child’s requested class, price snapshot, consent snapshot and status independently. New group applications keep their guardian columns null. Completion and device cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, short-lived or finite-lived, and are never stored in local storage or emitted in an RSC payload.
- A companion invitation has a 14-day-or-class-end expiry, revocation timestamp, issuer submission and group scope. The accepting guardian submits its own guardian data, child data and fresh consent. It never creates a `Relationship` or transfers ownership by name or phone.
- Device repeat selection requires a valid, unrevealed device hash, an owned active unpurged child and exact prior guardian relation. Submission confirmation grants `DeviceChild` only after the device’s own child is confirmed. A requested child ID is never accepted as an unscoped public identifier.
- Finance locks Submission first. Confirmed deposits are separate from `Payment`; allocations consume deposits FIFO, each allocation has exactly one target, and a deposit cannot be overdrawn. Rejected/cancelled funded child charges are held before a separate excess hold. Return obligations are funded before partial returns are recorded. Confirmation uses only the quoted amount, creates one transfer Payment and one exact PaymentItem/mapping per selected child, and creates no Revenue or Refund from deposits or returns.
- Existing child confirmation requires exact identity against the submitted child and guardian data; ambiguous or phone-only candidates do not grant ownership. New child confirmation creates Child and append-only consent records with the application consent version. Existing cancelled reservation payments are checked before reactivation so a second payment cannot be written.
- Preview Phase 20 intake defaults closed. The runner performs URL/project/runtime-fingerprint/migration preflight, holds the existing advisory lock, creates a short lease for its exact SHA/run ID, signs the run in a finite HMAC header, and removes its lease in `finally`. App intake accepts only a matching signature, active lease and group `syntheticRunId`; ordinary Preview is closed and Production never accepts a test scope.
- The future guarded browser suites are named `phase20-application-group-siblings.spec.ts`, `phase20-application-finance-returns.spec.ts`, and `phase20-companion-repeat-privacy.spec.ts`. They must use own synthetic run IDs, no global purge or shared-account mutation, safe boolean leak assertions, one worker, trace off and bounded cleanup. Live execution waits for a committed exact head and an operator-applied Preview migration.
