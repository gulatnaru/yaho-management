-- Prevent Teacher.name from being empty or whitespace-only.
-- Server-side Zod validation (lib/validation/teacher.ts) is the primary defense;
-- this CHECK constraint is a secondary guard at the DB layer.
ALTER TABLE "Teacher"
  ADD CONSTRAINT "teacher_name_not_blank" CHECK (btrim("name") <> '');
