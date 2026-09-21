import { describe, expect, it } from "vitest";
import { analyzeSchemaChange, parseNameStatus } from "@/scripts/release/schema-change";

const existingMigration = "prisma/migrations/20260820050000_init/migration.sql";
const newMigration = "prisma/migrations/20261001090000_add_example/migration.sql";

function analyze(
  entries: Parameters<typeof analyzeSchemaChange>[0]["entries"],
  headMigrationFiles = [existingMigration],
) {
  return analyzeSchemaChange({
    entries,
    baseMigrationFiles: [existingMigration],
    headMigrationFiles,
  });
}

describe("schema change detection", () => {
  it("returns NO_SCHEMA_CHANGE for unrelated files", () => {
    expect(analyze([{ status: "M", path: "app/page.tsx" }])).toEqual({
      kind: "NO_SCHEMA_CHANGE",
      schemaChanged: false,
      migrationNames: [],
      errors: [],
    });
  });

  it("accepts a schema change with a new migration", () => {
    expect(
      analyze(
        [
          { status: "M", path: "prisma/schema.prisma" },
          { status: "A", path: newMigration },
        ],
        [existingMigration, newMigration],
      ),
    ).toMatchObject({
      kind: "SCHEMA_CHANGE",
      schemaChanged: true,
      migrationNames: ["20261001090000_add_example"],
      errors: [],
    });
  });

  it("classifies a new raw SQL-only migration as a schema change", () => {
    expect(analyze([{ status: "A", path: newMigration }], [existingMigration, newMigration])).toMatchObject({
      kind: "SCHEMA_CHANGE",
      migrationNames: ["20261001090000_add_example"],
    });
  });

  it("fails when schema.prisma changes without a migration", () => {
    expect(analyze([{ status: "M", path: "prisma/schema.prisma" }])).toMatchObject({
      kind: "FAIL",
      errors: ["prisma/schema.prisma changed without a new migration"],
    });
  });

  it.each([
    { status: "M", path: existingMigration },
    { status: "D", path: existingMigration },
    { status: "R100", previousPath: existingMigration, path: newMigration },
  ])("fails when an existing migration is changed: $status", (entry) => {
    expect(analyze([entry], entry.status === "D" ? [] : [existingMigration])).toMatchObject({ kind: "FAIL" });
  });

  it("fails when a new migration directory has no migration.sql", () => {
    const malformed = "prisma/migrations/20261001090000_add_example/README.md";
    const result = analyze([{ status: "A", path: malformed }], [existingMigration, malformed]);

    expect(result.kind).toBe("FAIL");
    expect(result.errors).toContain("new migration is missing migration.sql: 20261001090000_add_example");
    expect(result.errors).toContain("new migration contains unsupported files: 20261001090000_add_example");
  });

  it("parses git rename output without losing either path", () => {
    expect(parseNameStatus(`R100\t${existingMigration}\t${newMigration}\n`)).toEqual([
      { status: "R100", previousPath: existingMigration, path: newMigration },
    ]);
  });
});
