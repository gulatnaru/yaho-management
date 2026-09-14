-- Phase 16: account access management.
-- Keep the preflight before every schema mutation so an existing unmapped
-- TEACHER account aborts the entire migration without partial DDL.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "role" = 'TEACHER'::"Role") THEN
    RAISE EXCEPTION
      'Phase 16 migration blocked: existing TEACHER users require an explicit Teacher mapping';
  END IF;
END
$$;

-- Preserve the Prisma/schema enum order: ADMIN, MANAGER, TEACHER.
-- PostgreSQL allows ADD VALUE in this transaction, but the new value must not
-- be used until after COMMIT. No row/default below uses MANAGER.
ALTER TYPE "Role" ADD VALUE 'MANAGER' BEFORE 'TEACHER';

CREATE TYPE "UserAccountChangeType" AS ENUM (
  'CREATED',
  'EMAIL_CHANGED',
  'ROLE_CHANGED',
  'ACTIVE_CHANGED',
  'PASSWORD_RESET'
);

ALTER TABLE "User"
  ADD COLUMN "teacherId" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "UserAccountChange" (
  "id" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "actorAdminId" TEXT NOT NULL,
  "type" "UserAccountChangeType" NOT NULL,
  "previousEmail" TEXT,
  "nextEmail" TEXT,
  "previousRole" "Role",
  "nextRole" "Role",
  "previousIsActive" BOOLEAN,
  "nextIsActive" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserAccountChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_teacherId_key" ON "User"("teacherId");
CREATE INDEX "UserAccountChange_targetUserId_createdAt_idx"
  ON "UserAccountChange"("targetUserId", "createdAt");
CREATE INDEX "UserAccountChange_actorAdminId_createdAt_idx"
  ON "UserAccountChange"("actorAdminId", "createdAt");

ALTER TABLE "User"
  ADD CONSTRAINT "User_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "user_teacher_role_consistency"
  CHECK (("role" = 'TEACHER'::"Role") = ("teacherId" IS NOT NULL)),
  ADD CONSTRAINT "user_auth_version_positive"
  CHECK ("authVersion" >= 1);

ALTER TABLE "UserAccountChange"
  ADD CONSTRAINT "UserAccountChange_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "UserAccountChange_actorAdminId_fkey"
  FOREIGN KEY ("actorAdminId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
