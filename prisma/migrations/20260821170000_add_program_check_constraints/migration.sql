-- Server-side Zod validation (lib/validation/program.ts) is the primary defense;
-- these CHECK constraints are a secondary guard at the DB layer.
ALTER TABLE "Program"
  ADD CONSTRAINT "program_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "program_target_age_range" CHECK (
    ("targetAgeMin" IS NULL OR "targetAgeMin" >= 0)
    AND ("targetAgeMax" IS NULL OR "targetAgeMax" >= 0)
    AND ("targetAgeMin" IS NULL OR "targetAgeMax" IS NULL OR "targetAgeMin" <= "targetAgeMax")
  ),
  ADD CONSTRAINT "program_default_duration_positive" CHECK ("defaultDuration" IS NULL OR "defaultDuration" > 0),
  ADD CONSTRAINT "program_default_price_nonneg" CHECK ("defaultPrice" >= 0);
