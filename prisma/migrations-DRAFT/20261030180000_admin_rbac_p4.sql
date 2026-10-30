-- P4 draft only; formal migration requires separate approval.
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
