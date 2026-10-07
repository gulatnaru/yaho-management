import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertApprovedPreviewUrl,
  assertApprovedSupabaseProjectRef,
  assertPreviewHandshakeRequest,
  assertPreviewMigrationState,
  runtimeDatabaseIdentityFingerprint,
} from "@/lib/e2e/preview-safety";
import {
  assertPreviewDatabasePreflight,
  assertPreviewE2eRunnerProof,
  assertDeploymentMatchesRepository,
  assertPreviewIdentityResponse,
  PREVIEW_E2E_TEST_FILES,
  readPreviewE2eConfiguration,
  withPreviewDatabaseLock,
  type PreviewDatabaseClient,
} from "@/lib/e2e/preview-runner";

const previewProjectRef = "previewproj123";
const productionProjectRef = "productionproj456";
const previewIdentity = { database: "postgres", currentUser: "postgres", currentSchema: "public" };
const previewFingerprint = runtimeDatabaseIdentityFingerprint(previewIdentity, previewProjectRef);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function migrationFixture(names = ["20261002090000_preview_e2e"]): {
  root: string;
  rows: Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "yaho-preview-e2e-"));
  temporaryDirectories.push(root);
  const rows = names.map((name) => {
    const directory = path.join(root, name);
    mkdirSync(directory);
    const sql = `-- ${name}\nSELECT 1;\n`;
    writeFileSync(path.join(directory, "migration.sql"), sql);
    return {
      migration_name: name,
      checksum: createHash("sha256").update(sql).digest("hex"),
      finished_at: new Date(),
      rolled_back_at: null,
    };
  });
  return { root, rows };
}

function configurationEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PLAYWRIGHT_BASE_URL: "https://yaho-management-git-phase19-example.vercel.app",
    PREVIEW_E2E_ALLOWED_BASE_URLS: "https://yaho-management-git-phase19-example.vercel.app",
    PREVIEW_E2E_DEPLOYMENT_SHA: "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4",
    DATABASE_URL: `postgresql://postgres.${previewProjectRef}:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql://postgres:secret@db.${previewProjectRef}.supabase.co:5432/postgres`,
    PREVIEW_E2E_SUPABASE_PROJECT_REF: previewProjectRef,
    PRODUCTION_E2E_SUPABASE_PROJECT_REF: productionProjectRef,
    PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256: previewFingerprint,
    PREVIEW_E2E_HANDSHAKE_SECRET: "test-handshake-secret",
    VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret",
  } as NodeJS.ProcessEnv;
}

function queryClient(identity: { database: string; currentUser: string; currentSchema: string }, rows: unknown[] = []): PreviewDatabaseClient {
  const session = {
    $queryRaw: async <T>(query: TemplateStringsArray): Promise<T> => {
      const sql = query.join(" ");
      return (sql.includes("_prisma_migrations") ? rows : [identity]) as T;
    },
  };
  return {
    ...session,
    $transaction: async <T>(callback: (transaction: typeof session) => Promise<T>): Promise<T> => callback(session),
  };
}

