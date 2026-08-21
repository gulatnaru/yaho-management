-- Prevent Child.name from being empty or whitespace-only.
-- Server-side Zod validation (lib/validation/child.ts) is the primary defense;
-- this CHECK constraint is a secondary guard at the DB layer.
ALTER TABLE "Child"
  ADD CONSTRAINT "child_name_not_blank" CHECK (btrim("name") <> '');
