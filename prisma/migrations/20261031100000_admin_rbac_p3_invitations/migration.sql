-- G1-A formal migration (UNCOMMITTED — separate commit approval required; DO NOT APPLY to Preview/Production without the G1-A gate + explicit approval).
-- RBAC P3: AdminInvitation table + UserAccountChangeType expansion (5 invitation audit types).
-- Source: draft prisma/migrations-DRAFT/20261030120000_admin_rbac_p3.sql (DDL identical; header/timeouts/transaction framing added here).
-- Order: SECOND of the RBAC set, after P1 (AdminInvitation.role references the new Role enum). P4 references AdminInvitation.
-- No CHECK references UserAccountChangeType (only UserAccountChange.type uses it), so no constraint drop/re-add is needed.
-- The original token is stored nowhere in this migration (tokenHash only). InvitationDeliveryAttempt (P4) references AdminInvitation.
-- Transaction note: enum swap uses the create-new-type + rename sequence (transaction-safe); BEGIN/COMMIT explicit following
-- the 20261026090000_notification_outbox precedent (lock_timeout 5s, statement_timeout 60s).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "UserAccountChangeType_new" AS ENUM ('CREATED', 'EMAIL_CHANGED', 'ROLE_CHANGED', 'ACTIVE_CHANGED', 'PASSWORD_RESET', 'INVITATION_ISSUED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED', 'INVITATION_REVOKED', 'INVITATION_RESENT');
ALTER TABLE "UserAccountChange" ALTER COLUMN "type" TYPE "UserAccountChangeType_new" USING ("type"::text::"UserAccountChangeType_new");
ALTER TYPE "UserAccountChangeType" RENAME TO "UserAccountChangeType_old";
ALTER TYPE "UserAccountChangeType_new" RENAME TO "UserAccountChangeType";
DROP TYPE "UserAccountChangeType_old";

CREATE TABLE "AdminInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "issuedById" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE INDEX "AdminInvitation_email_createdAt_idx" ON "AdminInvitation"("email", "createdAt");
CREATE INDEX "AdminInvitation_issuedById_createdAt_idx" ON "AdminInvitation"("issuedById", "createdAt");
CREATE INDEX "AdminInvitation_targetUserId_createdAt_idx" ON "AdminInvitation"("targetUserId", "createdAt");

ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