describe("Preview E2E target safety", () => {
  it("blocks the Production alias and any unapproved or non-Preview URL", () => {
    expect(() => assertApprovedPreviewUrl(
      "https://yaho-management.vercel.app",
      "https://yaho-management.vercel.app",
    )).toThrowError("Production URL");
    expect(() => assertApprovedPreviewUrl(
      "https://yaho-management-git-other.vercel.app",
      "https://yaho-management-git-approved.vercel.app",
    )).toThrowError("not approved");
    expect(() => assertApprovedPreviewUrl(
      "https://example.test",
      "https://example.test",
    )).toThrowError("requires a Vercel Preview URL");
  });

  it("allows only the exact approved Preview origin and creates unique run IDs", () => {
    const environment = configurationEnvironment();
    const first = readPreviewE2eConfiguration(environment, () => "00000000-0000-4000-8000-000000000001");
    const second = readPreviewE2eConfiguration(environment, () => "00000000-0000-4000-8000-000000000002");
    expect(first.baseUrl).toBe(environment.PLAYWRIGHT_BASE_URL);
    expect(first.runId).toMatch(/^preview-[A-Za-z0-9_-]{22}$/);
    expect(second.runId).toMatch(/^preview-[A-Za-z0-9_-]{22}$/);
    expect(first.runId).not.toBe(second.runId);
  });

  it("allows separate projects with an identical postgres/public runtime tuple without a Production fingerprint", () => {
    expect(() => readPreviewE2eConfiguration(configurationEnvironment())).not.toThrow();
  });

  it("rejects equal configured Preview and Production refs before any database client exists", () => {
    const environment = configurationEnvironment();
    environment.PRODUCTION_E2E_SUPABASE_PROJECT_REF = previewProjectRef;
    expect(() => readPreviewE2eConfiguration(environment)).toThrowError("Preview and Production projects must differ");
  });

  it("rejects a Production Supabase project before a database connection even when runtime values collide", () => {
    const productionUrl = `postgresql://postgres.${productionProjectRef}:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`;
    expect(() => assertApprovedSupabaseProjectRef({
      databaseUrl: productionUrl,
      expectedProjectRef: previewProjectRef,
      productionProjectRef,
    })).toThrowError("Production database");
    expect(() => assertApprovedSupabaseProjectRef({
      databaseUrl: `postgresql://postgres:secret@db.otherproject789.supabase.co:5432/postgres`,
      expectedProjectRef: previewProjectRef,
      productionProjectRef,
    })).toThrowError("approved Preview project");
  });

  it("accepts official direct and shared-pooler hosts, including custom roles, but rejects hostile hosts", () => {
    expect(assertApprovedSupabaseProjectRef({
      databaseUrl: `postgresql://postgres:secret@db.${previewProjectRef}.supabase.co:5432/postgres`,
      expectedProjectRef: previewProjectRef,
    })).toBe(previewProjectRef);
    expect(assertApprovedSupabaseProjectRef({
      databaseUrl: `postgresql://custom_role.${previewProjectRef}:secret@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`,
      expectedProjectRef: previewProjectRef,
    })).toBe(previewProjectRef);
    expect(() => assertApprovedSupabaseProjectRef({
      databaseUrl: `postgresql://postgres.${previewProjectRef}:secret@attacker.example:5432/postgres`,
      expectedProjectRef: previewProjectRef,
    })).toThrowError("project identity could not be verified");
  });

  it("fails closed outside Preview or with a bad handshake without exposing the secret", () => {
    const secret = "do-not-print";
    expect(() => assertPreviewHandshakeRequest({
      vercelEnv: "production",
      expectedSecret: secret,
      suppliedSecret: secret,
      expectedFingerprint: previewFingerprint,
    })).toThrowError("unavailable");
    let message = "";
    try {
      assertPreviewHandshakeRequest({
        vercelEnv: "preview",
        expectedSecret: secret,
        suppliedSecret: "wrong",
        expectedFingerprint: previewFingerprint,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(secret);
  });

  it("rejects accidental direct Preview Playwright invocation without the runner proof", () => {
    expect(() => assertPreviewE2eRunnerProof({ proofPath: undefined, proof: undefined })).toThrowError(
      "must be started with npm run test:e2e:preview",
    );
  });
});

describe("Preview E2E database and deployment preflight", () => {
  it("blocks a Production database and a runner database mismatch", async () => {
    const fixture = migrationFixture();
    await expect(assertPreviewDatabasePreflight({
      databaseClient: queryClient(previewIdentity),
      directClient: queryClient({ database: "postgres", currentUser: "wrong_role", currentSchema: "public" }, fixture.rows),
      approvedRuntimeFingerprint: previewFingerprint,
      previewProjectRef,
      databaseSchema: "public",
      directSchema: "public",
      migrationRoot: fixture.root,
    })).rejects.toThrowError("not the approved Preview database");
  });

  it("blocks an unknown runner identity and an app identity or deployment mismatch", async () => {
    const fixture = migrationFixture();
    await expect(assertPreviewDatabasePreflight({
      databaseClient: queryClient({ database: "", currentUser: "", currentSchema: "public" }),
      directClient: queryClient(previewIdentity, fixture.rows),
      approvedRuntimeFingerprint: previewFingerprint,
      previewProjectRef,
      databaseSchema: "public",
      directSchema: "public",
      migrationRoot: fixture.root,
    })).rejects.toThrowError("could not be verified");

    expect(() => assertPreviewIdentityResponse(
      { fingerprint: "a".repeat(64), deploymentSha: "a1b2c3d4" },
      { approvedRuntimeFingerprint: previewFingerprint, deploymentSha: "a1b2c3d4" },
    )).toThrowError("not connected");
    expect(() => assertPreviewIdentityResponse(
      { fingerprint: previewFingerprint, deploymentSha: "a1b2c3d4" },
      { approvedRuntimeFingerprint: previewFingerprint, deploymentSha: "ffffffff" },
    )).toThrowError("does not match");
  });

  it("rejects a runtime schema that differs from the Prisma URL schema target", async () => {
    const fixture = migrationFixture();
    await expect(assertPreviewDatabasePreflight({
      databaseClient: queryClient({ ...previewIdentity, currentSchema: "other" }),
      directClient: queryClient(previewIdentity, fixture.rows),
      approvedRuntimeFingerprint: previewFingerprint,
      previewProjectRef,
      databaseSchema: "public",
      directSchema: "public",
      migrationRoot: fixture.root,
    })).rejects.toThrowError("could not be verified");
  });

  it("accepts a matching app and runner after a clean migration check", async () => {
    const fixture = migrationFixture();
    await expect(assertPreviewDatabasePreflight({
      databaseClient: queryClient(previewIdentity),
      directClient: queryClient(previewIdentity, fixture.rows),
      approvedRuntimeFingerprint: previewFingerprint,
      previewProjectRef,
      databaseSchema: "public",
      directSchema: "public",
      migrationRoot: fixture.root,
    })).resolves.toBeUndefined();
    expect(() => assertPreviewIdentityResponse(
      { fingerprint: previewFingerprint, deploymentSha: "a1b2c3d4" },
      { approvedRuntimeFingerprint: previewFingerprint, deploymentSha: "a1b2c3d4" },
    )).not.toThrow();
  });
});

describe("Preview E2E migration and lock guards", () => {
  it("binds the migration manifest to the exact deployed commit and clean migration path", () => {
    const sha = "a".repeat(40);
    expect(() => assertDeploymentMatchesRepository({
      deploymentSha: sha,
      head: () => sha,
      migrationStatus: () => "",
    })).not.toThrow();
    expect(() => assertDeploymentMatchesRepository({
      deploymentSha: sha,
      head: () => "b".repeat(40),
      migrationStatus: () => "",
    })).toThrowError("does not match");
    expect(() => assertDeploymentMatchesRepository({
      deploymentSha: sha,
      head: () => sha,
      migrationStatus: () => "?? prisma/migrations/20261003_untracked/migration.sql",
    })).toThrowError("changed or untracked");
  });
  it("rejects pending, failed, unknown, and checksum-mismatched migrations", () => {
    const fixture = migrationFixture();
    expect(() => assertPreviewMigrationState({ migrationRoot: fixture.root, rows: [] })).toThrowError("all migrations");
    expect(() => assertPreviewMigrationState({
      migrationRoot: fixture.root,
      rows: [{ ...fixture.rows[0]!, finished_at: null }],
    })).toThrowError("clean migration history");
    expect(() => assertPreviewMigrationState({
      migrationRoot: fixture.root,
      rows: [{ ...fixture.rows[0]!, migration_name: "unknown" }],
    })).toThrowError("not recognized");
    expect(() => assertPreviewMigrationState({
      migrationRoot: fixture.root,
      rows: [{ ...fixture.rows[0]!, checksum: "0".repeat(64) }],
    })).toThrowError("does not match");
  });

  it("rejects a concurrent lock before the child work starts", async () => {
    let ran = false;
    const client = queryClient(previewIdentity);
    client.$transaction = async (callback) => callback({
      $queryRaw: async <T>(): Promise<T> => [{ acquired: false }] as T,
    });
    await expect(withPreviewDatabaseLock({
      client,
      run: async () => { ran = true; },
      onSessionLost: () => undefined,
    })).rejects.toThrowError("Another Preview E2E run");
    expect(ran).toBe(false);
  });

  it("keeps only the approved static Preview suite", () => {
    expect(PREVIEW_E2E_TEST_FILES).toEqual([
      "tests/e2e/auth.spec.ts",
      "tests/e2e/phase6-access.spec.ts",
      "tests/e2e/phase11-core-operations.spec.ts",
      "tests/e2e/phase20-application-group-siblings.spec.ts",
      "tests/e2e/phase20-application-finance-returns.spec.ts",
      "tests/e2e/phase20-companion-repeat-privacy.spec.ts",
      "tests/e2e/phase20-postgres-races.spec.ts",
    ]);
    expect(PREVIEW_E2E_TEST_FILES).not.toContain("tests/e2e/phase18-retention-concurrency.spec.ts");
    expect(PREVIEW_E2E_TEST_FILES).not.toContain("tests/e2e/phase18-reservation-application.spec.ts");
  });
});
