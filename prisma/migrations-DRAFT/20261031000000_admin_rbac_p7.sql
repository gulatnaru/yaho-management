-- DRAFT ONLY: do not apply without the separate schema gate.
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
