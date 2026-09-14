import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260913170000_phase16_account_access_management/migration.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

describe("Phase 16 account access migration", () => {
  it("runs the existing-TEACHER preflight before transactional schema changes", () => {
    const begin = migration.indexOf("BEGIN;");
    const preflight = migration.indexOf('IF EXISTS (SELECT 1 FROM "User"');
    const firstSchemaChange = migration.indexOf('ALTER TYPE "Role"');
    const commit = migration.lastIndexOf("COMMIT;");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(begin);
    expect(firstSchemaChange).toBeGreaterThan(preflight);
    expect(commit).toBeGreaterThan(firstSchemaChange);
    expect(migration).toContain("existing TEACHER users require an explicit Teacher mapping");
  });

  it("adds MANAGER in the Prisma enum order without using it before commit", () => {
    expect(migration).toContain(`ALTER TYPE "Role" ADD VALUE 'MANAGER' BEFORE 'TEACHER';`);

    const addManager = migration.indexOf("ADD VALUE 'MANAGER'");
    const commit = migration.lastIndexOf("COMMIT;");
    const bodyAfterAdd = migration.slice(addManager, commit).replace("ADD VALUE 'MANAGER'", "");
    expect(bodyAfterAdd).not.toMatch(/'MANAGER'::"Role"/);
  });

  it("adds the one-to-one link, role consistency, auth version, and restrictive history FKs", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "User_teacherId_key"');
    expect(migration).toContain('CONSTRAINT "User_teacherId_fkey"');
    expect(migration).toContain("ON DELETE RESTRICT ON UPDATE CASCADE");
    expect(migration).toContain(
      `CHECK (("role" = 'TEACHER'::"Role") = ("teacherId" IS NOT NULL))`,
    );
    expect(migration).toContain('CHECK ("authVersion" >= 1)');
    expect(migration).toContain('CREATE TABLE "UserAccountChange"');
    expect(migration).not.toMatch(/UPDATE\s+"User"/i);
  });
});
