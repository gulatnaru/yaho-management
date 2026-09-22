import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertExpectedRuntimeFingerprint,
  assertPostMigrationState,
  assertExpectedFingerprint,
  crlfVariantFromLfBytes,
  databaseIdentityFingerprint,
  evaluateMigrationState,
  migrationChecksum,
  normalizedDatabaseIdentity,
  normalizedRuntimeDatabaseIdentity,
  ProductionMigrationError,
  readProductionMigrationEnvironment,
  runtimeDatabaseIdentityFingerprint,
  runApprovedPrismaCommand,
  trustedPreflightNames,
} from "@/scripts/release/production-migration";

function migrationFixture(names: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "yaho-migrations-"));
  for (const name of names) {
    const directory = path.join(root, name);
    mkdirSync(directory);
    writeFileSync(path.join(directory, "migration.sql"), `-- ${name}\nSELECT 1;\n`);
  }
  return root;
}

function appliedRow(root: string, name: string) {
  return {
    migration_name: name,
    checksum: migrationChecksum(root, name),
    finished_at: new Date("2026-01-01T00:00:00Z"),
    rolled_back_at: null,
  };
}

function checksum(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

describe("Production migration identity", () => {
  it("includes the database username but excludes the password from the identity", () => {
    const first = "postgresql://postgres.project-a:secret@db.example.test:5432/postgres?sslmode=require";
    const rotatedPassword = "postgresql://postgres.project-a:rotated@db.example.test:5432/postgres";
    const otherTenant = "postgresql://postgres.project-b:secret@db.example.test:5432/postgres";

    expect(normalizedDatabaseIdentity(first)).toBe("postgres.project-a@db.example.test:5432/postgres");
    expect(databaseIdentityFingerprint(first)).toBe(databaseIdentityFingerprint(rotatedPassword));
    expect(databaseIdentityFingerprint(first)).not.toBe(databaseIdentityFingerprint(otherTenant));
    expect(databaseIdentityFingerprint(first)).not.toContain("secret");
  });

  it("keeps URL tenant identity separate from the connected runtime identity", () => {
    const runtimeIdentity = { database: "postgres", currentUser: "postgres" };
    const runtimeFingerprint = runtimeDatabaseIdentityFingerprint(runtimeIdentity);

    expect(normalizedRuntimeDatabaseIdentity(runtimeIdentity)).toBe(
      '{"database":"postgres","currentUser":"postgres"}',
    );
    expect(() => assertExpectedRuntimeFingerprint(runtimeIdentity, runtimeFingerprint)).not.toThrow();
    expect(() =>
      assertExpectedRuntimeFingerprint(
        { database: "preview", currentUser: "postgres" },
        runtimeFingerprint,
      ),
    ).toThrowError(ProductionMigrationError);
    expect(() =>
      assertExpectedRuntimeFingerprint(
        { database: "postgres", currentUser: "other-role" },
        runtimeFingerprint,
      ),
    ).toThrowError(ProductionMigrationError);
  });

  it.each([
    "postgresql://postgres:secret@db.example.test:5432/postgres",
    "postgresql://postgres.project-a:secret@db.example.test:5432/postgres",
  ])("accepts independent URL and runtime fingerprints for direct and pooled connections", (directUrl) => {
    const runtimeIdentity = { database: "postgres", currentUser: "postgres" };
    const environment = readProductionMigrationEnvironment({
      NODE_ENV: "test",
      EXPECTED_MIGRATIONS: '["migration"]',
      PRODUCTION_DIRECT_URL: directUrl,
      PRODUCTION_DB_IDENTITY_SHA256: databaseIdentityFingerprint(directUrl),
      PRODUCTION_DB_RUNTIME_IDENTITY_SHA256:
        runtimeDatabaseIdentityFingerprint(runtimeIdentity),
    });

    expect(environment.directUrl).toBe(directUrl);
    expect(() =>
      assertExpectedRuntimeFingerprint(runtimeIdentity, environment.expectedRuntimeFingerprint),
    ).not.toThrow();
  });

  it("fails closed on a fingerprint mismatch", () => {
    expect(() =>
      assertExpectedFingerprint(
        "postgresql://user:secret@db.example.test/postgres",
        "0".repeat(64),
      ),
    ).toThrowError(ProductionMigrationError);
  });

  it("does not invoke migrate deploy after an identity fingerprint mismatch", () => {
    const runner = vi.fn();
    const connectionString = "postgresql://postgres.project-a:secret@db.example.test/postgres";

    expect(() => {
      assertExpectedFingerprint(connectionString, "0".repeat(64));
      runApprovedPrismaCommand({
        command: "deploy",
        schemaPath: "/tmp/schema.prisma",
        directUrl: connectionString,
        runner,
      });
    }).toThrowError(ProductionMigrationError);
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not invoke migrate deploy after a runtime fingerprint mismatch", () => {
    const runner = vi.fn();
    const directUrl = "postgresql://postgres.project-a:secret@db.example.test/postgres";

    expect(() => {
      assertExpectedFingerprint(directUrl, databaseIdentityFingerprint(directUrl));
      assertExpectedRuntimeFingerprint(
        { database: "postgres", currentUser: "postgres" },
        runtimeDatabaseIdentityFingerprint({ database: "postgres", currentUser: "other-role" }),
      );
      runApprovedPrismaCommand({
        command: "deploy",
        schemaPath: "/tmp/schema.prisma",
        directUrl,
        runner,
      });
    }).toThrowError(ProductionMigrationError);
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not invoke migrate deploy when URL identity fails even if runtime identity passes", () => {
    const runner = vi.fn();
    const directUrl = "postgresql://postgres.project-a:secret@db.example.test/postgres";
    const runtimeIdentity = { database: "postgres", currentUser: "postgres" };

    expect(() => {
      assertExpectedFingerprint(directUrl, "0".repeat(64));
      assertExpectedRuntimeFingerprint(
        runtimeIdentity,
        runtimeDatabaseIdentityFingerprint(runtimeIdentity),
      );
      runApprovedPrismaCommand({
        command: "deploy",
        schemaPath: "/tmp/schema.prisma",
        directUrl,
        runner,
      });
    }).toThrowError(ProductionMigrationError);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("Production migration state", () => {
  const baseline = "20260820050000_init";
  const expected = "20261001090000_add_example";
  const legacyCrlfMigration = "20260825090000_phase6_safety_attendance";

  it("accepts an exact raw-byte checksum", () => {
    const root = migrationFixture([baseline, expected]);

    expect(
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected],
        rows: [appliedRow(root, baseline)],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toMatchObject({ appliedMigrations: [baseline] });
  });

  it("accepts the legacy Phase 6 CRLF checksum for an LF repository file", () => {
    const root = migrationFixture([legacyCrlfMigration, expected]);
    const lfSql = `-- ${legacyCrlfMigration}\nSELECT 1;\n`;
    const crlfChecksum = checksum(lfSql.replace(/\n/g, "\r\n"));

    expect(
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [{ ...appliedRow(root, legacyCrlfMigration), checksum: crlfChecksum }],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toMatchObject({ appliedMigrations: [legacyCrlfMigration] });
  });

  it("converts only lone LF bytes and preserves CRLF, lone CR, and other bytes", () => {
    const input = Buffer.from([0x41, 0x0a, 0x42, 0x0d, 0x0a, 0x43, 0x0d, 0x44]);
    const expectedBytes = Buffer.from([
      0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x0a, 0x43, 0x0d, 0x44,
    ]);

    expect(crlfVariantFromLfBytes(input)).toEqual(expectedBytes);
  });

  it("preserves invalid UTF-8 bytes and rejects the former string-roundtrip candidate", () => {
    const root = migrationFixture([legacyCrlfMigration, expected]);
    const invalidUtf8Sql = Buffer.from([
      0x2d, 0x2d, 0xff, 0x0a, 0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, 0x31, 0x3b, 0x0a,
    ]);
    const bytePreservingCrlf = Buffer.from([
      0x2d, 0x2d, 0xff, 0x0d, 0x0a, 0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, 0x31, 0x3b,
      0x0d, 0x0a,
    ]);
    writeFileSync(
      path.join(root, legacyCrlfMigration, "migration.sql"),
      invalidUtf8Sql,
    );

    expect(crlfVariantFromLfBytes(invalidUtf8Sql)).toEqual(bytePreservingCrlf);
    expect(
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [
          {
            ...appliedRow(root, legacyCrlfMigration),
            checksum: checksum(bytePreservingCrlf),
          },
        ],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toMatchObject({ appliedMigrations: [legacyCrlfMigration] });

    const buggyStringRoundtrip = Buffer.from(
      invalidUtf8Sql.toString("utf8").replace(/\n/g, "\r\n"),
      "utf8",
    );
    expect(buggyStringRoundtrip).not.toEqual(bytePreservingCrlf);
    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [
          {
            ...appliedRow(root, legacyCrlfMigration),
            checksum: checksum(buggyStringRoundtrip),
          },
        ],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it("rejects a CRLF checksum for a migration outside the legacy allowlist", () => {
    const root = migrationFixture([baseline, expected]);
    const lfSql = `-- ${baseline}\nSELECT 1;\n`;

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected],
        rows: [{ ...appliedRow(root, baseline), checksum: checksum(lfSql.replace(/\n/g, "\r\n")) }],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it.each([
    `prefix-${legacyCrlfMigration}`,
    `${legacyCrlfMigration}-suffix`,
  ])("rejects the CRLF fallback for a similar migration name: %s", (migrationName) => {
    const root = migrationFixture([migrationName, expected]);
    const lfSql = `-- ${migrationName}\nSELECT 1;\n`;

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [migrationName, expected],
        rows: [
          {
            ...appliedRow(root, migrationName),
            checksum: checksum(lfSql.replace(/\n/g, "\r\n")),
          },
        ],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it("rejects changed SQL content for the legacy Phase 6 migration", () => {
    const root = migrationFixture([legacyCrlfMigration, expected]);
    const changedCrlfSql = `-- ${legacyCrlfMigration}\r\nSELECT 2;\r\n`;

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [{ ...appliedRow(root, legacyCrlfMigration), checksum: checksum(changedCrlfSql) }],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it("rejects final-newline changes even for the legacy Phase 6 migration", () => {
    const root = migrationFixture([legacyCrlfMigration, expected]);
    const withoutFinalNewline = `-- ${legacyCrlfMigration}\r\nSELECT 1;`;

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [{ ...appliedRow(root, legacyCrlfMigration), checksum: checksum(withoutFinalNewline) }],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it.each([
    ["comment", `-- changed comment\r\nSELECT 1;\r\n`],
    ["whitespace", `-- ${legacyCrlfMigration}\r\nSELECT  1;\r\n`],
    ["extra newline", `-- ${legacyCrlfMigration}\r\nSELECT 1;\r\n\r\n`],
    ["case", `-- ${legacyCrlfMigration}\r\nselect 1;\r\n`],
  ])("rejects a legacy Phase 6 %s change", (_label, changedSql) => {
    const root = migrationFixture([legacyCrlfMigration, expected]);

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [
          {
            ...appliedRow(root, legacyCrlfMigration),
            checksum: checksum(changedSql),
          },
        ],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it("rejects an arbitrary checksum for the legacy Phase 6 migration", () => {
    const root = migrationFixture([legacyCrlfMigration, expected]);

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [legacyCrlfMigration, expected],
        rows: [
          {
            ...appliedRow(root, legacyCrlfMigration),
            checksum: "0".repeat(64),
          },
        ],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(expect.objectContaining({ code: "APPLIED_MIGRATION_CHANGED" }));
  });

  it("allows exactly the expected pending migration", () => {
    const root = migrationFixture([baseline, expected]);
    expect(
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected],
        rows: [appliedRow(root, baseline)],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toMatchObject({ pendingMigrations: [expected], deployRequired: true });
  });

  it("accepts an idempotent rerun when all expected migrations are already applied", () => {
    const root = migrationFixture([baseline, expected]);
    expect(
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected],
        rows: [appliedRow(root, baseline), appliedRow(root, expected)],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toMatchObject({ pendingMigrations: [], deployRequired: false });
  });

  it("rejects unexpected pending and failed migrations", () => {
    const unexpected = "20260901090000_unexpected";
    const root = migrationFixture([baseline, unexpected, expected]);

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [baseline, unexpected, expected],
        rows: [appliedRow(root, baseline)],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(/unexpected pending/i);

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected],
        rows: [
          appliedRow(root, baseline),
          {
            migration_name: expected,
            checksum: migrationChecksum(root, expected),
            finished_at: null,
            rolled_back_at: null,
          },
        ],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(/failed or incomplete/i);
  });

  it("rejects changed applied migrations and partial expected application", () => {
    const secondExpected = "20261001100000_add_second";
    const root = migrationFixture([baseline, expected, secondExpected]);

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected],
        rows: [{ ...appliedRow(root, baseline), checksum: "changed" }],
        expectedMigrations: [expected],
        migrationRoot: root,
      }),
    ).toThrowError(/checksum/i);

    expect(() =>
      evaluateMigrationState({
        repositoryMigrations: [baseline, expected, secondExpected],
        rows: [appliedRow(root, baseline), appliedRow(root, expected)],
        expectedMigrations: [expected, secondExpected],
        migrationRoot: root,
      }),
    ).toThrowError(/partially applied/i);
  });
});

describe("Production migration command boundary", () => {
  it.each([
    ["deploy" as const, ["migrate", "deploy", "--schema", "/tmp/schema.prisma"]],
    ["status" as const, ["migrate", "status", "--schema", "/tmp/schema.prisma"]],
  ])("only emits the approved Prisma %s command", (command, expectedArgs) => {
    const runner = vi.fn();
    runApprovedPrismaCommand({
      command,
      schemaPath: "/tmp/schema.prisma",
      directUrl: "postgresql://user:secret@db.example.test/postgres",
      runner,
    });

    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][1]).toEqual(expectedArgs);
    expect(runner.mock.calls[0][2]).toMatchObject({
      DATABASE_URL: "postgresql://user:secret@db.example.test/postgres",
      DIRECT_URL: "postgresql://user:secret@db.example.test/postgres",
    });
  });

  it("recognizes only the trusted Phase 16 blocker", () => {
    const root = migrationFixture(["20260913170000_phase16_account_access_management"]);
    expect(trustedPreflightNames(root, "20260913170000_phase16_account_access_management")).toEqual([
      "phase16-unmapped-teacher",
    ]);
  });

  it("propagates migrate deploy failures without trying another command", () => {
    const runner = vi.fn(() => {
      throw new Error("deploy failed");
    });

    expect(() =>
      runApprovedPrismaCommand({
        command: "deploy",
        schemaPath: "/tmp/schema.prisma",
        directUrl: "postgresql://user:secret@db.example.test/postgres",
        runner,
      }),
    ).toThrowError("deploy failed");
    expect(runner).toHaveBeenCalledOnce();
  });

  it("fails closed when required Production secrets are missing", () => {
    expect(() => readProductionMigrationEnvironment({ NODE_ENV: "test" })).toThrowError(
      /secrets are missing/i,
    );

    const directUrl = "postgresql://postgres:secret@db.example.test/postgres";
    expect(() =>
      readProductionMigrationEnvironment({
        NODE_ENV: "test",
        EXPECTED_MIGRATIONS: '["migration"]',
        PRODUCTION_DIRECT_URL: directUrl,
        PRODUCTION_DB_IDENTITY_SHA256: databaseIdentityFingerprint(directUrl),
      }),
    ).toThrowError(/secrets are missing/i);
  });

  it("rejects a pending state during both post-deploy and post-status verification", () => {
    const state = {
      repositoryMigrations: ["migration"],
      appliedMigrations: [],
      pendingMigrations: ["migration"],
      failedMigrations: [],
      expectedMigrations: ["migration"],
      deployRequired: true,
    };

    expect(() => assertPostMigrationState(state, "POST_DEPLOY_PENDING")).toThrowError(
      expect.objectContaining({ code: "POST_DEPLOY_PENDING" }),
    );
    expect(() => assertPostMigrationState(state, "POST_STATUS_PENDING")).toThrowError(
      expect.objectContaining({ code: "POST_STATUS_PENDING" }),
    );
  });
});
