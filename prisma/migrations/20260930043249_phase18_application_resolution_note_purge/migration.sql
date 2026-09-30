-- Phase 18: purge the free-text rejection/cancellation reason together with the rest of the
-- application's personal data (ADR-058). Earlier Phase 18 migrations are left unchanged.
--
-- "resolutionNote" is typed by the operator and may contain personal data, so a purged
-- REJECTED/CANCELLED application must no longer keep it. The status consistency check from
-- 20260929073840 required it for every REJECTED/CANCELLED row, so it is recreated with one
-- change: a purged REJECTED/CANCELLED row must have "resolutionNote" NULL, an unpurged one
-- still needs a non-blank reason. SUBMITTED and CONFIRMED branches are unchanged.
--
-- Phase 18 ships in one release, so "ReservationApplication" is empty in Production and the
-- UPDATE below touches no rows there. On local/Preview databases it clears reasons that an
-- earlier build left on already purged rows so the new check can be added. The old check is
-- dropped first because it would reject those cleared rows.
BEGIN;

ALTER TABLE "ReservationApplication" DROP CONSTRAINT "reservation_application_status_consistency";

UPDATE "ReservationApplication"
SET "resolutionNote" = NULL
WHERE "personalDataPurgedAt" IS NOT NULL
  AND "resolutionNote" IS NOT NULL;

ALTER TABLE "ReservationApplication"
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
      AND "childId" IS NULL
      AND "reservationId" IS NULL
      AND (
        (
          "personalDataPurgedAt" IS NULL
          AND "resolutionNote" IS NOT NULL
          AND btrim("resolutionNote") <> ''
        )
        OR (
          "personalDataPurgedAt" IS NOT NULL
          AND "resolutionNote" IS NULL
        )
      )
    )
  );

COMMIT;
