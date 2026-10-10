import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schema = readFileSync(fileURLToPath(new URL("../../../prisma/schema.prisma", import.meta.url)), "utf8");
const migration = readFileSync(fileURLToPath(new URL("../../../prisma/migrations/20261006090000_phase20_reservation_application_enhancements/migration.sql", import.meta.url)), "utf8");

describe("Phase 20 additive reservation-application migration", () => {
  it("puts an optional final price only on ClassSchedule and never uses Program.defaultPrice as fallback", () => {
    const classBlock = schema.slice(schema.indexOf("model ClassSchedule"), schema.indexOf("model ClassTeacher"));
    const programBlock = schema.slice(schema.indexOf("model Program"), schema.indexOf("model ClassSchedule"));
    expect(classBlock).toContain("applicationPrice Int?");
    expect(programBlock).not.toContain("applicationPrice");
    expect(migration).toContain('CHECK ("applicationPrice" IS NULL OR ("applicationPrice" > 0 AND "applicationPrice" <= 2147483647))');
  });

  it("keeps legacy link fields nullable for old rows and hashes all new group capabilities", () => {
    expect(schema).toContain("tokenHash       String?  @unique");
    expect(migration).toContain("reservation_application_link_legacy_or_group");
    expect(migration).toContain('"completionTokenHash" TEXT');
    expect(migration).toContain('"depositId" TEXT NOT NULL');
  });

  it("has explicit non-null quoted amount logic for new parent submissions", () => {
    expect(migration).toContain('"quotedAmount" IS NOT NULL AND "quotedAmount" > 0');
    expect(migration).toContain("CREATE TABLE \"ApplicationDeposit\"");
    expect(migration).toContain("CREATE TABLE \"ReturnObligation\"");
    expect(migration).toContain("CREATE TABLE \"PreviewE2eRunLease\"");
  });

  it("preserves legacy confirmation provenance while rejecting Phase 20 guardian and deposit duplication", () => {
    const presence = migration.slice(
      migration.indexOf('ADD CONSTRAINT "reservation_application_personal_data_presence"'),
      migration.indexOf('ADD CONSTRAINT "reservation_application_status_consistency"'),
    );
    const status = migration.slice(migration.indexOf('ADD CONSTRAINT "reservation_application_status_consistency"'));
    // A legacy row remains submission-less and quote-less. A new row has a
    // positive quote even after PII purge and never repeats guardian columns.
    expect(presence).toContain('"submissionId" IS NULL AND "quotedAmount" IS NULL');
    expect(presence).toContain('"submissionId" IS NOT NULL AND "quotedAmount" IS NOT NULL AND "quotedAmount" > 0');
    expect(presence).toContain('"guardianName" IS NULL AND "guardianPhone" IS NULL AND "guardianRelationship" IS NULL');
    // Historical confirmed applications retain their Phase 18 deposit proof;
    // Phase 20 applications use the separate ledger and must leave both old
    // fields null in every status.
    expect(status).toContain('"submissionId" IS NULL OR ("depositConfirmedAt" IS NULL AND "depositConfirmedById" IS NULL)');
    expect(status).toContain('"submissionId" IS NOT NULL OR "depositConfirmedAt" IS NOT NULL');
  });

  it("keeps a non-PII repeat-child purge tombstone and group-scoped Preview fixture settings", () => {
    expect(schema).toContain("requestedChildPurgedAt      DateTime?");
    expect(schema).toMatch(/syntheticSettings\s+Json\?/);
    expect(migration).toContain('"requestedChildPurgedAt" TIMESTAMP(3)');
    expect(migration).toContain('"syntheticSettings" JSONB');
    expect(schema).toContain("ownedChildIds Json?");
    expect(migration).toContain('"ownedChildIds" JSONB');
  });

  it("records explicit legacy-upgrade provenance without treating ordinary group membership as an upgrade", () => {
    expect(schema).toMatch(/upgradedLegacyClassScheduleId\s+String\?\s+@unique/);
    expect(migration).toContain('"upgradedLegacyClassScheduleId" TEXT');
    expect(migration).toContain('"ReservationApplicationGroup_upgradedLegacyClassScheduleId_key"');
  });

  it("wraps compatible DDL in one transaction and creates the enum before its table", () => {
    const begin = migration.indexOf("BEGIN;");
    const enumCreation = migration.indexOf('CREATE TYPE "ReturnObligationKind"');
    const obligation = migration.indexOf('CREATE TABLE "ReturnObligation"');
    const commit = migration.lastIndexOf("COMMIT;");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(enumCreation).toBeGreaterThan(begin);
    expect(obligation).toBeGreaterThan(enumCreation);
    expect(commit).toBeGreaterThan(obligation);
  });

  it("uses Prisma's generated unique-index name for the new group token hash", () => {
    expect(migration).toContain('CONSTRAINT "ReservationApplicationLink_tokenHash_key" UNIQUE ("tokenHash")');
    expect(schema).toContain("tokenHash       String?  @unique");
  });
});
