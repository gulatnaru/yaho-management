-- OFFLINE additive artifact; NOT APPLIED. Apply only after the reviewed private-schema bootstrap.
-- Intentionally separate from prisma/migrations and the production Prisma datasource.
-- Requires an empty/unactivated manual_test schema: no legacy credentials are upgraded.
BEGIN;
SET LOCAL search_path = pg_catalog;
ALTER TABLE "manual_test"."ManualTestRun"
  ADD COLUMN "cleanupHash" TEXT,
  ADD COLUMN "cleanupCsrfHash" TEXT,
  ADD COLUMN "cleanupExpiresAt" TIMESTAMP(3),
  ADD CONSTRAINT "manual_test_cleanup_binding" CHECK (
    ("cleanupHash" IS NULL AND "cleanupCsrfHash" IS NULL AND "cleanupExpiresAt" IS NULL)
    OR ("cleanupHash" ~ '^[a-f0-9]{64}$' AND "cleanupCsrfHash" ~ '^[a-f0-9]{64}$' AND "cleanupExpiresAt" IS NOT NULL)
  );
ALTER TABLE "manual_test"."ManualTestSession" ADD COLUMN "csrfHash" TEXT NOT NULL,
  ADD CONSTRAINT "manual_test_csrf_hash" CHECK ("csrfHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "manual_test"."ApplicationDeposit" ADD COLUMN "applicationId" TEXT NOT NULL,
  ADD CONSTRAINT "ApplicationDeposit_runId_applicationId_fkey"
  FOREIGN KEY ("runId", "applicationId") REFERENCES "manual_test"."ReservationApplication" ("runId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "manual_test"."ManualTestChallenge" (
  "tokenHash" TEXT PRIMARY KEY CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  "csrfHash" TEXT NOT NULL CHECK ("csrfHash" ~ '^[a-f0-9]{64}$'),
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ManualTestChallenge_expiresAt_idx" ON "manual_test"."ManualTestChallenge" ("expiresAt");
ALTER TABLE "manual_test"."ManualTestChallenge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ManualTestChallenge"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
REVOKE ALL ON "manual_test"."ManualTestChallenge" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "manual_test"."ManualTestChallenge" TO "manual_test_runtime";

-- The approved synthetic API permits a zero-price class/application. Preserve all
-- other existing business CHECK terms; only this private copy admits zero prices.
ALTER TABLE "manual_test"."ClassSchedule" DROP CONSTRAINT "class_application_price_positive";
ALTER TABLE "manual_test"."ClassSchedule" ADD CONSTRAINT "class_application_price_positive" CHECK ("applicationPrice" IS NULL OR ("applicationPrice" >= 0 AND "applicationPrice" <= 2147483647));
ALTER TABLE "manual_test"."ReservationApplication" DROP CONSTRAINT "reservation_application_quoted_amount_positive";
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "reservation_application_quoted_amount_positive" CHECK ("quotedAmount" IS NULL OR ("quotedAmount" >= 0 AND "quotedAmount" <= 2147483647));
ALTER TABLE "manual_test"."ReservationApplication" DROP CONSTRAINT "reservation_application_personal_data_presence";
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "reservation_application_personal_data_presence" CHECK (
    ("submissionId" IS NULL AND "quotedAmount" IS NULL AND (
      ("personalDataPurgedAt" IS NULL AND "childName" IS NOT NULL AND "childBirthDate" IS NOT NULL AND "childGender" IS NOT NULL
        AND "guardianName" IS NOT NULL AND "guardianPhone" IS NOT NULL AND "guardianRelationship" IS NOT NULL)
      OR ("personalDataPurgedAt" IS NOT NULL AND "status" <> 'SUBMITTED'::"manual_test"."ReservationApplicationStatus"
        AND "childName" IS NULL AND "childBirthDate" IS NULL AND "childGender" IS NULL AND "guardianName" IS NULL
        AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND "requestNote" IS NULL)
    ))
    OR ("submissionId" IS NOT NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" >= 0 AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND (
      ("personalDataPurgedAt" IS NULL AND "childName" IS NOT NULL AND "childBirthDate" IS NOT NULL AND "childGender" IS NOT NULL
        AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" >= 0)
      OR ("personalDataPurgedAt" IS NOT NULL AND "status" <> 'SUBMITTED'::"manual_test"."ReservationApplicationStatus"
        AND "childName" IS NULL AND "childBirthDate" IS NULL AND "childGender" IS NULL AND "requestNote" IS NULL
        AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL)
    )));
COMMIT;
