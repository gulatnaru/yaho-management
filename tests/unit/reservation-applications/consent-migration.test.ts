import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relative: string) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const migration = read(
  "../../../prisma/migrations/20260929150958_phase18_application_consent_retention/migration.sql",
);
const firstMigration = read(
  "../../../prisma/migrations/20260929073840_phase18_reservation_applications/migration.sql",
);
const schema = read("../../../prisma/schema.prisma");

describe("Phase 18 consent/retention migration", () => {
  it("runs the empty-table preflight before any schema change inside one transaction", () => {
    const begin = migration.indexOf("BEGIN;");
    const preflight = migration.indexOf('IF EXISTS (SELECT 1 FROM "ReservationApplication")');
    const firstChange = migration.indexOf("ALTER TYPE");
    const commit = migration.lastIndexOf("COMMIT;");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(begin);
    expect(firstChange).toBeGreaterThan(preflight);
    expect(commit).toBeGreaterThan(firstChange);
  });

  it("adds DECLINED without using it before commit", () => {
    expect(migration).toContain(`ALTER TYPE "ConsentAction" ADD VALUE 'DECLINED';`);
    const afterAdd = migration.slice(migration.indexOf("ADD VALUE 'DECLINED'") + "ADD VALUE 'DECLINED'".length);
    expect(afterAdd).not.toMatch(/'DECLINED'/);
  });

  it("adds guardian relationship, required acknowledgements and purge tracking", () => {
    expect(migration).toContain(`CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'OTHER_LEGAL_GUARDIAN');`);
    expect(migration).toContain('ADD COLUMN "guardianRelationship" "GuardianRelationship"');
    expect(migration).toContain('ADD COLUMN "programTermsAcknowledged" BOOLEAN NOT NULL');
    expect(migration).toContain('ADD COLUMN "legalGuardianConfirmed" BOOLEAN NOT NULL');
    expect(migration).toContain('ADD COLUMN "personalDataPurgedAt" TIMESTAMP(3)');
    expect(migration).toContain('"programTermsAcknowledged" AND "privacyConsentAgreed" AND "legalGuardianConfirmed"');
  });

  it("makes photo sharing optional by replacing the old required-consent check", () => {
    expect(migration).toContain('DROP CONSTRAINT "reservation_application_required_consents"');
    const requiredTerms = migration.slice(migration.indexOf('"reservation_application_required_terms"'));
    expect(requiredTerms.slice(0, requiredTerms.indexOf(")"))).not.toContain("photoShareConsentAgreed");
  });

  it("keeps personal data required until it is purged, and forbids purging pending applications", () => {
    expect(migration).toContain('ADD CONSTRAINT "reservation_application_personal_data_presence"');
    expect(migration).toContain(`"status" <> 'SUBMITTED'::"ReservationApplicationStatus"`);
    expect(migration).toContain('("personalDataPurgedAt" IS NULL) = ("personalDataPurgedById" IS NULL)');
    expect(migration).toContain("ON DELETE RESTRICT ON UPDATE CASCADE");
  });

  it("never drops tables or rewrites data", () => {
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i);
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\s/im);
    expect(migration).not.toMatch(/yaho-release-preflight/i);
  });

  it("leaves the first Phase 18 migration untouched", () => {
    expect(firstMigration).toContain('"privacyConsentAgreed" AND "photoShareConsentAgreed"');
    expect(firstMigration).not.toContain("guardianRelationship");
  });

  it("matches the Prisma schema", () => {
    expect(schema).toContain("enum GuardianRelationship {");
    expect(schema).toContain("DECLINED");
    expect(schema).toMatch(/guardianRelationship\s+GuardianRelationship\?/);
    expect(schema).toMatch(/programTermsAcknowledged\s+Boolean/);
    expect(schema).toMatch(/legalGuardianConfirmed\s+Boolean/);
    expect(schema).toMatch(/personalDataPurgedAt\s+DateTime\?/);
    expect(schema).toMatch(/childName\s+String\?/);
  });
});

describe("Phase 18 refund terms migration", () => {
  const refundMigration = read(
    "../../../prisma/migrations/20260929155124_phase18_refund_terms_acknowledgement/migration.sql",
  );

  it("runs the empty-table preflight before adding the required acknowledgement", () => {
    const begin = refundMigration.indexOf("BEGIN;");
    const preflight = refundMigration.indexOf('IF EXISTS (SELECT 1 FROM "ReservationApplication")');
    const addColumn = refundMigration.indexOf('ADD COLUMN "refundTermsAcknowledged" BOOLEAN NOT NULL');
    const commit = refundMigration.lastIndexOf("COMMIT;");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(begin);
    expect(addColumn).toBeGreaterThan(preflight);
    expect(commit).toBeGreaterThan(addColumn);
  });

  it("recreates the required-terms check with all four required acknowledgements", () => {
    const drop = refundMigration.indexOf('DROP CONSTRAINT "reservation_application_required_terms"');
    const add = refundMigration.indexOf('ADD CONSTRAINT "reservation_application_required_terms"');
    expect(drop).toBeGreaterThan(0);
    expect(add).toBeGreaterThan(drop);
    const check = refundMigration.slice(add);
    for (const column of [
      "programTermsAcknowledged",
      "privacyConsentAgreed",
      "legalGuardianConfirmed",
      "refundTermsAcknowledged",
    ]) {
      expect(check).toContain(`"${column}"`);
    }
    expect(check).not.toContain("photoShareConsentAgreed");
  });

  it("does not touch earlier migrations or rewrite data", () => {
    expect(refundMigration).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\s/im);
    expect(refundMigration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i);
    expect(migration).not.toContain("refundTermsAcknowledged");
    expect(schema).toMatch(/refundTermsAcknowledged\s+Boolean/);
  });
});
