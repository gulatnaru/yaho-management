import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260929073840_phase18_reservation_applications/migration.sql",
    import.meta.url,
  ),
);
const schemaPath = fileURLToPath(new URL("../../../prisma/schema.prisma", import.meta.url));
const migration = readFileSync(migrationPath, "utf8");
const schema = readFileSync(schemaPath, "utf8");

describe("Phase 18 reservation application migration", () => {
  it("wraps every schema change in one transaction", () => {
    const begin = migration.indexOf("BEGIN;");
    const firstChange = migration.indexOf("CREATE TYPE");
    const commit = migration.lastIndexOf("COMMIT;");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(firstChange).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(firstChange);
  });

  it("is expand-only for existing tables", () => {
    const alteredTables = [...migration.matchAll(/ALTER TABLE "([A-Za-z]+)"/g)].map((match) => match[1]);
    const existingTablesTouched = new Set(
      alteredTables.filter((table) => !table.startsWith("ReservationApplication")),
    );

    expect([...existingTablesTouched]).toEqual(["ChildConsent"]);
    expect(migration).toContain('ALTER TABLE "ChildConsent" ADD COLUMN "reservationApplicationId" TEXT;');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)/i);
    expect(migration).not.toMatch(/ALTER COLUMN/i);
    expect(migration).not.toMatch(/\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b/i);
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\s/im);
  });

  it("creates the status enum and both tables", () => {
    expect(migration).toContain(
      `CREATE TYPE "ReservationApplicationStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED', 'CANCELLED');`,
    );
    expect(migration).toContain('CREATE TABLE "ReservationApplicationLink"');
    expect(migration).toContain('CREATE TABLE "ReservationApplication"');
    expect(migration).toContain('"childBirthDate" DATE NOT NULL');
    expect(migration).toContain(`"status" "ReservationApplicationStatus" NOT NULL DEFAULT 'SUBMITTED'`);
  });

  it("keeps one link per class and unique tokens", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ReservationApplicationLink_classScheduleId_key" ON "ReservationApplicationLink"("classScheduleId");',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ReservationApplicationLink_token_key" ON "ReservationApplicationLink"("token");',
    );
    expect(migration).toContain('CHECK (char_length("token") >= 32)');
  });

  it("does not make reservationId unique because ADR-024 re-reservation reuses rows", () => {
    expect(migration).toContain(
      'CREATE INDEX "ReservationApplication_reservationId_idx" ON "ReservationApplication"("reservationId");',
    );
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX "ReservationApplication_reservationId/);
  });

  it("uses restrictive foreign keys so application history is never cascaded away", () => {
    const foreignKeys = [...migration.matchAll(/ADD CONSTRAINT "([A-Za-z_]+_fkey)"[^;]+;/g)];
    expect(foreignKeys.map((match) => match[1]).sort()).toEqual(
      [
        "ChildConsent_reservationApplicationId_fkey",
        "ReservationApplicationLink_classScheduleId_fkey",
        "ReservationApplicationLink_issuedById_fkey",
        "ReservationApplication_childId_fkey",
        "ReservationApplication_classScheduleId_fkey",
        "ReservationApplication_depositConfirmedById_fkey",
        "ReservationApplication_reservationId_fkey",
        "ReservationApplication_resolvedById_fkey",
      ].sort(),
    );
    for (const match of foreignKeys) {
      expect(match[0]).toContain("ON DELETE RESTRICT ON UPDATE CASCADE");
    }
  });

  it("guards required consents, deposit pairing and status consistency in the database", () => {
    expect(migration).toContain('"privacyConsentAgreed" AND "photoShareConsentAgreed"');
    expect(migration).toContain('("depositConfirmedAt" IS NULL) = ("depositConfirmedById" IS NULL)');
    expect(migration).toContain('ADD CONSTRAINT "reservation_application_status_consistency"');
    expect(migration).toContain('ADD CONSTRAINT "reservation_application_text_not_blank"');
  });

  it("does not request any trusted Production preflight", () => {
    expect(migration).not.toMatch(/yaho-release-preflight/i);
  });

  it("matches the Prisma schema models", () => {
    expect(schema).toContain("model ReservationApplicationLink {");
    expect(schema).toContain("model ReservationApplication {");
    expect(schema).toContain("enum ReservationApplicationStatus {");
    expect(schema).toContain("reservationApplicationId String?");
    expect(schema).toContain("classScheduleId String   @unique");
  });
});
