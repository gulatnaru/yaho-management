-- YAHO manual-test bootstrap SQL artifact. GENERATED OFFLINE; NOT APPLIED.
-- Sources: prisma/schema.prisma; prisma/migrations/*/migration.sql (final CHECK state);
-- docs/MANUAL_TEST_PLAN.md (25 business + 4 control tables; run isolation).
-- Source schema SHA-256: ebda70b8a32818ca15a187d7b914a674bded59acddf4f1f08617ab3c608d5dd5
-- The source has 50 models. These are the documented 29, NOT 29 public clones:
--  1. ManualTestRun
--  2. ManualTestSession
--  3. ManualTestAccessGrant
--  4. ManualTestOperationReceipt
--  5. User
--  6. Teacher
--  7. Program
--  8. ClassSchedule
--  9. ClassTeacher
-- 10. Child
-- 11. ChildConsent
-- 12. ReservationApplicationGroup
-- 13. ReservationApplicationGroupClass
-- 14. ReservationApplicationLink
-- 15. ReservationApplicationSubmission
-- 16. ReservationApplication
-- 17. ApplicationDeposit
-- 18. ReservationApplicationPaymentMapping
-- 19. ReturnObligation
-- 20. ApplicationReturn
-- 21. FundAllocation
-- 22. ReservationApplicationSettings
-- 23. Reservation
-- 24. Payment
-- 25. PaymentItem
-- 26. Refund
-- 27. ApplicationDevice
-- 28. DeviceSubmission
-- 29. DeviceChild
-- Revenue is calculated from Reservation/Payment/PaymentItem/Refund; no Revenue table.
-- All CREATE TABLE statements are explicit, empty definitions; no source/data reads,
-- LIKE INCLUDING ALL, public enum references, shared sequences, or data-copy commands.
--
-- PLAN adaptations from public definitions:
-- * Every non-root table has runId and UNIQUE(runId,id); business FKs are composite.
-- * Uniques/indexes are run-scoped, except opaque token/completion hashes (global).
-- * User is an audit-only synthetic actor: id/name/isActive/timestamps, no credentials,
--   account role, teacher binding, auth version, or account-only constraints/indexes.
-- * ReservationApplicationLink supports hashed group links only: remove legacy
--   classScheduleId/token, require groupId/tokenHash, replace legacy token CHECKs.
-- * ReservationApplicationSettings has application-supplied TEXT id, one row per run;
--   remove the public id=1 default/singleton CHECK; keep nonblank configuration CHECK.
-- * Group's syntheticRunId/syntheticSettings remain optional inert scalar snapshots;
--   they do NOT authorize E2E leases or replace run-scoped settings/authorization.
-- * Excluded relations: safety info, relationships, companion groups, account changes,
--   PreviewE2eRunLease and AI models. No new dependency on those delegates or tables.
-- * cuid() and @updatedAt are Prisma-client behaviors, not server SQL defaults.
-- * Source business indexes have no partial predicates; preserve their full indexes.
-- * Optional FK SET NULL targets only its nullable target column (requires PG >= 15),
--   never the shared NOT NULL runId. Cleanup must delete in FK-safe order.
--
-- EXECUTION STATUS: reviewable file only; no database/activation authorization.
-- Future execution requires explicit target/SQL/SHA/ACL approval and PG >= 15.
-- Authentication / role flow:
-- 1. Authenticate as an approved provisioner with permission to create roles/schema,
--    grant/assume the migrator role, and reassign its objects to CURRENT_USER.
--    CURRENT_USER must remain that provisioner outside the local SET ROLE below.
-- 2. Create fresh manual_test_migrator (NOLOGIN) and manual_test_runtime (LOGIN).
--    Abort atomically if manual_test or either new role exists; never reuse roles.
--    Temporarily grant migrator membership/schema CREATE to the provisioner and
--    SET LOCAL ROLE manual_test_migrator for enum/table/constraint/index/RLS DDL.
-- 3. RESET ROLE, transfer all migrator-owned objects to the provisioner, revoke
--    migrator schema privileges/membership, and retain NOLOGIN with PASSWORD NULL.
--    The locked migrator owns nothing and cannot create/alter/drop these objects.
-- 4. The server app connects as manual_test_runtime, using credentials provisioned
--    externally through an approved secret flow. LOGIN with PASSWORD NULL does not
--    supply working authentication; password auth fails until a password is set.
--    Verify the target's authentication/pooler configuration before app activation.
--    Runtime has schema USAGE, enum USAGE and table SELECT/INSERT/UPDATE/DELETE;
--    it has no schema CREATE, object ownership, migrator membership or grant option.
--    Browser Auth.js/manual-test cookies authorize app requests separately from
--    this server-side database identity; never send DB credentials to the browser.
-- No credentials, DATABASE grants, global PUBLIC changes or default ACL changes.
--
-- Historical DB diagnostics (provided for the earlier single-role artifact; not rerun):
-- * Project ref: azlfamqrmbfsvjnpozmr
-- * PostgreSQL: 17.6
-- * PUBLIC USAGE on public: yes
-- * PUBLIC SELECT on public tables: 0
-- * manual_test schema: not exists
-- * legacy manual_test_role: not exists (neither new role was checked)
--
-- ACL design: DB-level isolation from public tables is achievable because public
-- tables have no PUBLIC grants in the supplied diagnostic results. PUBLIC USAGE
-- on schema public alone does not grant table access.
-- PostgreSQL PUBLIC privileges are additive, including outside this schema; NOINHERIT
-- and search_path do NOT remove PUBLIC privileges or block schema-qualified access.
-- Independently verify PUBLIC grants, SECURITY DEFINER paths, default ACLs, ownership,
-- role memberships, pooler behavior and all effective rights BEFORE future runtime activation.
-- Do not add manual_test to Supabase Data API exposed schemas, publications, or
-- grant anon/authenticated/service_role access. Existing platform configuration and
-- privileged/default ACL behavior are deliberately NOT changed by this artifact.
-- Private-schema RLS below permits only manual_test_runtime; it is defense in depth,
-- not a replacement for schema ACL checks (e.g. service_role can bypass RLS).
-- References: https://www.postgresql.org/docs/current/ddl-priv.html
-- https://www.postgresql.org/docs/current/sql-createtable.html
-- https://www.postgresql.org/docs/17/sql-grant.html
-- https://www.postgresql.org/docs/17/sql-reassign-owned.html
-- https://supabase.com/docs/guides/api/using-custom-schemas

BEGIN;
SET LOCAL search_path = pg_catalog;

-- The provisioner owns the schema throughout; object DDL runs as the migrator.
CREATE SCHEMA "manual_test";
CREATE ROLE "manual_test_migrator" WITH
  NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE "manual_test_runtime" WITH
  LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE "manual_test_runtime" SET search_path = "manual_test";

-- Only this newly created private schema is affected by these schema ACLs.
REVOKE ALL PRIVILEGES ON SCHEMA "manual_test" FROM PUBLIC;
REVOKE CREATE ON SCHEMA "manual_test" FROM "manual_test_runtime";
GRANT USAGE ON SCHEMA "manual_test" TO "manual_test_runtime";
GRANT "manual_test_migrator" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA "manual_test" TO "manual_test_migrator";
SET LOCAL ROLE "manual_test_migrator";

-- Independent enums, including their final current labels.

CREATE TYPE "manual_test"."Gender" AS ENUM ('MALE', 'FEMALE', 'UNSPECIFIED');
CREATE TYPE "manual_test"."ConsentType" AS ENUM ('PRIVACY', 'SENSITIVE_INFO', 'PHOTO_SHARE', 'PHOTO_MARKETING');
CREATE TYPE "manual_test"."ConsentAction" AS ENUM ('AGREED', 'REVOKED', 'DECLINED');
CREATE TYPE "manual_test"."GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'OTHER_LEGAL_GUARDIAN');
CREATE TYPE "manual_test"."ReservationApplicationStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED', 'CANCELLED');
CREATE TYPE "manual_test"."ReturnObligationKind" AS ENUM ('REJECTED', 'CANCELLED', 'EXCESS');
CREATE TYPE "manual_test"."ProgramStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "manual_test"."ClassStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "manual_test"."ClassCancelReason" AS ENUM ('WEATHER', 'SAFETY', 'MINIMUM_ENROLLMENT', 'OPERATION', 'OTHER');
CREATE TYPE "manual_test"."ReservationStatus" AS ENUM ('RESERVED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
CREATE TYPE "manual_test"."ReservationCancelReason" AS ENUM ('PERSONAL', 'ILLNESS', 'SCHEDULE', 'WEATHER', 'DUPLICATE', 'OPERATION', 'OTHER');
CREATE TYPE "manual_test"."AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');
CREATE TYPE "manual_test"."PaymentStatus" AS ENUM ('PAID', 'PARTIAL_REFUNDED', 'REFUNDED', 'CANCELLED');
CREATE TYPE "manual_test"."PaymentMethod" AS ENUM ('CARD', 'TRANSFER', 'CASH', 'OTHER');
CREATE TYPE "manual_test"."PayerType" AS ENUM ('GUARDIAN', 'ORGANIZATION');
CREATE TYPE "manual_test"."RefundReason" AS ENUM ('PERSONAL', 'ILLNESS', 'WEATHER', 'SCHEDULE', 'DUPLICATE_PAYMENT', 'CLASS_CANCELLED', 'OPERATION', 'OTHER');
CREATE TYPE "manual_test"."RefundStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "manual_test"."ManualTestRunStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CLEANUP_PENDING', 'CLEANED');
CREATE TYPE "manual_test"."ManualTestSessionScope" AS ENUM ('OPERATOR', 'RESERVATION');
CREATE TYPE "manual_test"."ManualTestGrantPurpose" AS ENUM ('RESERVATION_SESSION_EXCHANGE');

-- Explicit empty table definitions; all constraints are attached to new tables.

CREATE TABLE "manual_test"."ManualTestRun" (
  "id" TEXT NOT NULL,
  "startRequestKey" TEXT NOT NULL,
  "status" "manual_test"."ManualTestRunStatus" NOT NULL DEFAULT 'ACTIVE',
  "deploymentSha" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "cleanedAt" TIMESTAMP(3),
  "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastCleanupCode" TEXT,
  CONSTRAINT "ManualTestRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_test_run_times" CHECK ("expiresAt" > "createdAt" AND ("closedAt" IS NULL OR "closedAt" >= "createdAt") AND ("cleanedAt" IS NULL OR "cleanedAt" >= "closedAt")),
  CONSTRAINT "manual_test_run_state" CHECK (
    ("status" = 'ACTIVE' AND "closedAt" IS NULL AND "cleanedAt" IS NULL)
    OR ("status" IN ('CLOSED', 'CLEANUP_PENDING') AND "closedAt" IS NOT NULL AND "cleanedAt" IS NULL)
    OR ("status" = 'CLEANED' AND "closedAt" IS NOT NULL AND "cleanedAt" IS NOT NULL)
  ),
  CONSTRAINT "manual_test_run_cleanup_nonnegative" CHECK ("cleanupAttempts" >= 0),
  CONSTRAINT "manual_test_run_identifiers_not_blank" CHECK (pg_catalog.btrim("startRequestKey") <> '' AND pg_catalog.btrim("deploymentSha") <> '' AND pg_catalog.btrim("schemaVersion") <> '')
);

CREATE TABLE "manual_test"."ManualTestSession" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scope" "manual_test"."ManualTestSessionScope" NOT NULL,
  "actorUserId" TEXT,
  "linkId" TEXT,
  "submissionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ManualTestSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_test_session_binding" CHECK (
    ("scope" = 'OPERATOR' AND "actorUserId" IS NOT NULL AND "linkId" IS NULL AND "submissionId" IS NULL)
    OR ("scope" = 'RESERVATION' AND "actorUserId" IS NULL AND "linkId" IS NOT NULL)
  ),
  CONSTRAINT "manual_test_session_times" CHECK ("expiresAt" > "createdAt" AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")),
  CONSTRAINT "manual_test_session_hash_not_blank" CHECK (pg_catalog.btrim("tokenHash") <> '')
);

CREATE TABLE "manual_test"."ManualTestAccessGrant" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "linkId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" "manual_test"."ManualTestGrantPurpose" NOT NULL DEFAULT 'RESERVATION_SESSION_EXCHANGE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualTestAccessGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_test_access_grant_times" CHECK ("expiresAt" > "createdAt" AND ("consumedAt" IS NULL OR ("consumedAt" >= "createdAt" AND "consumedAt" <= "expiresAt"))),
  CONSTRAINT "manual_test_access_grant_hash_not_blank" CHECK (pg_catalog.btrim("tokenHash") <> '')
);

CREATE TABLE "manual_test"."ManualTestOperationReceipt" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "resultIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualTestOperationReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_test_operation_receipt_not_blank" CHECK (pg_catalog.btrim("operation") <> '' AND pg_catalog.btrim("requestKey") <> '' AND pg_catalog.btrim("payloadDigest") <> '')
);

CREATE TABLE "manual_test"."User" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."Teacher" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "memo" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_name_not_blank" CHECK (btrim("name") <> '')
);

CREATE TABLE "manual_test"."Program" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "targetAgeMin" INTEGER,
  "targetAgeMax" INTEGER,
  "defaultDuration" INTEGER,
  "defaultPrice" INTEGER NOT NULL DEFAULT 0,
  "status" "manual_test"."ProgramStatus" NOT NULL DEFAULT 'ACTIVE',
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Program_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "program_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "program_target_age_range" CHECK (
      ("targetAgeMin" IS NULL OR "targetAgeMin" >= 0)
      AND ("targetAgeMax" IS NULL OR "targetAgeMax" >= 0)
      AND ("targetAgeMin" IS NULL OR "targetAgeMax" IS NULL OR "targetAgeMin" <= "targetAgeMax")
    ),
  CONSTRAINT "program_default_duration_positive" CHECK ("defaultDuration" IS NULL OR "defaultDuration" > 0),
  CONSTRAINT "program_default_price_nonneg" CHECK ("defaultPrice" >= 0)
);

CREATE TABLE "manual_test"."ClassSchedule" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "location" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 8,
  "status" "manual_test"."ClassStatus" NOT NULL DEFAULT 'SCHEDULED',
  "memo" TEXT,
  "applicationPrice" INTEGER,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" "manual_test"."ClassCancelReason",
  "cancelDetail" TEXT,
  "cancelledById" TEXT,
  "insured" BOOLEAN NOT NULL DEFAULT false,
  "insurer" TEXT,
  "insurancePolicyNo" TEXT,
  "safetyMemo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "class_capacity_positive" CHECK ("capacity" >= 1),
  CONSTRAINT "class_time_order" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "class_application_price_positive" CHECK ("applicationPrice" IS NULL OR ("applicationPrice" > 0 AND "applicationPrice" <= 2147483647))
);

CREATE TABLE "manual_test"."ClassTeacher" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "classScheduleId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassTeacher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."Child" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "birthDate" DATE,
  "gender" "manual_test"."Gender" NOT NULL DEFAULT 'UNSPECIFIED',
  "guardianName" TEXT,
  "guardianPhone" TEXT,
  "memo" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "personalDataPurgedAt" TIMESTAMP(3),
  "personalDataPurgedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Child_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "child_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "child_purge_pair" CHECK (
      ("personalDataPurgedAt" IS NULL) = ("personalDataPurgedById" IS NULL)
    ),
  CONSTRAINT "child_purged_personal_data_cleared" CHECK (
      "personalDataPurgedAt" IS NULL
      OR (
        "name" = '(파기됨)'
        AND "birthDate" IS NULL
        AND "guardianName" IS NULL
        AND "guardianPhone" IS NULL
        AND "memo" IS NULL
        AND "gender" = 'UNSPECIFIED'::"manual_test"."Gender"
        AND "isActive" = false
      )
    )
);

CREATE TABLE "manual_test"."ChildConsent" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "consentType" "manual_test"."ConsentType" NOT NULL,
  "action" "manual_test"."ConsentAction" NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById" TEXT,
  "reservationApplicationId" TEXT,
  "consentVersion" TEXT,
  CONSTRAINT "ChildConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."ReservationApplicationGroup" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "syntheticRunId" TEXT,
  "upgradedLegacyClassScheduleId" TEXT,
  "syntheticSettings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationApplicationGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."ReservationApplicationGroupClass" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "classScheduleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationApplicationGroupClass_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."ReservationApplicationLink" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationApplicationLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_application_link_hash_not_blank" CHECK (pg_catalog.btrim("tokenHash") <> '')
);

CREATE TABLE "manual_test"."ReservationApplicationSubmission" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "groupId" TEXT,
  "guardianName" TEXT,
  "guardianPhone" TEXT,
  "guardianRelationship" "manual_test"."GuardianRelationship",
  "declaredPayerName" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "depositNotifiedAt" TIMESTAMP(3),
  "personalDataPurgedAt" TIMESTAMP(3),
  "completionTokenHash" TEXT,
  "completionExpiresAt" TIMESTAMP(3),
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationApplicationSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."ReservationApplication" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "classScheduleId" TEXT NOT NULL,
  "submissionId" TEXT,
  "quotedAmount" INTEGER,
  "requestedChildId" TEXT,
  "requestedChildPurgedAt" TIMESTAMP(3),
  "status" "manual_test"."ReservationApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "childName" TEXT,
  "childBirthDate" DATE,
  "childGender" "manual_test"."Gender",
  "guardianName" TEXT,
  "guardianPhone" TEXT,
  "guardianRelationship" "manual_test"."GuardianRelationship",
  "requestNote" TEXT,
  "programTermsAcknowledged" BOOLEAN NOT NULL,
  "privacyConsentAgreed" BOOLEAN NOT NULL,
  "legalGuardianConfirmed" BOOLEAN NOT NULL,
  "refundTermsAcknowledged" BOOLEAN NOT NULL,
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
  "personalDataPurgedAt" TIMESTAMP(3),
  "personalDataPurgedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_application_text_not_blank" CHECK (
      btrim("childName") <> ''
      AND btrim("guardianName") <> ''
      AND btrim("guardianPhone") <> ''
      AND btrim("consentVersion") <> ''
    ),
  CONSTRAINT "reservation_application_deposit_pair" CHECK (
      ("depositConfirmedAt" IS NULL) = ("depositConfirmedById" IS NULL)
    ),
  CONSTRAINT "reservation_application_purge_pair" CHECK (
      ("personalDataPurgedAt" IS NULL) = ("personalDataPurgedById" IS NULL)
    ),
  CONSTRAINT "reservation_application_required_terms" CHECK (
      "programTermsAcknowledged"
      AND "privacyConsentAgreed"
      AND "legalGuardianConfirmed"
      AND "refundTermsAcknowledged"
    ),
  CONSTRAINT "reservation_application_quoted_amount_positive" CHECK ("quotedAmount" IS NULL OR ("quotedAmount" > 0 AND "quotedAmount" <= 2147483647)),
  CONSTRAINT "reservation_application_personal_data_presence" CHECK (
    ("submissionId" IS NULL AND "quotedAmount" IS NULL AND (
      ("personalDataPurgedAt" IS NULL AND "childName" IS NOT NULL AND "childBirthDate" IS NOT NULL AND "childGender" IS NOT NULL
        AND "guardianName" IS NOT NULL AND "guardianPhone" IS NOT NULL AND "guardianRelationship" IS NOT NULL)
      OR ("personalDataPurgedAt" IS NOT NULL AND "status" <> 'SUBMITTED'::"manual_test"."ReservationApplicationStatus"
        AND "childName" IS NULL AND "childBirthDate" IS NULL AND "childGender" IS NULL AND "guardianName" IS NULL
        AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND "requestNote" IS NULL)
    ))
    OR ("submissionId" IS NOT NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" > 0 AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND (
      ("personalDataPurgedAt" IS NULL AND "childName" IS NOT NULL AND "childBirthDate" IS NOT NULL AND "childGender" IS NOT NULL
        AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" > 0)
      OR ("personalDataPurgedAt" IS NOT NULL AND "status" <> 'SUBMITTED'::"manual_test"."ReservationApplicationStatus"
        AND "childName" IS NULL AND "childBirthDate" IS NULL AND "childGender" IS NULL AND "requestNote" IS NULL
        AND "guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL)
    ))
  ),
  CONSTRAINT "reservation_application_status_consistency" CHECK (
    ("submissionId" IS NULL OR ("depositConfirmedAt" IS NULL AND "depositConfirmedById" IS NULL))
    AND (
    ("status" = 'SUBMITTED'::"manual_test"."ReservationApplicationStatus" AND "resolvedAt" IS NULL AND "resolvedById" IS NULL
      AND "resolutionNote" IS NULL AND "childId" IS NULL AND "reservationId" IS NULL)
    OR ("status" = 'CONFIRMED'::"manual_test"."ReservationApplicationStatus" AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL
      AND "resolutionNote" IS NULL AND "childId" IS NOT NULL AND "reservationId" IS NOT NULL
      AND ("submissionId" IS NOT NULL OR "depositConfirmedAt" IS NOT NULL))
    OR ("status" IN ('REJECTED'::"manual_test"."ReservationApplicationStatus", 'CANCELLED'::"manual_test"."ReservationApplicationStatus")
      AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "childId" IS NULL AND "reservationId" IS NULL
      AND (("personalDataPurgedAt" IS NULL AND "resolutionNote" IS NOT NULL AND btrim("resolutionNote") <> '')
        OR ("personalDataPurgedAt" IS NOT NULL AND "resolutionNote" IS NULL))))
  )
);

CREATE TABLE "manual_test"."ApplicationDeposit" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "payerName" TEXT,
  "depositedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "confirmedById" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationDeposit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_deposit_amount_positive" CHECK ("amount" > 0 AND "amount" <= 2147483647)
);

CREATE TABLE "manual_test"."ReservationApplicationPaymentMapping" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "paymentItemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationApplicationPaymentMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."ReturnObligation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "applicationId" TEXT,
  "kind" "manual_test"."ReturnObligationKind" NOT NULL,
  "amount" INTEGER NOT NULL,
  "returnedAmount" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_obligation_amounts" CHECK ("amount" > 0 AND "amount" <= 2147483647 AND "returnedAmount" >= 0 AND "returnedAmount" <= "amount")
);

CREATE TABLE "manual_test"."ApplicationReturn" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "returnObligationId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "returnedAt" TIMESTAMP(3) NOT NULL,
  "processedById" TEXT NOT NULL,
  "reason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_return_amount_positive" CHECK ("amount" > 0 AND "amount" <= 2147483647)
);

CREATE TABLE "manual_test"."FundAllocation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "paymentMappingId" TEXT,
  "returnObligationId" TEXT,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fund_allocation_one_target" CHECK (
        "amount" > 0 AND "amount" <= 2147483647 AND (("paymentMappingId" IS NOT NULL)::int + ("returnObligationId" IS NOT NULL)::int) = 1
    )
);

CREATE TABLE "manual_test"."ReservationApplicationSettings" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountHolder" TEXT NOT NULL,
  "blogUrl" TEXT NOT NULL,
  "instagramUrl" TEXT NOT NULL,
  "kakaoChannelUrl" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationApplicationSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_application_settings_non_blank" CHECK (
      btrim("bankName") <> '' AND btrim("accountNumber") <> '' AND btrim("accountHolder") <> ''
      AND btrim("blogUrl") <> '' AND btrim("instagramUrl") <> '' AND btrim("kakaoChannelUrl") <> ''
    )
);

CREATE TABLE "manual_test"."Reservation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "classScheduleId" TEXT NOT NULL,
  "status" "manual_test"."ReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "attendance" "manual_test"."AttendanceStatus",
  "attendanceRecordedById" TEXT,
  "attendanceRecordedAt" TIMESTAMP(3),
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "memo" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" "manual_test"."ReservationCancelReason",
  "cancelDetail" TEXT,
  "cancelledById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."Payment" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "payerType" "manual_test"."PayerType" NOT NULL DEFAULT 'GUARDIAN',
  "payerName" TEXT,
  "method" "manual_test"."PaymentMethod" NOT NULL,
  "status" "manual_test"."PaymentStatus" NOT NULL DEFAULT 'PAID',
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalAmount" INTEGER NOT NULL,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."PaymentItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "paidAmount" INTEGER NOT NULL,
  "refundedAmount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_item_amount_nonneg" CHECK ("amount" >= 0 AND "discountAmount" >= 0 AND "paidAmount" >= 0),
  CONSTRAINT "payment_item_paid_calc" CHECK ("paidAmount" = "amount" - "discountAmount"),
  CONSTRAINT "payment_item_refund_limit" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "paidAmount")
);

CREATE TABLE "manual_test"."Refund" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "paymentItemId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" "manual_test"."RefundReason" NOT NULL,
  "reasonDetail" TEXT,
  "status" "manual_test"."RefundStatus" NOT NULL DEFAULT 'COMPLETED',
  "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "manual_test"."ApplicationDevice" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."DeviceSubmission" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manual_test"."DeviceChild" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceChild_pkey" PRIMARY KEY ("id")
);

-- Unique/index inventory: source indexes adapted per PLAN, then FK coverage.

CREATE UNIQUE INDEX "User_runId_id_key" ON "manual_test"."User" ("runId", "id");
CREATE UNIQUE INDEX "Teacher_runId_id_key" ON "manual_test"."Teacher" ("runId", "id");
CREATE UNIQUE INDEX "Program_runId_id_key" ON "manual_test"."Program" ("runId", "id");
CREATE UNIQUE INDEX "ClassSchedule_runId_id_key" ON "manual_test"."ClassSchedule" ("runId", "id");
CREATE UNIQUE INDEX "ClassTeacher_runId_id_key" ON "manual_test"."ClassTeacher" ("runId", "id");
CREATE UNIQUE INDEX "Child_runId_id_key" ON "manual_test"."Child" ("runId", "id");
CREATE UNIQUE INDEX "ChildConsent_runId_id_key" ON "manual_test"."ChildConsent" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplicationGroup_runId_id_key" ON "manual_test"."ReservationApplicationGroup" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplicationGroupClass_runId_id_key" ON "manual_test"."ReservationApplicationGroupClass" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplicationLink_runId_id_key" ON "manual_test"."ReservationApplicationLink" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplicationSubmission_runId_id_key" ON "manual_test"."ReservationApplicationSubmission" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplication_runId_id_key" ON "manual_test"."ReservationApplication" ("runId", "id");
CREATE UNIQUE INDEX "ApplicationDeposit_runId_id_key" ON "manual_test"."ApplicationDeposit" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplicationPaymentMapping_runId_id_key" ON "manual_test"."ReservationApplicationPaymentMapping" ("runId", "id");
CREATE UNIQUE INDEX "ReturnObligation_runId_id_key" ON "manual_test"."ReturnObligation" ("runId", "id");
CREATE UNIQUE INDEX "ApplicationReturn_runId_id_key" ON "manual_test"."ApplicationReturn" ("runId", "id");
CREATE UNIQUE INDEX "FundAllocation_runId_id_key" ON "manual_test"."FundAllocation" ("runId", "id");
CREATE UNIQUE INDEX "ReservationApplicationSettings_runId_id_key" ON "manual_test"."ReservationApplicationSettings" ("runId", "id");
CREATE UNIQUE INDEX "Reservation_runId_id_key" ON "manual_test"."Reservation" ("runId", "id");
CREATE UNIQUE INDEX "Payment_runId_id_key" ON "manual_test"."Payment" ("runId", "id");
CREATE UNIQUE INDEX "PaymentItem_runId_id_key" ON "manual_test"."PaymentItem" ("runId", "id");
CREATE UNIQUE INDEX "Refund_runId_id_key" ON "manual_test"."Refund" ("runId", "id");
CREATE UNIQUE INDEX "ApplicationDevice_runId_id_key" ON "manual_test"."ApplicationDevice" ("runId", "id");
CREATE UNIQUE INDEX "DeviceSubmission_runId_id_key" ON "manual_test"."DeviceSubmission" ("runId", "id");
CREATE UNIQUE INDEX "DeviceChild_runId_id_key" ON "manual_test"."DeviceChild" ("runId", "id");
CREATE INDEX "Child_runId_name_idx" ON "manual_test"."Child" ("runId", "name");
CREATE INDEX "Child_runId_guardianPhone_idx" ON "manual_test"."Child" ("runId", "guardianPhone");
CREATE INDEX "Child_runId_isActive_idx" ON "manual_test"."Child" ("runId", "isActive");
CREATE INDEX "Child_runId_personalDataPurgedAt_idx" ON "manual_test"."Child" ("runId", "personalDataPurgedAt");
CREATE INDEX "ChildConsent_runId_childId_consentType_recordedAt_idx" ON "manual_test"."ChildConsent" ("runId", "childId", "consentType", "recordedAt");
CREATE INDEX "ChildConsent_runId_reservationApplicationId_idx" ON "manual_test"."ChildConsent" ("runId", "reservationApplicationId");
CREATE INDEX "Program_runId_status_idx" ON "manual_test"."Program" ("runId", "status");
CREATE INDEX "ClassSchedule_runId_startsAt_idx" ON "manual_test"."ClassSchedule" ("runId", "startsAt");
CREATE INDEX "ClassSchedule_runId_status_idx" ON "manual_test"."ClassSchedule" ("runId", "status");
CREATE INDEX "ClassSchedule_runId_programId_idx" ON "manual_test"."ClassSchedule" ("runId", "programId");
CREATE UNIQUE INDEX "ClassTeacher_runId_classScheduleId_teacherId_key" ON "manual_test"."ClassTeacher" ("runId", "classScheduleId", "teacherId");
CREATE INDEX "Reservation_runId_childId_idx" ON "manual_test"."Reservation" ("runId", "childId");
CREATE INDEX "Reservation_runId_status_idx" ON "manual_test"."Reservation" ("runId", "status");
CREATE INDEX "Reservation_runId_cancelledAt_idx" ON "manual_test"."Reservation" ("runId", "cancelledAt");
CREATE UNIQUE INDEX "Reservation_runId_classScheduleId_childId_key" ON "manual_test"."Reservation" ("runId", "classScheduleId", "childId");
CREATE UNIQUE INDEX "ReservationApplicationGroup_runId_upgradedLegacyClas_e072bef6c3" ON "manual_test"."ReservationApplicationGroup" ("runId", "upgradedLegacyClassScheduleId");
CREATE INDEX "ReservationApplicationGroup_runId_isActive_createdAt_idx" ON "manual_test"."ReservationApplicationGroup" ("runId", "isActive", "createdAt");
CREATE INDEX "ReservationApplicationGroup_runId_syntheticRunId_idx" ON "manual_test"."ReservationApplicationGroup" ("runId", "syntheticRunId");
CREATE INDEX "ReservationApplicationGroupClass_runId_classScheduleId_idx" ON "manual_test"."ReservationApplicationGroupClass" ("runId", "classScheduleId");
CREATE UNIQUE INDEX "ReservationApplicationGroupClass_runId_groupId_class_0de620e0ef" ON "manual_test"."ReservationApplicationGroupClass" ("runId", "groupId", "classScheduleId");
CREATE UNIQUE INDEX "ReservationApplicationLink_tokenHash_key" ON "manual_test"."ReservationApplicationLink" ("tokenHash");
CREATE UNIQUE INDEX "ReservationApplicationSubmission_completionTokenHash_key" ON "manual_test"."ReservationApplicationSubmission" ("completionTokenHash");
CREATE INDEX "ReservationApplicationSubmission_runId_groupId_submittedAt_idx" ON "manual_test"."ReservationApplicationSubmission" ("runId", "groupId", "submittedAt");
CREATE INDEX "ReservationApplicationSubmission_runId_personalDataPurgedAt_idx" ON "manual_test"."ReservationApplicationSubmission" ("runId", "personalDataPurgedAt");
CREATE INDEX "ReservationApplicationSubmission_runId_completionExpiresAt_idx" ON "manual_test"."ReservationApplicationSubmission" ("runId", "completionExpiresAt");
CREATE INDEX "ReservationApplication_runId_status_submittedAt_idx" ON "manual_test"."ReservationApplication" ("runId", "status", "submittedAt");
CREATE INDEX "ReservationApplication_runId_classScheduleId_status_idx" ON "manual_test"."ReservationApplication" ("runId", "classScheduleId", "status");
CREATE INDEX "ReservationApplication_runId_childId_idx" ON "manual_test"."ReservationApplication" ("runId", "childId");
CREATE INDEX "ReservationApplication_runId_reservationId_idx" ON "manual_test"."ReservationApplication" ("runId", "reservationId");
CREATE INDEX "ReservationApplication_runId_personalDataPurgedAt_idx" ON "manual_test"."ReservationApplication" ("runId", "personalDataPurgedAt");
CREATE INDEX "ReservationApplication_runId_submissionId_status_idx" ON "manual_test"."ReservationApplication" ("runId", "submissionId", "status");
CREATE INDEX "ReservationApplication_runId_requestedChildId_idx" ON "manual_test"."ReservationApplication" ("runId", "requestedChildId");
CREATE INDEX "ReservationApplication_runId_requestedChildPurgedAt_idx" ON "manual_test"."ReservationApplication" ("runId", "requestedChildPurgedAt");
CREATE UNIQUE INDEX "ApplicationDevice_tokenHash_key" ON "manual_test"."ApplicationDevice" ("tokenHash");
CREATE INDEX "ApplicationDevice_runId_expiresAt_idx" ON "manual_test"."ApplicationDevice" ("runId", "expiresAt");
CREATE INDEX "DeviceSubmission_runId_submissionId_idx" ON "manual_test"."DeviceSubmission" ("runId", "submissionId");
CREATE UNIQUE INDEX "DeviceSubmission_runId_deviceId_submissionId_key" ON "manual_test"."DeviceSubmission" ("runId", "deviceId", "submissionId");
CREATE INDEX "DeviceChild_runId_childId_idx" ON "manual_test"."DeviceChild" ("runId", "childId");
CREATE UNIQUE INDEX "DeviceChild_runId_deviceId_childId_key" ON "manual_test"."DeviceChild" ("runId", "deviceId", "childId");
CREATE UNIQUE INDEX "ApplicationDeposit_runId_idempotencyKey_key" ON "manual_test"."ApplicationDeposit" ("runId", "idempotencyKey");
CREATE INDEX "ApplicationDeposit_runId_submissionId_confirmedAt_id_idx" ON "manual_test"."ApplicationDeposit" ("runId", "submissionId", "confirmedAt", "id");
CREATE UNIQUE INDEX "ReservationApplicationPaymentMapping_runId_applicationId_key" ON "manual_test"."ReservationApplicationPaymentMapping" ("runId", "applicationId");
CREATE UNIQUE INDEX "ReservationApplicationPaymentMapping_runId_paymentItemId_key" ON "manual_test"."ReservationApplicationPaymentMapping" ("runId", "paymentItemId");
CREATE INDEX "ReturnObligation_runId_submissionId_resolvedAt_idx" ON "manual_test"."ReturnObligation" ("runId", "submissionId", "resolvedAt");
CREATE UNIQUE INDEX "ReturnObligation_runId_applicationId_kind_key" ON "manual_test"."ReturnObligation" ("runId", "applicationId", "kind");
CREATE UNIQUE INDEX "ApplicationReturn_runId_idempotencyKey_key" ON "manual_test"."ApplicationReturn" ("runId", "idempotencyKey");
CREATE INDEX "ApplicationReturn_runId_returnObligationId_returnedAt_idx" ON "manual_test"."ApplicationReturn" ("runId", "returnObligationId", "returnedAt");
CREATE INDEX "FundAllocation_runId_depositId_idx" ON "manual_test"."FundAllocation" ("runId", "depositId");
CREATE INDEX "FundAllocation_runId_paymentMappingId_idx" ON "manual_test"."FundAllocation" ("runId", "paymentMappingId");
CREATE INDEX "FundAllocation_runId_returnObligationId_idx" ON "manual_test"."FundAllocation" ("runId", "returnObligationId");
CREATE INDEX "Payment_runId_paidAt_idx" ON "manual_test"."Payment" ("runId", "paidAt");
CREATE INDEX "Payment_runId_status_idx" ON "manual_test"."Payment" ("runId", "status");
CREATE UNIQUE INDEX "PaymentItem_runId_reservationId_key" ON "manual_test"."PaymentItem" ("runId", "reservationId");
CREATE INDEX "PaymentItem_runId_paymentId_idx" ON "manual_test"."PaymentItem" ("runId", "paymentId");
CREATE INDEX "Refund_runId_paymentItemId_idx" ON "manual_test"."Refund" ("runId", "paymentItemId");
CREATE INDEX "Refund_runId_refundedAt_idx" ON "manual_test"."Refund" ("runId", "refundedAt");
CREATE UNIQUE INDEX "ReservationApplicationSettings_runId_key" ON "manual_test"."ReservationApplicationSettings" ("runId");
CREATE UNIQUE INDEX "ManualTestSession_runId_id_key" ON "manual_test"."ManualTestSession" ("runId", "id");
CREATE UNIQUE INDEX "ManualTestAccessGrant_runId_id_key" ON "manual_test"."ManualTestAccessGrant" ("runId", "id");
CREATE UNIQUE INDEX "ManualTestOperationReceipt_runId_id_key" ON "manual_test"."ManualTestOperationReceipt" ("runId", "id");
CREATE UNIQUE INDEX "ManualTestRun_startRequestKey_key" ON "manual_test"."ManualTestRun" ("startRequestKey");
CREATE INDEX "ManualTestRun_status_expiresAt_idx" ON "manual_test"."ManualTestRun" ("status", "expiresAt");
CREATE UNIQUE INDEX "ManualTestSession_tokenHash_key" ON "manual_test"."ManualTestSession" ("tokenHash");
CREATE INDEX "ManualTestSession_runId_expiresAt_idx" ON "manual_test"."ManualTestSession" ("runId", "expiresAt");
CREATE UNIQUE INDEX "ManualTestAccessGrant_tokenHash_key" ON "manual_test"."ManualTestAccessGrant" ("tokenHash");
CREATE INDEX "ManualTestAccessGrant_runId_linkId_expiresAt_idx" ON "manual_test"."ManualTestAccessGrant" ("runId", "linkId", "expiresAt");
CREATE UNIQUE INDEX "ManualTestOperationReceipt_runId_operation_requestKey_key" ON "manual_test"."ManualTestOperationReceipt" ("runId", "operation", "requestKey");
CREATE INDEX "Child_runId_personalDataPurgedById_idx" ON "manual_test"."Child" ("runId", "personalDataPurgedById");
CREATE INDEX "ChildConsent_runId_recordedById_idx" ON "manual_test"."ChildConsent" ("runId", "recordedById");
CREATE INDEX "ClassSchedule_runId_cancelledById_idx" ON "manual_test"."ClassSchedule" ("runId", "cancelledById");
CREATE INDEX "ClassTeacher_runId_teacherId_idx" ON "manual_test"."ClassTeacher" ("runId", "teacherId");
CREATE INDEX "Reservation_runId_cancelledById_idx" ON "manual_test"."Reservation" ("runId", "cancelledById");
CREATE INDEX "Reservation_runId_attendanceRecordedById_idx" ON "manual_test"."Reservation" ("runId", "attendanceRecordedById");
CREATE INDEX "ReservationApplicationGroup_runId_createdById_idx" ON "manual_test"."ReservationApplicationGroup" ("runId", "createdById");
CREATE INDEX "ReservationApplicationLink_runId_groupId_idx" ON "manual_test"."ReservationApplicationLink" ("runId", "groupId");
CREATE INDEX "ReservationApplicationLink_runId_issuedById_idx" ON "manual_test"."ReservationApplicationLink" ("runId", "issuedById");
CREATE INDEX "ReservationApplicationSubmission_runId_updatedById_idx" ON "manual_test"."ReservationApplicationSubmission" ("runId", "updatedById");
CREATE INDEX "ReservationApplication_runId_depositConfirmedById_idx" ON "manual_test"."ReservationApplication" ("runId", "depositConfirmedById");
CREATE INDEX "ReservationApplication_runId_resolvedById_idx" ON "manual_test"."ReservationApplication" ("runId", "resolvedById");
CREATE INDEX "ReservationApplication_runId_personalDataPurgedById_idx" ON "manual_test"."ReservationApplication" ("runId", "personalDataPurgedById");
CREATE INDEX "ApplicationDeposit_runId_confirmedById_idx" ON "manual_test"."ApplicationDeposit" ("runId", "confirmedById");
CREATE INDEX "ApplicationReturn_runId_processedById_idx" ON "manual_test"."ApplicationReturn" ("runId", "processedById");
CREATE INDEX "ReservationApplicationSettings_runId_updatedById_idx" ON "manual_test"."ReservationApplicationSettings" ("runId", "updatedById");
CREATE INDEX "Refund_runId_processedById_idx" ON "manual_test"."Refund" ("runId", "processedById");
CREATE INDEX "ManualTestSession_runId_actorUserId_idx" ON "manual_test"."ManualTestSession" ("runId", "actorUserId");
CREATE INDEX "ManualTestSession_runId_linkId_idx" ON "manual_test"."ManualTestSession" ("runId", "linkId");
CREATE INDEX "ManualTestSession_runId_submissionId_idx" ON "manual_test"."ManualTestSession" ("runId", "submissionId");

-- Every FK target is in manual_test; composite targets have matching uniques.

ALTER TABLE "manual_test"."Child" ADD CONSTRAINT "Child_runId_personalDataPurgedById_fkey"
  FOREIGN KEY ("runId", "personalDataPurgedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ChildConsent" ADD CONSTRAINT "ChildConsent_runId_childId_fkey"
  FOREIGN KEY ("runId", "childId") REFERENCES "manual_test"."Child" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ChildConsent" ADD CONSTRAINT "ChildConsent_runId_recordedById_fkey"
  FOREIGN KEY ("runId", "recordedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE SET NULL ("recordedById") ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ChildConsent" ADD CONSTRAINT "ChildConsent_runId_reservationApplicationId_fkey"
  FOREIGN KEY ("runId", "reservationApplicationId") REFERENCES "manual_test"."ReservationApplication" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_runId_programId_fkey"
  FOREIGN KEY ("runId", "programId") REFERENCES "manual_test"."Program" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_runId_cancelledById_fkey"
  FOREIGN KEY ("runId", "cancelledById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE SET NULL ("cancelledById") ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ClassTeacher" ADD CONSTRAINT "ClassTeacher_runId_classScheduleId_fkey"
  FOREIGN KEY ("runId", "classScheduleId") REFERENCES "manual_test"."ClassSchedule" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ClassTeacher" ADD CONSTRAINT "ClassTeacher_runId_teacherId_fkey"
  FOREIGN KEY ("runId", "teacherId") REFERENCES "manual_test"."Teacher" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Reservation" ADD CONSTRAINT "Reservation_runId_childId_fkey"
  FOREIGN KEY ("runId", "childId") REFERENCES "manual_test"."Child" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Reservation" ADD CONSTRAINT "Reservation_runId_classScheduleId_fkey"
  FOREIGN KEY ("runId", "classScheduleId") REFERENCES "manual_test"."ClassSchedule" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Reservation" ADD CONSTRAINT "Reservation_runId_cancelledById_fkey"
  FOREIGN KEY ("runId", "cancelledById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE SET NULL ("cancelledById") ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Reservation" ADD CONSTRAINT "Reservation_runId_attendanceRecordedById_fkey"
  FOREIGN KEY ("runId", "attendanceRecordedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE SET NULL ("attendanceRecordedById") ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationGroup" ADD CONSTRAINT "ReservationApplicationGroup_runId_createdById_fkey"
  FOREIGN KEY ("runId", "createdById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationGroup" ADD CONSTRAINT "ReservationApplicationGroup_runId_upgradedLegacyClas_a81ca0c21d"
  FOREIGN KEY ("runId", "upgradedLegacyClassScheduleId") REFERENCES "manual_test"."ClassSchedule" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationGroupClass" ADD CONSTRAINT "ReservationApplicationGroupClass_runId_groupId_fkey"
  FOREIGN KEY ("runId", "groupId") REFERENCES "manual_test"."ReservationApplicationGroup" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationGroupClass" ADD CONSTRAINT "ReservationApplicationGroupClass_runId_classScheduleId_fkey"
  FOREIGN KEY ("runId", "classScheduleId") REFERENCES "manual_test"."ClassSchedule" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_runId_groupId_fkey"
  FOREIGN KEY ("runId", "groupId") REFERENCES "manual_test"."ReservationApplicationGroup" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_runId_issuedById_fkey"
  FOREIGN KEY ("runId", "issuedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationSubmission" ADD CONSTRAINT "ReservationApplicationSubmission_runId_groupId_fkey"
  FOREIGN KEY ("runId", "groupId") REFERENCES "manual_test"."ReservationApplicationGroup" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationSubmission" ADD CONSTRAINT "ReservationApplicationSubmission_runId_updatedById_fkey"
  FOREIGN KEY ("runId", "updatedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_classScheduleId_fkey"
  FOREIGN KEY ("runId", "classScheduleId") REFERENCES "manual_test"."ClassSchedule" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_submissionId_fkey"
  FOREIGN KEY ("runId", "submissionId") REFERENCES "manual_test"."ReservationApplicationSubmission" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_depositConfirmedById_fkey"
  FOREIGN KEY ("runId", "depositConfirmedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_resolvedById_fkey"
  FOREIGN KEY ("runId", "resolvedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_personalDataPurgedById_fkey"
  FOREIGN KEY ("runId", "personalDataPurgedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_childId_fkey"
  FOREIGN KEY ("runId", "childId") REFERENCES "manual_test"."Child" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_requestedChildId_fkey"
  FOREIGN KEY ("runId", "requestedChildId") REFERENCES "manual_test"."Child" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_reservationId_fkey"
  FOREIGN KEY ("runId", "reservationId") REFERENCES "manual_test"."Reservation" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."DeviceSubmission" ADD CONSTRAINT "DeviceSubmission_runId_deviceId_fkey"
  FOREIGN KEY ("runId", "deviceId") REFERENCES "manual_test"."ApplicationDevice" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."DeviceSubmission" ADD CONSTRAINT "DeviceSubmission_runId_submissionId_fkey"
  FOREIGN KEY ("runId", "submissionId") REFERENCES "manual_test"."ReservationApplicationSubmission" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."DeviceChild" ADD CONSTRAINT "DeviceChild_runId_deviceId_fkey"
  FOREIGN KEY ("runId", "deviceId") REFERENCES "manual_test"."ApplicationDevice" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."DeviceChild" ADD CONSTRAINT "DeviceChild_runId_childId_fkey"
  FOREIGN KEY ("runId", "childId") REFERENCES "manual_test"."Child" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationDeposit" ADD CONSTRAINT "ApplicationDeposit_runId_submissionId_fkey"
  FOREIGN KEY ("runId", "submissionId") REFERENCES "manual_test"."ReservationApplicationSubmission" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationDeposit" ADD CONSTRAINT "ApplicationDeposit_runId_confirmedById_fkey"
  FOREIGN KEY ("runId", "confirmedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationPaymentMapping" ADD CONSTRAINT "ReservationApplicationPaymentMapping_runId_applicationId_fkey"
  FOREIGN KEY ("runId", "applicationId") REFERENCES "manual_test"."ReservationApplication" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationPaymentMapping" ADD CONSTRAINT "ReservationApplicationPaymentMapping_runId_paymentItemId_fkey"
  FOREIGN KEY ("runId", "paymentItemId") REFERENCES "manual_test"."PaymentItem" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReturnObligation" ADD CONSTRAINT "ReturnObligation_runId_submissionId_fkey"
  FOREIGN KEY ("runId", "submissionId") REFERENCES "manual_test"."ReservationApplicationSubmission" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReturnObligation" ADD CONSTRAINT "ReturnObligation_runId_applicationId_fkey"
  FOREIGN KEY ("runId", "applicationId") REFERENCES "manual_test"."ReservationApplication" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationReturn" ADD CONSTRAINT "ApplicationReturn_runId_returnObligationId_fkey"
  FOREIGN KEY ("runId", "returnObligationId") REFERENCES "manual_test"."ReturnObligation" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationReturn" ADD CONSTRAINT "ApplicationReturn_runId_processedById_fkey"
  FOREIGN KEY ("runId", "processedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."FundAllocation" ADD CONSTRAINT "FundAllocation_runId_depositId_fkey"
  FOREIGN KEY ("runId", "depositId") REFERENCES "manual_test"."ApplicationDeposit" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."FundAllocation" ADD CONSTRAINT "FundAllocation_runId_paymentMappingId_fkey"
  FOREIGN KEY ("runId", "paymentMappingId") REFERENCES "manual_test"."ReservationApplicationPaymentMapping" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."FundAllocation" ADD CONSTRAINT "FundAllocation_runId_returnObligationId_fkey"
  FOREIGN KEY ("runId", "returnObligationId") REFERENCES "manual_test"."ReturnObligation" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationSettings" ADD CONSTRAINT "ReservationApplicationSettings_runId_updatedById_fkey"
  FOREIGN KEY ("runId", "updatedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."PaymentItem" ADD CONSTRAINT "PaymentItem_runId_paymentId_fkey"
  FOREIGN KEY ("runId", "paymentId") REFERENCES "manual_test"."Payment" ("runId", "id")
  MATCH SIMPLE ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_test"."PaymentItem" ADD CONSTRAINT "PaymentItem_runId_reservationId_fkey"
  FOREIGN KEY ("runId", "reservationId") REFERENCES "manual_test"."Reservation" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Refund" ADD CONSTRAINT "Refund_runId_paymentItemId_fkey"
  FOREIGN KEY ("runId", "paymentItemId") REFERENCES "manual_test"."PaymentItem" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Refund" ADD CONSTRAINT "Refund_runId_processedById_fkey"
  FOREIGN KEY ("runId", "processedById") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE SET NULL ("processedById") ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestSession" ADD CONSTRAINT "ManualTestSession_runId_actorUserId_fkey"
  FOREIGN KEY ("runId", "actorUserId") REFERENCES "manual_test"."User" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestSession" ADD CONSTRAINT "ManualTestSession_runId_linkId_fkey"
  FOREIGN KEY ("runId", "linkId") REFERENCES "manual_test"."ReservationApplicationLink" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestSession" ADD CONSTRAINT "ManualTestSession_runId_submissionId_fkey"
  FOREIGN KEY ("runId", "submissionId") REFERENCES "manual_test"."ReservationApplicationSubmission" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestAccessGrant" ADD CONSTRAINT "ManualTestAccessGrant_runId_linkId_fkey"
  FOREIGN KEY ("runId", "linkId") REFERENCES "manual_test"."ReservationApplicationLink" ("runId", "id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestSession" ADD CONSTRAINT "ManualTestSession_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestAccessGrant" ADD CONSTRAINT "ManualTestAccessGrant_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ManualTestOperationReceipt" ADD CONSTRAINT "ManualTestOperationReceipt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."User" ADD CONSTRAINT "User_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Teacher" ADD CONSTRAINT "Teacher_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Program" ADD CONSTRAINT "Program_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ClassSchedule" ADD CONSTRAINT "ClassSchedule_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ClassTeacher" ADD CONSTRAINT "ClassTeacher_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Child" ADD CONSTRAINT "Child_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ChildConsent" ADD CONSTRAINT "ChildConsent_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationGroup" ADD CONSTRAINT "ReservationApplicationGroup_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationGroupClass" ADD CONSTRAINT "ReservationApplicationGroupClass_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationLink" ADD CONSTRAINT "ReservationApplicationLink_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationSubmission" ADD CONSTRAINT "ReservationApplicationSubmission_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplication" ADD CONSTRAINT "ReservationApplication_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationDeposit" ADD CONSTRAINT "ApplicationDeposit_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationPaymentMapping" ADD CONSTRAINT "ReservationApplicationPaymentMapping_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReturnObligation" ADD CONSTRAINT "ReturnObligation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationReturn" ADD CONSTRAINT "ApplicationReturn_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."FundAllocation" ADD CONSTRAINT "FundAllocation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ReservationApplicationSettings" ADD CONSTRAINT "ReservationApplicationSettings_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Reservation" ADD CONSTRAINT "Reservation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Payment" ADD CONSTRAINT "Payment_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."PaymentItem" ADD CONSTRAINT "PaymentItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."Refund" ADD CONSTRAINT "Refund_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."ApplicationDevice" ADD CONSTRAINT "ApplicationDevice_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."DeviceSubmission" ADD CONSTRAINT "DeviceSubmission_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_test"."DeviceChild" ADD CONSTRAINT "DeviceChild_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "manual_test"."ManualTestRun" ("id")
  MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE;

-- Private-schema defense in depth; app authorization must additionally bind runId.

ALTER TABLE "manual_test"."ManualTestRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ManualTestRun"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ManualTestSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ManualTestSession"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ManualTestAccessGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ManualTestAccessGrant"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ManualTestOperationReceipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ManualTestOperationReceipt"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."User"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."Teacher" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."Teacher"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."Program" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."Program"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ClassSchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ClassSchedule"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ClassTeacher" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ClassTeacher"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."Child" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."Child"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ChildConsent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ChildConsent"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplicationGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplicationGroup"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplicationGroupClass" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplicationGroupClass"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplicationLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplicationLink"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplicationSubmission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplicationSubmission"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplication" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplication"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ApplicationDeposit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ApplicationDeposit"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplicationPaymentMapping" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplicationPaymentMapping"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReturnObligation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReturnObligation"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ApplicationReturn" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ApplicationReturn"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."FundAllocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."FundAllocation"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ReservationApplicationSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ReservationApplicationSettings"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."Reservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."Reservation"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."Payment"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."PaymentItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."PaymentItem"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."Refund" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."Refund"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."ApplicationDevice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."ApplicationDevice"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."DeviceSubmission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."DeviceSubmission"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);
ALTER TABLE "manual_test"."DeviceChild" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_test_runtime_access" ON "manual_test"."DeviceChild"
  FOR ALL TO "manual_test_runtime" USING (true) WITH CHECK (true);

-- Runtime grants on the new types/tables: no CREATE, TRUNCATE, REFERENCES,
-- TRIGGER, grant option, role membership, or migration-history permissions.
GRANT USAGE ON TYPE "manual_test"."Gender" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ConsentType" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ConsentAction" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."GuardianRelationship" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ReservationApplicationStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ReturnObligationKind" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ProgramStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ClassStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ClassCancelReason" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ReservationStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ReservationCancelReason" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."AttendanceStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."PaymentStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."PaymentMethod" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."PayerType" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."RefundReason" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."RefundStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ManualTestRunStatus" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ManualTestSessionScope" TO "manual_test_runtime";
GRANT USAGE ON TYPE "manual_test"."ManualTestGrantPurpose" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ManualTestRun" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ManualTestSession" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ManualTestAccessGrant" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ManualTestOperationReceipt" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."User" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."Teacher" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."Program" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ClassSchedule" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ClassTeacher" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."Child" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ChildConsent" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplicationGroup" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplicationGroupClass" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplicationLink" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplicationSubmission" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplication" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ApplicationDeposit" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplicationPaymentMapping" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReturnObligation" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ApplicationReturn" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."FundAllocation" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ReservationApplicationSettings" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."Reservation" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."Payment" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."PaymentItem" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."Refund" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."ApplicationDevice" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."DeviceSubmission" TO "manual_test_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manual_test"."DeviceChild" TO "manual_test_runtime";
-- No sequences exist (application-supplied TEXT IDs), so sequence grants are unnecessary.
-- No ALTER DEFAULT PRIVILEGES: future objects require separate explicit grants/review.
-- No _prisma_migrations table: this standalone review artifact is outside the default
-- migration chain and has NOT been applied or registered as a Prisma migration.

-- NOLOGIN alone cannot lock a role that still owns objects or can be assumed.
-- This fresh role was created in this transaction, so all its owned objects belong
-- to this bootstrap. Transfer ownership before removing its temporary DDL access.
RESET ROLE;
REASSIGN OWNED BY "manual_test_migrator" TO CURRENT_USER;
REVOKE ALL PRIVILEGES ON SCHEMA "manual_test" FROM "manual_test_migrator";
ALTER ROLE "manual_test_migrator" NOLOGIN PASSWORD NULL;
REVOKE "manual_test_migrator" FROM CURRENT_USER;

COMMIT;
