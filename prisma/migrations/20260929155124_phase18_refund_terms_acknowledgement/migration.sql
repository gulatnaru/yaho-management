-- Phase 18: required cancellation/refund terms acknowledgement (ADR-056).
-- Follows 20260929073840_phase18_reservation_applications and
-- 20260929150958_phase18_application_consent_retention, which are left unchanged.
-- All three ship in the same release, so "ReservationApplication" is still empty in
-- Production when this runs. The preflight keeps local/Preview test rows from
-- silently receiving a NOT NULL acknowledgement they never gave.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ReservationApplication") THEN
    RAISE EXCEPTION
      'Phase 18 refund terms migration requires an empty ReservationApplication table: remove Phase 18 test applications first';
  END IF;
END
$$;

ALTER TABLE "ReservationApplication" ADD COLUMN "refundTermsAcknowledged" BOOLEAN NOT NULL;

ALTER TABLE "ReservationApplication" DROP CONSTRAINT "reservation_application_required_terms";

ALTER TABLE "ReservationApplication"
  ADD CONSTRAINT "reservation_application_required_terms" CHECK (
    "programTermsAcknowledged"
    AND "privacyConsentAgreed"
    AND "legalGuardianConfirmed"
    AND "refundTermsAcknowledged"
  );

COMMIT;
