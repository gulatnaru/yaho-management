-- G1-A formal migration (UNCOMMITTED — separate commit approval required; DO NOT APPLY to Preview/Production without the G1-A gate + explicit approval).
-- RBAC P1: Role enum expansion (ADMIN/MANAGER/TEACHER -> SUPER_ADMIN/ADMIN/MANAGER/TEACHER/STAFF) + User.role default removal.
-- Source: draft prisma/migrations-DRAFT/20261030000000_admin_rbac_p1.sql (DDL identical; header/timeouts/transaction framing added here).
-- Order: FIRST of the RBAC set. P3 references the new Role enum; P4 references P3; P7 is order-independent but applied last as a bundle.
-- Baseline: applies after main formal 13 (through 20261006090000) and, on Preview, after 20261026090000_notification_outbox.
-- Preconditions (verified at G1-A design time; re-check before any real apply): target DB has User.role with a default to drop,
-- CHECK "user_teacher_role_consistency" (created by 20260913170000_phase16_account_access_management), and Role values only in
-- ADMIN/MANAGER/TEACHER. SUPER_ADMIN/STAFF rows must NOT pre-exist (the USING cast would fail on any other value).
-- Existing rows: the default removal affects new rows only; existing role values are unchanged by the cast.
-- CHECK note: "user_teacher_role_consistency" references the old enum type, so it is dropped before the type swap and re-added
-- against the new type. (role='TEACHER') = (teacherId IS NOT NULL) still holds for all five values; SUPER_ADMIN/STAFF must have
-- teacherId NULL — enforced in code (P1/P2), not by this CHECK.
-- Transaction note: PostgreSQL ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so this migration uses the
-- create-new-type + column-type-swap + rename sequence, which IS transaction-safe. BEGIN/COMMIT are explicit here following
-- the 20261026090000_notification_outbox precedent (lock_timeout 5s, statement_timeout 60s).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEACHER', 'STAFF');
-- A remaining default blocks the automatic cast, so drop it before the type swap.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
-- The teacher-consistency CHECK references the old enum type; drop it before the swap.
ALTER TABLE "User" DROP CONSTRAINT "user_teacher_role_consistency";
-- "Role" is used by 3 columns (User.role, UserAccountChange.previousRole/nextRole). All three must move or the old type cannot be dropped.
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "UserAccountChange" ALTER COLUMN "previousRole" TYPE "Role_new" USING ("previousRole"::text::"Role_new");
ALTER TABLE "UserAccountChange" ALTER COLUMN "nextRole" TYPE "Role_new" USING ("nextRole"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ADD CONSTRAINT "user_teacher_role_consistency" CHECK ((role = 'TEACHER') = ("teacherId" IS NOT NULL));

COMMIT;
