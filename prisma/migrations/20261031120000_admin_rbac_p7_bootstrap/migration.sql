-- G1-A formal migration (UNCOMMITTED — separate commit approval required; DO NOT APPLY to Preview/Production without the G1-A gate + explicit approval).
-- RBAC P7: BootstrapApproval / BootstrapAcceptance / BootstrapCompletion tables (first SUPER_ADMIN evidence + singleton completion mark).
-- Source: draft prisma/migrations-DRAFT/20261031000000_admin_rbac_p7.sql (tables/indexes/singleton CHECK identical) PLUS the SPEC §2.5
-- FK policy, which the draft did not carry: approval.targetUserId -> User RESTRICT, acceptance.approvalId -> BootstrapApproval
-- RESTRICT, acceptance.acceptedForUserId -> User RESTRICT. BootstrapCompletion.approvalId/acceptanceId are deliberately plain TEXT
-- identifiers with UNIQUE only and NO FK, so the permanent completion mark never blocks lawful evidence disposal at the end of
-- its retention period (SPEC §2.5 / user G1 instruction §3.3). The mark holds only minimal event identifiers, no personal data copies.
-- Order: LAST of the RBAC set. Order-independent vs P1/P3/P4 (no FK to their tables), applied last as a bundle.
-- No deletion API or automatic purge is created by this migration (retention 5-year draft + bundle-unit manual purge remain
-- unapproved operating-gate items; the mark itself is permanent).
-- No original tokens and no full acceptance URLs are stored (tokenHash only, in BootstrapAcceptance).
-- Transaction note: BEGIN/COMMIT explicit following the 20261026090000_notification_outbox precedent (lock_timeout 5s, statement_timeout 60s).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE "BootstrapApproval" (
  "id" TEXT PRIMARY KEY, "approverUserId" TEXT NOT NULL, "targetUserId" TEXT NOT NULL,
  "targetEmail" TEXT NOT NULL, "approvedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "identityMethod" TEXT NOT NULL, "identityAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3), "executionId" TEXT
);
CREATE INDEX "BootstrapApproval_targetUserId_idx" ON "BootstrapApproval"("targetUserId");
CREATE TABLE "BootstrapAcceptance" (
  "id" TEXT PRIMARY KEY, "approvalId" TEXT NOT NULL, "acceptedForUserId" TEXT NOT NULL,
  "targetEmail" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "tokenVerified" BOOLEAN NOT NULL DEFAULT false,
  "authenticationMethod" TEXT, "consumedAt" TIMESTAMP(3), "executionId" TEXT
);
CREATE INDEX "BootstrapAcceptance_approvalId_idx" ON "BootstrapAcceptance"("approvalId");
CREATE TABLE "BootstrapCompletion" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'FIRST_SUPER_ADMIN'), "approvalId" TEXT NOT NULL UNIQUE,
  "acceptanceId" TEXT NOT NULL UNIQUE, "completedAt" TIMESTAMP(3) NOT NULL
);

-- SPEC §2.5 FK policy (added here; absent from the P7 draft by design of that draft stage).
ALTER TABLE "BootstrapApproval" ADD CONSTRAINT "BootstrapApproval_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BootstrapAcceptance" ADD CONSTRAINT "BootstrapAcceptance_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "BootstrapApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BootstrapAcceptance" ADD CONSTRAINT "BootstrapAcceptance_acceptedForUserId_fkey" FOREIGN KEY ("acceptedForUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- BootstrapCompletion.approvalId / acceptanceId intentionally have NO FK (see header).

COMMIT;
