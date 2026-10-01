-- Phase 18: confirmed-customer personal data retention (ADR-057).
-- Expand-only change on the existing "Child" table: two nullable columns, a restrictive FK,
-- and CHECK constraints that only constrain rows whose personal data has been purged.
-- Existing rows keep "personalDataPurgedAt" NULL, so every constraint holds for them and the
-- currently deployed application keeps working. Children are never deleted: reservations,
-- applications, payments and refunds keep referencing the anonymized row (RESTRICT FKs).
BEGIN;

ALTER TABLE "Child"
  ADD COLUMN "personalDataPurgedAt" TIMESTAMP(3),
  ADD COLUMN "personalDataPurgedById" TEXT;

ALTER TABLE "Child" ADD CONSTRAINT "Child_personalDataPurgedById_fkey" FOREIGN KEY ("personalDataPurgedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Child"
  ADD CONSTRAINT "child_purge_pair" CHECK (
    ("personalDataPurgedAt" IS NULL) = ("personalDataPurgedById" IS NULL)
  ),
  ADD CONSTRAINT "child_purged_personal_data_cleared" CHECK (
    "personalDataPurgedAt" IS NULL
    OR (
      "name" = '(파기됨)'
      AND "birthDate" IS NULL
      AND "guardianName" IS NULL
      AND "guardianPhone" IS NULL
      AND "memo" IS NULL
      AND "gender" = 'UNSPECIFIED'::"Gender"
      AND "isActive" = false
    )
  );

CREATE INDEX "Child_personalDataPurgedAt_idx" ON "Child"("personalDataPurgedAt");

COMMIT;
