-- Phase 20 is intentionally additive. Legacy Phase 18 link/application rows stay valid.
BEGIN;
CREATE TYPE "ReturnObligationKind" AS ENUM ('REJECTED', 'CANCELLED', 'EXCESS');
ALTER TABLE "ClassSchedule" ADD COLUMN "applicationPrice" INTEGER;
ALTER TABLE "ClassSchedule" ADD CONSTRAINT "class_application_price_positive"
  CHECK ("applicationPrice" IS NULL OR ("applicationPrice" > 0 AND "applicationPrice" <= 2147483647));

ALTER TABLE "ReservationApplicationLink" ALTER COLUMN "classScheduleId" DROP NOT NULL;
ALTER TABLE "ReservationApplicationLink" ALTER COLUMN "token" DROP NOT NULL;
ALTER TABLE "ReservationApplicationLink" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "ReservationApplicationLink" ADD COLUMN "groupId" TEXT;
ALTER TABLE "ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_tokenHash_key" UNIQUE ("tokenHash");

CREATE TABLE "ReservationApplicationGroup" (
  "id" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdById" TEXT NOT NULL,
  "syntheticRunId" TEXT, "syntheticSettings" JSONB, "upgradedLegacyClassScheduleId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ReservationApplicationGroup_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReservationApplicationGroupClass" (
  "id" TEXT NOT NULL, "groupId" TEXT NOT NULL, "classScheduleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationApplicationGroupClass_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ReservationApplicationGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationApplicationGroup" ADD CONSTRAINT "ReservationApplicationGroup_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationApplicationGroup" ADD CONSTRAINT "ReservationApplicationGroup_upgradedLegacyClassScheduleId_fkey"
  FOREIGN KEY ("upgradedLegacyClassScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ReservationApplicationGroup_upgradedLegacyClassScheduleId_key" ON "ReservationApplicationGroup"("upgradedLegacyClassScheduleId");
ALTER TABLE "ReservationApplicationGroupClass" ADD CONSTRAINT "ReservationApplicationGroupClass_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ReservationApplicationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationApplicationGroupClass" ADD CONSTRAINT "ReservationApplicationGroupClass_classScheduleId_fkey"
  FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ReservationApplicationGroupClass_groupId_classScheduleId_key" ON "ReservationApplicationGroupClass"("groupId", "classScheduleId");
CREATE INDEX "ReservationApplicationGroupClass_classScheduleId_idx" ON "ReservationApplicationGroupClass"("classScheduleId");
CREATE INDEX "ReservationApplicationGroup_isActive_createdAt_idx" ON "ReservationApplicationGroup"("isActive", "createdAt");
CREATE INDEX "ReservationApplicationGroup_syntheticRunId_idx" ON "ReservationApplicationGroup"("syntheticRunId");

CREATE TABLE "ReservationApplicationSubmission" (
  "id" TEXT NOT NULL, "groupId" TEXT, "guardianName" TEXT, "guardianPhone" TEXT,
  "guardianRelationship" "GuardianRelationship", "declaredPayerName" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "depositNotifiedAt" TIMESTAMP(3),
  "personalDataPurgedAt" TIMESTAMP(3), "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationApplicationSubmission_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ReservationApplicationSubmission" ADD CONSTRAINT "ReservationApplicationSubmission_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ReservationApplicationGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationApplicationSubmission" ADD CONSTRAINT "ReservationApplicationSubmission_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ReservationApplicationSubmission_groupId_submittedAt_idx" ON "ReservationApplicationSubmission"("groupId", "submittedAt");
CREATE INDEX "ReservationApplicationSubmission_personalDataPurgedAt_idx" ON "ReservationApplicationSubmission"("personalDataPurgedAt");
ALTER TABLE "ReservationApplicationSubmission" ADD COLUMN "completionTokenHash" TEXT;
ALTER TABLE "ReservationApplicationSubmission" ADD COLUMN "completionExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ReservationApplicationSubmission_completionTokenHash_key" ON "ReservationApplicationSubmission"("completionTokenHash");
CREATE INDEX "ReservationApplicationSubmission_completionExpiresAt_idx" ON "ReservationApplicationSubmission"("completionExpiresAt");

ALTER TABLE "ReservationApplication" ADD COLUMN "submissionId" TEXT;
ALTER TABLE "ReservationApplication" ADD COLUMN "quotedAmount" INTEGER;
ALTER TABLE "ReservationApplication" ADD COLUMN "requestedChildId" TEXT;
ALTER TABLE "ReservationApplication" ADD COLUMN "requestedChildPurgedAt" TIMESTAMP(3);
ALTER TABLE "ChildConsent" ADD COLUMN "consentVersion" TEXT;
-- Phase 20 stores guardian fields on Submission. Recreate the old Phase 18 checks with a
-- legacy/new conditional branch before any new parent submission can be written.
ALTER TABLE "ReservationApplication" DROP CONSTRAINT "reservation_application_personal_data_presence";
ALTER TABLE "ReservationApplication" DROP CONSTRAINT "reservation_application_status_consistency";
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_requestedChildId_fkey"
  FOREIGN KEY ("requestedChildId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "reservation_application_quoted_amount_positive"
  CHECK ("quotedAmount" IS NULL OR ("quotedAmount" > 0 AND "quotedAmount" <= 2147483647));
CREATE INDEX "ReservationApplication_submissionId_status_idx" ON "ReservationApplication"("submissionId", "status");
CREATE INDEX "ReservationApplication_requestedChildId_idx" ON "ReservationApplication"("requestedChildId");
CREATE INDEX "ReservationApplication_requestedChildPurgedAt_idx" ON "ReservationApplication"("requestedChildPurgedAt");
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "reservation_application_personal_data_presence" CHECK (
  ("submissionId" IS NULL AND "quotedAmount" IS NULL AND (
    ("personalDataPurgedAt" IS NULL AND "childName" IS NOT NULL AND "childBirthDate" IS NOT NULL AND "childGender" IS NOT NULL
      AND "guardianName" IS NOT NULL AND "guardianPhone" IS NOT NULL AND "guardianRelationship" IS NOT NULL)
    OR ("personalDataPurgedAt" IS NOT NULL AND "status" <> 'SUBMITTED'::"ReservationApplicationStatus"
      AND "childName" IS NULL AND "childBirthDate" IS NULL AND "childGender" IS NULL AND "guardianName" IS NULL
      AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND "requestNote" IS NULL)
  ))
  OR ("submissionId" IS NOT NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" > 0 AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND (
    ("personalDataPurgedAt" IS NULL AND "childName" IS NOT NULL AND "childBirthDate" IS NOT NULL AND "childGender" IS NOT NULL
      AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" > 0)
    OR ("personalDataPurgedAt" IS NOT NULL AND "status" <> 'SUBMITTED'::"ReservationApplicationStatus"
      AND "childName" IS NULL AND "childBirthDate" IS NULL AND "childGender" IS NULL AND "requestNote" IS NULL
      AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL)
  ))
);
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "reservation_application_status_consistency" CHECK (
  ("submissionId" IS NULL OR ("depositConfirmedAt" IS NULL AND "depositConfirmedById" IS NULL))
  AND (
  ("status" = 'SUBMITTED'::"ReservationApplicationStatus" AND "resolvedAt" IS NULL AND "resolvedById" IS NULL
    AND "resolutionNote" IS NULL AND "childId" IS NULL AND "reservationId" IS NULL)
  OR ("status" = 'CONFIRMED'::"ReservationApplicationStatus" AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL
    AND "resolutionNote" IS NULL AND "childId" IS NOT NULL AND "reservationId" IS NOT NULL
    AND ("submissionId" IS NOT NULL OR "depositConfirmedAt" IS NOT NULL))
  OR ("status" IN ('REJECTED'::"ReservationApplicationStatus", 'CANCELLED'::"ReservationApplicationStatus")
    AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "childId" IS NULL AND "reservationId" IS NULL
    AND (("personalDataPurgedAt" IS NULL AND "resolutionNote" IS NOT NULL AND btrim("resolutionNote") <> '')
      OR ("personalDataPurgedAt" IS NOT NULL AND "resolutionNote" IS NULL))))
);

CREATE TABLE "CompanionInvite" (
  "id" TEXT NOT NULL, "issuerSubmissionId" TEXT NOT NULL, "groupId" TEXT NOT NULL, "companionGroupId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanionInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanionInvite_tokenHash_key" ON "CompanionInvite"("tokenHash");
CREATE INDEX "CompanionInvite_groupId_expiresAt_idx" ON "CompanionInvite"("groupId", "expiresAt");
ALTER TABLE "CompanionInvite" ADD CONSTRAINT "CompanionInvite_issuerSubmissionId_fkey" FOREIGN KEY ("issuerSubmissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionInvite" ADD CONSTRAINT "CompanionInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReservationApplicationGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CompanionGroup" (
  "id" TEXT NOT NULL, "groupId" TEXT NOT NULL, "issuerSubmissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CompanionGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanionGroup_groupId_idx" ON "CompanionGroup"("groupId");
CREATE INDEX "CompanionGroup_issuerSubmissionId_idx" ON "CompanionGroup"("issuerSubmissionId");
ALTER TABLE "CompanionGroup" ADD CONSTRAINT "CompanionGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReservationApplicationGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanionGroup" ADD CONSTRAINT "CompanionGroup_issuerSubmissionId_fkey" FOREIGN KEY ("issuerSubmissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanionInvite" ADD CONSTRAINT "CompanionInvite_companionGroupId_fkey" FOREIGN KEY ("companionGroupId") REFERENCES "CompanionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "CompanionGroupMember" (
  "id" TEXT NOT NULL, "companionGroupId" TEXT NOT NULL, "submissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CompanionGroupMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanionGroupMember_submissionId_key" ON "CompanionGroupMember"("submissionId");
CREATE INDEX "CompanionGroupMember_companionGroupId_idx" ON "CompanionGroupMember"("companionGroupId");
ALTER TABLE "CompanionGroupMember" ADD CONSTRAINT "CompanionGroupMember_companionGroupId_fkey" FOREIGN KEY ("companionGroupId") REFERENCES "CompanionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionGroupMember" ADD CONSTRAINT "CompanionGroupMember_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ApplicationDevice" (
  "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ApplicationDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApplicationDevice_tokenHash_key" ON "ApplicationDevice"("tokenHash");
CREATE INDEX "ApplicationDevice_expiresAt_idx" ON "ApplicationDevice"("expiresAt");
CREATE TABLE "DeviceSubmission" (
  "id" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "submissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DeviceSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceSubmission_deviceId_submissionId_key" ON "DeviceSubmission"("deviceId", "submissionId");
CREATE INDEX "DeviceSubmission_submissionId_idx" ON "DeviceSubmission"("submissionId");
ALTER TABLE "DeviceSubmission" ADD CONSTRAINT "DeviceSubmission_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ApplicationDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceSubmission" ADD CONSTRAINT "DeviceSubmission_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "DeviceChild" (
  "id" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "childId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DeviceChild_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceChild_deviceId_childId_key" ON "DeviceChild"("deviceId", "childId");
CREATE INDEX "DeviceChild_childId_idx" ON "DeviceChild"("childId");
ALTER TABLE "DeviceChild" ADD CONSTRAINT "DeviceChild_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ApplicationDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceChild" ADD CONSTRAINT "DeviceChild_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ApplicationDeposit" (
  "id" TEXT NOT NULL, "submissionId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "payerName" TEXT,
  "depositedAt" TIMESTAMP(3) NOT NULL, "confirmedAt" TIMESTAMP(3) NOT NULL, "confirmedById" TEXT NOT NULL,
  "idempotencyKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationDeposit_pkey" PRIMARY KEY ("id"), CONSTRAINT "application_deposit_amount_positive" CHECK ("amount" > 0 AND "amount" <= 2147483647)
);
CREATE UNIQUE INDEX "ApplicationDeposit_idempotencyKey_key" ON "ApplicationDeposit"("idempotencyKey");
CREATE INDEX "ApplicationDeposit_submissionId_confirmedAt_id_idx" ON "ApplicationDeposit"("submissionId", "confirmedAt", "id");
ALTER TABLE "ApplicationDeposit" ADD CONSTRAINT "ApplicationDeposit_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationDeposit" ADD CONSTRAINT "ApplicationDeposit_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReservationApplicationPaymentMapping" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "paymentItemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ReservationApplicationPaymentMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReservationApplicationPaymentMapping_applicationId_key" ON "ReservationApplicationPaymentMapping"("applicationId");
CREATE UNIQUE INDEX "ReservationApplicationPaymentMapping_paymentItemId_key" ON "ReservationApplicationPaymentMapping"("paymentItemId");
ALTER TABLE "ReservationApplicationPaymentMapping" ADD CONSTRAINT "ReservationApplicationPaymentMapping_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ReservationApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationApplicationPaymentMapping" ADD CONSTRAINT "ReservationApplicationPaymentMapping_paymentItemId_fkey" FOREIGN KEY ("paymentItemId") REFERENCES "PaymentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReturnObligation" (
  "id" TEXT NOT NULL, "submissionId" TEXT NOT NULL, "applicationId" TEXT, "kind" "ReturnObligationKind" NOT NULL,
  "amount" INTEGER NOT NULL, "returnedAmount" INTEGER NOT NULL DEFAULT 0, "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ReturnObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_obligation_amounts" CHECK ("amount" > 0 AND "amount" <= 2147483647 AND "returnedAmount" >= 0 AND "returnedAmount" <= "amount")
);
CREATE UNIQUE INDEX "ReturnObligation_applicationId_kind_key" ON "ReturnObligation"("applicationId", "kind");
CREATE INDEX "ReturnObligation_submissionId_resolvedAt_idx" ON "ReturnObligation"("submissionId", "resolvedAt");
ALTER TABLE "ReturnObligation" ADD CONSTRAINT "ReturnObligation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReservationApplicationSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnObligation" ADD CONSTRAINT "ReturnObligation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ReservationApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ApplicationReturn" (
  "id" TEXT NOT NULL, "returnObligationId" TEXT NOT NULL, "amount" INTEGER NOT NULL,
  "returnedAt" TIMESTAMP(3) NOT NULL, "processedById" TEXT NOT NULL, "reason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ApplicationReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_return_amount_positive" CHECK ("amount" > 0 AND "amount" <= 2147483647)
);
CREATE UNIQUE INDEX "ApplicationReturn_idempotencyKey_key" ON "ApplicationReturn"("idempotencyKey");
CREATE INDEX "ApplicationReturn_returnObligationId_returnedAt_idx" ON "ApplicationReturn"("returnObligationId", "returnedAt");
ALTER TABLE "ApplicationReturn" ADD CONSTRAINT "ApplicationReturn_returnObligationId_fkey" FOREIGN KEY ("returnObligationId") REFERENCES "ReturnObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationReturn" ADD CONSTRAINT "ApplicationReturn_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "FundAllocation" (
  "id" TEXT NOT NULL, "depositId" TEXT NOT NULL, "paymentMappingId" TEXT, "returnObligationId" TEXT,
  "amount" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fund_allocation_one_target" CHECK (
      "amount" > 0 AND "amount" <= 2147483647 AND (("paymentMappingId" IS NOT NULL)::int + ("returnObligationId" IS NOT NULL)::int) = 1
  )
);
CREATE INDEX "FundAllocation_depositId_idx" ON "FundAllocation"("depositId");
CREATE INDEX "FundAllocation_paymentMappingId_idx" ON "FundAllocation"("paymentMappingId");
CREATE INDEX "FundAllocation_returnObligationId_idx" ON "FundAllocation"("returnObligationId");
ALTER TABLE "FundAllocation" ADD CONSTRAINT "FundAllocation_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "ApplicationDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundAllocation" ADD CONSTRAINT "FundAllocation_paymentMappingId_fkey" FOREIGN KEY ("paymentMappingId") REFERENCES "ReservationApplicationPaymentMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundAllocation" ADD CONSTRAINT "FundAllocation_returnObligationId_fkey" FOREIGN KEY ("returnObligationId") REFERENCES "ReturnObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReservationApplicationSettings" (
  "id" INTEGER NOT NULL DEFAULT 1, "bankName" TEXT NOT NULL, "accountNumber" TEXT NOT NULL,
  "accountHolder" TEXT NOT NULL, "blogUrl" TEXT NOT NULL, "instagramUrl" TEXT NOT NULL,
  "kakaoChannelUrl" TEXT NOT NULL, "updatedById" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationApplicationSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_application_settings_singleton" CHECK ("id" = 1),
  CONSTRAINT "reservation_application_settings_non_blank" CHECK (
    btrim("bankName") <> '' AND btrim("accountNumber") <> '' AND btrim("accountHolder") <> ''
    AND btrim("blogUrl") <> '' AND btrim("instagramUrl") <> '' AND btrim("kakaoChannelUrl") <> ''
  )
);
ALTER TABLE "ReservationApplicationSettings" ADD CONSTRAINT "ReservationApplicationSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PreviewE2eRunLease" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "deploymentSha" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "ownedChildIds" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PreviewE2eRunLease_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PreviewE2eRunLease_runId_key" ON "PreviewE2eRunLease"("runId");
CREATE INDEX "PreviewE2eRunLease_expiresAt_idx" ON "PreviewE2eRunLease"("expiresAt");

ALTER TABLE "ReservationApplicationLink" ADD CONSTRAINT "reservation_application_link_legacy_or_group" CHECK (
  ("classScheduleId" IS NOT NULL AND "token" IS NOT NULL AND "groupId" IS NULL AND "tokenHash" IS NULL)
  OR ("classScheduleId" IS NULL AND "token" IS NULL AND "groupId" IS NOT NULL AND "tokenHash" IS NOT NULL)
);
COMMIT;
