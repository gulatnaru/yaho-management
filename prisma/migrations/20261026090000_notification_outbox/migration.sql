BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'processing', 'sent', 'skipped', 'failed');

-- CreateTable: minimal bookkeeping only; no customer/financial payload.
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "providerId" TEXT,
    "providerRef" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");
CREATE INDEX "NotificationOutbox_status_nextRetryAt_idx" ON "NotificationOutbox"("status", "nextRetryAt");
CREATE INDEX "NotificationOutbox_status_leaseExpiresAt_idx" ON "NotificationOutbox"("status", "leaseExpiresAt");

-- Server-side access only, following existing Supabase migration conventions.
ALTER TABLE "NotificationOutbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationOutbox" FROM anon, authenticated;

COMMIT;
