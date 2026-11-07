BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateTable
CREATE TABLE "NotificationRecipientRegistration" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "purposeVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "ciphertext" BYTEA,
    "nonce" BYTEA,
    "tag" BYTEA,
    "keyVersion" TEXT,
    "verificationMethod" TEXT,
    "verificationEvidenceId" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationRecipientRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDispatch" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientVersion" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "slotCount" INTEGER NOT NULL DEFAULT 0,
    "auditSequence" INTEGER NOT NULL DEFAULT 0,
    "reconciliationState" TEXT NOT NULL,
    "finalStatus" TEXT,
    "unknownSince" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewed7dAt" TIMESTAMP(3),
    "responsibilityReviewedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "approvalId" TEXT,
    "evidenceId" TEXT,
    "completedAt" TIMESTAMP(3),
    "purgeDueAt" TIMESTAMP(3),
    "policyVersion" TEXT NOT NULL,
    "purgeScope" TEXT,
    "purgedAt" TIMESTAMP(3),
    "purgeState" TEXT,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAudit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "registrationId" TEXT,
    "outboxId" TEXT,
    "dispatchId" TEXT,
    "slotId" TEXT,
    "costOperationId" TEXT,
    "eventType" TEXT NOT NULL,
    "sequence" INTEGER,
    "fromState" TEXT,
    "toState" TEXT,
    "code" TEXT,
    "providerRef" TEXT,
    "actorId" TEXT,
    "commandId" TEXT,
    "approvalId" TEXT,
    "evidenceId" TEXT,
    "payloadBinding" TEXT,
    "policyVersion" TEXT,
    "keyVersion" TEXT,
    "revisionBefore" INTEGER,
    "revisionAfter" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationBudgetPeriod" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "reservedMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "confirmedMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "carryMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "otherMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "planApplied" BOOLEAN NOT NULL DEFAULT false,
    "archivedConfirmedMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "lookupReservedMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "lookupConfirmedMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "lookupCarryMilliKrw" BIGINT NOT NULL DEFAULT 0,
    "lookupArchivedConfirmedMilliKrw" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "NotificationBudgetPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCostReservation" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "entryKind" TEXT NOT NULL DEFAULT 'SEND_SLOT',
    "operationKey" TEXT,
    "sourceSlotId" TEXT,
    "sourceCostId" TEXT,
    "correctionVersion" TEXT,
    "evidenceVerifiedAt" TIMESTAMP(3),
    "expectedCostRevision" INTEGER,
    "expectedPeriodRevision" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "resultAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "resultCode" TEXT,
    "dayKey" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "reservedMilliKrw" BIGINT,
    "confirmedMilliKrw" BIGINT,
    "adjustmentMilliKrw" BIGINT,
    "adjustmentCommandId" TEXT,
    "adjustmentApprovalId" TEXT,
    "adjustmentEvidenceId" TEXT,
    "costState" TEXT NOT NULL,
    "evidenceId" TEXT,
    "carriedThroughMonth" TEXT,
    "detailPurgedAt" TIMESTAMP(3),
    "costSummaryPurgedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationCostReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRuntimeConfig" (
    "environment" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "namespace" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT true,
    "blockReason" TEXT,
    "activationEpoch" TIMESTAMP(3),
    "providerId" TEXT,
    "recipientVersion" TEXT,
    "templateVersion" TEXT,
    "costPolicyVersion" TEXT,
    "policyVersion" TEXT,
    "ownerId" TEXT,
    "costExecutorId" TEXT,
    "keyExecutorId" TEXT,
    "purgeExecutorId" TEXT,
    "keyVersion" TEXT,
    "nonceHighWater" BIGINT NOT NULL DEFAULT 0,
    "nonceCurrent" BOOLEAN NOT NULL DEFAULT false,
    "recoveryVerified" BOOLEAN NOT NULL DEFAULT false,
    "rotationComplete" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRuntimeConfig_pkey" PRIMARY KEY ("environment")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipientRegistration_environment_userId_versio_key" ON "NotificationRecipientRegistration"("environment", "userId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDispatch_outboxId_key" ON "NotificationDispatch"("outboxId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAudit_eventId_key" ON "NotificationAudit"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAudit_dispatchId_sequence_key" ON "NotificationAudit"("dispatchId", "sequence");

CREATE INDEX "NotificationAudit_dispatchId_occurredAt_idx" ON "NotificationAudit"("dispatchId", "occurredAt");

-- CreateIndex
CREATE INDEX "NotificationAudit_commandId_idx" ON "NotificationAudit"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationBudgetPeriod_environment_service_periodType_per_key" ON "NotificationBudgetPeriod"("environment", "service", "periodType", "periodKey");

-- CreateIndex
CREATE INDEX "NotificationCostReservation_costState_monthKey_idx" ON "NotificationCostReservation"("costState", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCostReservation_dispatchId_sequence_key" ON "NotificationCostReservation"("dispatchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRuntimeConfig_namespace_key" ON "NotificationRuntimeConfig"("namespace");

-- AddForeignKey
ALTER TABLE "NotificationRecipientRegistration" ADD CONSTRAINT "NotificationRecipientRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NotificationRecipientRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAudit" ADD CONSTRAINT "NotificationAudit_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "NotificationRecipientRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAudit" ADD CONSTRAINT "NotificationAudit_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAudit" ADD CONSTRAINT "NotificationAudit_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "NotificationDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAudit" ADD CONSTRAINT "NotificationAudit_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "NotificationCostReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationAudit" ADD CONSTRAINT "NotificationAudit_costOperationId_fkey" FOREIGN KEY ("costOperationId") REFERENCES "NotificationCostReservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "NotificationCostReservation_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "NotificationDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "notification_cost_dispatch_identity" ON "NotificationCostReservation" ("dispatchId", "id");
CREATE UNIQUE INDEX "NotificationCostReservation_operationKey_key" ON "NotificationCostReservation" ("operationKey");
CREATE UNIQUE INDEX "notification_cost_correction_evidence_version" ON "NotificationCostReservation" ("sourceCostId", "adjustmentEvidenceId", "correctionVersion") WHERE "entryKind" = 'COST_CORRECTION';
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_cost_source_slot_fk" FOREIGN KEY ("dispatchId", "sourceSlotId") REFERENCES "NotificationCostReservation" ("dispatchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_cost_source_cost_fk" FOREIGN KEY ("dispatchId", "sourceCostId") REFERENCES "NotificationCostReservation" ("dispatchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- A slot remains evidence even if its cost details are later purged.
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_slot_sequence_range" CHECK (("entryKind" = 'SEND_SLOT' AND "sequence" IS NOT NULL AND "sequence" BETWEEN 1 AND 5 AND "sourceSlotId" IS NULL AND "sourceCostId" IS NULL) OR ("entryKind" = 'LOOKUP_COST' AND "sequence" IS NULL AND "operationKey" IS NOT NULL AND "sourceSlotId" IS NOT NULL AND "sourceCostId" IS NULL) OR ("entryKind" = 'COST_CORRECTION' AND "sequence" IS NULL AND "operationKey" IS NOT NULL AND "sourceSlotId" IS NOT NULL AND "sourceCostId" IS NOT NULL AND "correctionVersion" IS NOT NULL));
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_slot_cost_nonnegative" CHECK (("reservedMilliKrw" IS NULL OR "reservedMilliKrw" >= 0) AND ("confirmedMilliKrw" IS NULL OR "confirmedMilliKrw" >= 0));
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_cost_purged_numbers" CHECK (("costState" = 'summary_purged' AND "costSummaryPurgedAt" IS NOT NULL AND "reservedMilliKrw" IS NULL AND "confirmedMilliKrw" IS NULL AND "adjustmentMilliKrw" IS NULL) OR ("costState" <> 'summary_purged' AND "costSummaryPurgedAt" IS NULL));
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_cost_state_values" CHECK (
  ("entryKind" IN ('SEND_SLOT', 'LOOKUP_COST') AND (("costState" IN ('reserved', 'reserved_unknown') AND "reservedMilliKrw" IS NOT NULL AND "confirmedMilliKrw" IS NULL) OR ("costState" = 'partially_confirmed' AND "reservedMilliKrw" IS NOT NULL AND "reservedMilliKrw" > 0 AND "confirmedMilliKrw" IS NOT NULL) OR ("costState" = 'settled' AND "reservedMilliKrw" IS NOT NULL AND "reservedMilliKrw" = 0 AND "confirmedMilliKrw" IS NOT NULL) OR "costState" = 'summary_purged')) OR
  ("entryKind" = 'COST_CORRECTION' AND (("costState" IN ('proposed', 'applied') AND "adjustmentMilliKrw" IS NOT NULL AND "adjustmentEvidenceId" IS NOT NULL AND "adjustmentApprovalId" IS NOT NULL AND "evidenceVerifiedAt" IS NOT NULL AND "expectedCostRevision" IS NOT NULL AND "expectedPeriodRevision" IS NOT NULL) OR "costState" = 'summary_purged'))
);
ALTER TABLE "NotificationCostReservation" ADD CONSTRAINT "notification_slot_status_allowed" CHECK (("entryKind" = 'SEND_SLOT' AND "status" IN ('in_flight', 'unknown', 'accepted', 'rejected', 'delivered', 'delivery_failed')) OR ("entryKind" = 'LOOKUP_COST' AND "status" IN ('in_flight', 'unknown', 'resolved')) OR ("entryKind" = 'COST_CORRECTION' AND "status" IN ('proposed', 'applied')));
CREATE FUNCTION notification_cost_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."dispatchId" IS DISTINCT FROM OLD."dispatchId" OR NEW."entryKind" IS DISTINCT FROM OLD."entryKind" OR NEW."sequence" IS DISTINCT FROM OLD."sequence" OR NEW."operationKey" IS DISTINCT FROM OLD."operationKey" OR NEW."sourceSlotId" IS DISTINCT FROM OLD."sourceSlotId" OR NEW."sourceCostId" IS DISTINCT FROM OLD."sourceCostId" THEN
    RAISE EXCEPTION 'immutable cost identity';
  END IF;
  IF OLD."adjustmentApprovalId" IS NOT NULL AND NEW."costState" <> 'summary_purged' AND (NEW."adjustmentMilliKrw" IS DISTINCT FROM OLD."adjustmentMilliKrw" OR NEW."adjustmentCommandId" IS DISTINCT FROM OLD."adjustmentCommandId" OR NEW."adjustmentApprovalId" IS DISTINCT FROM OLD."adjustmentApprovalId" OR NEW."adjustmentEvidenceId" IS DISTINCT FROM OLD."adjustmentEvidenceId" OR NEW."correctionVersion" IS DISTINCT FROM OLD."correctionVersion" OR NEW."evidenceVerifiedAt" IS DISTINCT FROM OLD."evidenceVerifiedAt" OR NEW."expectedCostRevision" IS DISTINCT FROM OLD."expectedCostRevision" OR NEW."expectedPeriodRevision" IS DISTINCT FROM OLD."expectedPeriodRevision") THEN
    RAISE EXCEPTION 'approved correction cannot change';
  END IF;
  IF NEW."costState" = 'summary_purged' AND OLD."costState" <> 'summary_purged' AND OLD."costState" NOT IN ('settled', 'applied') THEN
    RAISE EXCEPTION 'unresolved cost cannot be purged';
  END IF;
  IF OLD."entryKind" = 'COST_CORRECTION' AND NEW."costState" = 'summary_purged' AND (NEW."adjustmentEvidenceId" IS DISTINCT FROM OLD."adjustmentEvidenceId" OR NEW."correctionVersion" IS DISTINCT FROM OLD."correctionVersion") THEN
    RAISE EXCEPTION 'correction deduplication evidence remains required';
  END IF;
  IF (OLD."detailPurgedAt" IS NOT NULL AND (NEW."detailPurgedAt" IS DISTINCT FROM OLD."detailPurgedAt" OR NEW."providerRef" IS NOT NULL OR NEW."resultCode" IS NOT NULL)) OR (OLD."costSummaryPurgedAt" IS NOT NULL AND (NEW."costSummaryPurgedAt" IS DISTINCT FROM OLD."costSummaryPurgedAt" OR NEW."costState" <> 'summary_purged' OR NEW."reservedMilliKrw" IS NOT NULL OR NEW."confirmedMilliKrw" IS NOT NULL OR NEW."adjustmentMilliKrw" IS NOT NULL)) THEN
    RAISE EXCEPTION 'purged cost cannot be restored';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_cost_immutable_update BEFORE UPDATE ON "NotificationCostReservation" FOR EACH ROW EXECUTE FUNCTION notification_cost_immutable();
CREATE UNIQUE INDEX "notification_one_unresolved_slot" ON "NotificationCostReservation" ("dispatchId") WHERE "entryKind" = 'SEND_SLOT' AND "status" IN ('in_flight', 'unknown', 'accepted');
CREATE UNIQUE INDEX "notification_one_active_recipient" ON "NotificationRecipientRegistration" ("environment", "service") WHERE "state" = 'active';
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "notification_dispatch_slot_count" CHECK ("slotCount" BETWEEN 0 AND 5);
ALTER TABLE "NotificationBudgetPeriod" ADD CONSTRAINT "notification_budget_nonnegative" CHECK ("requestCount" >= 0 AND "reservedMilliKrw" >= 0 AND "confirmedMilliKrw" >= 0 AND "carryMilliKrw" >= 0 AND "otherMilliKrw" >= 0);
ALTER TABLE "NotificationBudgetPeriod" ADD CONSTRAINT "notification_budget_archive_valid" CHECK ("revision" >= 0 AND "archivedConfirmedMilliKrw" >= 0 AND "archivedConfirmedMilliKrw" <= "confirmedMilliKrw" AND "lookupReservedMilliKrw" >= 0 AND "lookupConfirmedMilliKrw" >= 0 AND "lookupCarryMilliKrw" >= 0 AND "lookupArchivedConfirmedMilliKrw" >= 0 AND "lookupArchivedConfirmedMilliKrw" <= "lookupConfirmedMilliKrw");
ALTER TABLE "NotificationRuntimeConfig" ADD CONSTRAINT "notification_nonce_nonnegative" CHECK ("nonceHighWater" >= 0);
ALTER TABLE "NotificationRecipientRegistration" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationRecipientRegistration" FROM anon, authenticated;
ALTER TABLE "NotificationDispatch" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationDispatch" FROM anon, authenticated;
ALTER TABLE "NotificationAudit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationAudit" FROM anon, authenticated;
ALTER TABLE "NotificationBudgetPeriod" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationBudgetPeriod" FROM anon, authenticated;
ALTER TABLE "NotificationCostReservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationCostReservation" FROM anon, authenticated;
ALTER TABLE "NotificationRuntimeConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NotificationRuntimeConfig" FROM anon, authenticated;
COMMIT;
