-- YAHO manual-test rollback SQL artifact. GENERATED OFFLINE; NOT APPLIED.
-- Removes the 29 tables, 20 enum types, private schema and BOTH roles created by
-- migration.sql. No public objects, global ACLs, or unrelated objects are changed.
-- Future execution requires explicit target/SQL/SHA approval. Authenticate as the
-- approved provisioner that owns the schema/objects and can drop both roles.
-- Stop app traffic and close runtime connections BEFORE execution; keep new traffic
-- disabled until COMMIT. The guard refuses active role sessions; it never terminates
-- them. Privileged sessions that SET ROLE must also be closed by the operator.
-- This is an atomic rollback of the complete bootstrap, not a partial-state repair:
-- missing objects/roles or external dependencies abort the transaction for review.
-- After rollback, verify the schema and both roles are absent and public is unchanged.

BEGIN;
SET LOCAL search_path = pg_catalog;

DO $manual_test_rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename IN ('manual_test_migrator', 'manual_test_runtime')
  ) THEN
    RAISE EXCEPTION 'Close all manual-test role sessions before rollback';
  END IF;
END;
$manual_test_rollback$;

-- One statement resolves all internal FK dependencies, including cycles. RESTRICT
-- refuses dependencies from outside this explicit set rather than removing them.
DROP TABLE
  "manual_test"."DeviceChild",
  "manual_test"."DeviceSubmission",
  "manual_test"."ApplicationDevice",
  "manual_test"."Refund",
  "manual_test"."PaymentItem",
  "manual_test"."Payment",
  "manual_test"."Reservation",
  "manual_test"."ReservationApplicationSettings",
  "manual_test"."FundAllocation",
  "manual_test"."ApplicationReturn",
  "manual_test"."ReturnObligation",
  "manual_test"."ReservationApplicationPaymentMapping",
  "manual_test"."ApplicationDeposit",
  "manual_test"."ReservationApplication",
  "manual_test"."ReservationApplicationSubmission",
  "manual_test"."ReservationApplicationLink",
  "manual_test"."ReservationApplicationGroupClass",
  "manual_test"."ReservationApplicationGroup",
  "manual_test"."ChildConsent",
  "manual_test"."Child",
  "manual_test"."ClassTeacher",
  "manual_test"."ClassSchedule",
  "manual_test"."Program",
  "manual_test"."Teacher",
  "manual_test"."User",
  "manual_test"."ManualTestOperationReceipt",
  "manual_test"."ManualTestAccessGrant",
  "manual_test"."ManualTestSession",
  "manual_test"."ManualTestRun"
  RESTRICT;

DROP TYPE
  "manual_test"."ManualTestGrantPurpose",
  "manual_test"."ManualTestSessionScope",
  "manual_test"."ManualTestRunStatus",
  "manual_test"."RefundStatus",
  "manual_test"."RefundReason",
  "manual_test"."PayerType",
  "manual_test"."PaymentMethod",
  "manual_test"."PaymentStatus",
  "manual_test"."AttendanceStatus",
  "manual_test"."ReservationCancelReason",
  "manual_test"."ReservationStatus",
  "manual_test"."ClassCancelReason",
  "manual_test"."ClassStatus",
  "manual_test"."ProgramStatus",
  "manual_test"."ReturnObligationKind",
  "manual_test"."ReservationApplicationStatus",
  "manual_test"."GuardianRelationship",
  "manual_test"."ConsentAction",
  "manual_test"."ConsentType",
  "manual_test"."Gender"
  RESTRICT;

DROP SCHEMA "manual_test" RESTRICT;
-- Dropped tables remove RLS policies and object ACL references to the runtime role.
-- DROP ROLE refuses any remaining ownership/ACL dependencies elsewhere; no DROP OWNED.
DROP ROLE "manual_test_runtime";
DROP ROLE "manual_test_migrator";

COMMIT;
