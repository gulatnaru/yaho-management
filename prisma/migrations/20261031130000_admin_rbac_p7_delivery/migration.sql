-- G1-B draft, not approved for deployment. Acceptance identifier deliberately has no FK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE "BootstrapDeliveryAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "acceptanceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "InvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "errorCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "BootstrapDeliveryAttempt_acceptanceId_key" ON "BootstrapDeliveryAttempt"("acceptanceId");
COMMIT;
-- Rollback draft only: BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'; DROP TABLE "BootstrapDeliveryAttempt"; COMMIT;
