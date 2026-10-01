-- Phase 18: application terms, legal guardian confirmation and retention purge (ADR-055).
-- Follows 20260929073840_phase18_reservation_applications, which is left unchanged.
-- Both migrations ship in the same release, so "ReservationApplication" is still empty
-- in Production when this runs. The preflight below makes that assumption explicit for
-- local/Preview databases that may hold Phase 18 test rows.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ReservationApplication") THEN
    RAISE EXCEPTION
      'Phase 18 consent migration requires an empty ReservationApplication table: remove Phase 18 test applications first';
  END IF;
END
$$;

-- New value is not used by any row, default or constraint before COMMIT.
ALTER TYPE "ConsentAction" ADD VALUE 'DECLINED';

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'OTHER_LEGAL_GUARDIAN');

-- Personal data becomes purgeable after the retention period.
ALTER TABLE "ReservationApplication"
  ALTER COLUMN "childName" DROP NOT NULL,
  ALTER COLUMN "childBirthDate" DROP NOT NULL,
  ALTER COLUMN "childGender" DROP NOT NULL,
  ALTER COLUMN "guardianName" DROP NOT NULL,
  ALTER COLUMN "guardianPhone" DROP NOT NULL,
  ADD COLUMN "guardianRelationship" "GuardianRelationship",
  ADD COLUMN "programTermsAcknowledged" BOOLEAN NOT NULL,
  ADD COLUMN "legalGuardianConfirmed" BOOLEAN NOT NULL,
  ADD COLUMN "personalDataPurgedAt" TIMESTAMP(3),
  ADD COLUMN "personalDataPurgedById" TEXT;

-- AddForeignKey
ALTER TABLE "ReservationApplication" ADD CONSTRAINT "ReservationApplication_personalDataPurgedById_fkey" FOREIGN KEY ("personalDataPurgedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Photo sharing is now optional (ADR-055). Program terms, privacy and legal guardian
-- confirmation are the required acknowledgements.
ALTER TABLE "ReservationApplication"
  DROP CONSTRAINT "reservation_application_required_consents",
  ADD CONSTRAINT "reservation_application_required_terms" CHECK (
    "programTermsAcknowledged" AND "privacyConsentAgreed" AND "legalGuardianConfirmed"
  ),
  ADD CONSTRAINT "reservation_application_purge_pair" CHECK (
    ("personalDataPurgedAt" IS NULL) = ("personalDataPurgedById" IS NULL)
  ),
  ADD CONSTRAINT "reservation_application_personal_data_presence" CHECK (
    (
      "personalDataPurgedAt" IS NULL
      AND "childName" IS NOT NULL
      AND "childBirthDate" IS NOT NULL
      AND "childGender" IS NOT NULL
      AND "guardianName" IS NOT NULL
      AND "guardianPhone" IS NOT NULL
      AND "guardianRelationship" IS NOT NULL
    )
    OR (
      "personalDataPurgedAt" IS NOT NULL
      AND "status" <> 'SUBMITTED'::"ReservationApplicationStatus"
      AND "childName" IS NULL
      AND "childBirthDate" IS NULL
      AND "childGender" IS NULL
      AND "guardianName" IS NULL
      AND "guardianPhone" IS NULL
      AND "guardianRelationship" IS NULL
      AND "requestNote" IS NULL
    )
  );

CREATE INDEX "ReservationApplication_personalDataPurgedAt_idx" ON "ReservationApplication"("personalDataPurgedAt");

COMMIT;
