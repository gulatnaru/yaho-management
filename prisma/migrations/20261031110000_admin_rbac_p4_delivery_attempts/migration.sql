-- G1-A formal migration (UNCOMMITTED — separate commit approval required; DO NOT APPLY to Preview/Production without the G1-A gate + explicit approval).
-- RBAC P4: InvitationDeliveryAttempt table + InvitationDeliveryStatus enum (PENDING/SENDING/ACCEPTED/FAILED/UNKNOWN).
-- Source: draft prisma/migrations-DRAFT/20261030180000_admin_rbac_p4.sql (DDL identical; header/timeouts/transaction framing added here).
-- Order: THIRD of the RBAC set, after P3 (invitationId references AdminInvitation). One attempt row per invitation (UNIQUE invitationId).
-- Transaction note: BEGIN/COMMIT explicit following the 20261026090000_notification_outbox precedent (lock_timeout 5s, statement_timeout 60s).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN');
CREATE TABLE "InvitationDeliveryAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "invitationId" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL,
  "status" "InvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "errorCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "InvitationDeliveryAttempt_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "AdminInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMIT;
