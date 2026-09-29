-- Phase 18: reservation applications (ADR-052~054).
-- Expand-only change: adds a new enum, two new tables and one nullable column on
-- "ChildConsent". Existing rows and the currently deployed application keep working
-- because nothing existing is renamed, dropped or made stricter.
BEGIN;

-- CreateEnum
CREATE TYPE "ReservationApplicationStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ChildConsent" ADD COLUMN "reservationApplicationId" TEXT;

-- CreateTable
CREATE TABLE "ReservationApplicationLink" (
    "id" TEXT NOT NULL,
    "classScheduleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationApplicationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationApplication" (
    "id" TEXT NOT NULL,
    "classScheduleId" TEXT NOT NULL,
    "status" "ReservationApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "childName" TEXT NOT NULL,
    "childBirthDate" DATE NOT NULL,
    "childGender" "Gender" NOT NULL,
    "guardianName" TEXT NOT NULL,
    "guardianPhone" TEXT NOT NULL,
    "requestNote" TEXT,
    "privacyConsentAgreed" BOOLEAN NOT NULL,
    "photoShareConsentAgreed" BOOLEAN NOT NULL,
    "photoMarketingConsentAgreed" BOOLEAN NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depositConfirmedAt" TIMESTAMP(3),
    "depositConfirmedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "childId" TEXT,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChildConsent_reservationApplicationId_idx" ON "ChildConsent"("reservationApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationApplicationLink_classScheduleId_key" ON "ReservationApplicationLink"("classScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationApplicationLink_token_key" ON "ReservationApplicationLink"("token");

-- CreateIndex
CREATE INDEX "ReservationApplication_status_submittedAt_idx" ON "ReservationApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ReservationApplication_classScheduleId_status_idx" ON "ReservationApplication"("classScheduleId", "status");

-- CreateIndex
CREATE INDEX "ReservationApplication_childId_idx" ON "ReservationApplication"("childId");

-- CreateIndex
CREATE INDEX "ReservationApplication_reservationId_idx" ON "ReservationApplication"("reservationId");

-- AddForeignKey
ALTER TABLE "ChildConsent" ADD CONSTRAINT "ChildConsent_reservationApplicationId_fkey" FOREIGN KEY ("reservationApplicationId") REFERENCES "ReservationApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_depositConfirmedById_fkey" FOREIGN KEY ("depositConfirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL CHECK constraints. Zod validation and conditional server writes are the first
-- line of defense; these constraints are the second (see prisma/schema.prisma bottom).
ALTER TABLE "ReservationApplicationLink"
  ADD CONSTRAINT "reservation_application_link_token_length" CHECK (char_length("token") >= 32);

ALTER TABLE "ReservationApplication"
  ADD CONSTRAINT "reservation_application_text_not_blank" CHECK (
    btrim("childName") <> ''
    AND btrim("guardianName") <> ''
    AND btrim("guardianPhone") <> ''
    AND btrim("consentVersion") <> ''
  ),
  ADD CONSTRAINT "reservation_application_required_consents" CHECK (
    "privacyConsentAgreed" AND "photoShareConsentAgreed"
  ),
  ADD CONSTRAINT "reservation_application_deposit_pair" CHECK (
    ("depositConfirmedAt" IS NULL) = ("depositConfirmedById" IS NULL)
  ),
  ADD CONSTRAINT "reservation_application_status_consistency" CHECK (
    (
      "status" = 'SUBMITTED'::"ReservationApplicationStatus"
      AND "resolvedAt" IS NULL
      AND "resolvedById" IS NULL
      AND "resolutionNote" IS NULL
      AND "childId" IS NULL
      AND "reservationId" IS NULL
    )
    OR (
      "status" = 'CONFIRMED'::"ReservationApplicationStatus"
      AND "resolvedAt" IS NOT NULL
      AND "resolvedById" IS NOT NULL
      AND "resolutionNote" IS NULL
      AND "depositConfirmedAt" IS NOT NULL
      AND "childId" IS NOT NULL
      AND "reservationId" IS NOT NULL
    )
    OR (
      "status" IN ('REJECTED'::"ReservationApplicationStatus", 'CANCELLED'::"ReservationApplicationStatus")
      AND "resolvedAt" IS NOT NULL
      AND "resolvedById" IS NOT NULL
      AND "resolutionNote" IS NOT NULL
      AND btrim("resolutionNote") <> ''
      AND "childId" IS NULL
      AND "reservationId" IS NULL
    )
  );

COMMIT;
