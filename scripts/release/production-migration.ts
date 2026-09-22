import { execFileSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const PHASE_16_MIGRATION = "20260913170000_phase16_account_access_management";
const LEGACY_CRLF_MIGRATION = "20260825090000_phase6_safety_attendance";
const PREFLIGHT_MARKER = /^--\s*yaho-release-preflight:\s*([a-z0-9-]+)\s*$/gim;

type MigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export type MigrationState = {
  repositoryMigrations: string[];
  appliedMigrations: string[];
  pendingMigrations: string[];
  failedMigrations: string[];
  expectedMigrations: string[];
  deployRequired: boolean;
};

export class ProductionMigrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductionMigrationError";
  }
}

export type ConnectedDatabaseIdentity = {
  database: string;
  currentUser: string;
};

function parseDatabaseIdentity(connectionString: string): {
  database: string;
  hostname: string;
  port: string;
  username: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new ProductionMigrationError("INVALID_DATABASE_URL", "Production database URL is invalid");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new ProductionMigrationError("INVALID_DATABASE_URL", "Production database must use PostgreSQL");
  }

  let database: string;
  let username: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new ProductionMigrationError("INVALID_DATABASE_URL", "Production database identity is invalid");
  }
  if (!parsed.hostname || !database || !username) {
    throw new ProductionMigrationError("INVALID_DATABASE_URL", "Production database identity is incomplete");
  }

  return {
    database,
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    username,
  };
}

export function normalizedDatabaseIdentity(connectionString: string): string {
  const identity = parseDatabaseIdentity(connectionString);
  return `${identity.username}@${identity.hostname}:${identity.port}/${identity.database}`;
}

export function databaseIdentityFingerprint(connectionString: string): string {
  return createHash("sha256").update(normalizedDatabaseIdentity(connectionString)).digest("hex");
}

export function assertExpectedFingerprint(connectionString: string, expectedFingerprint: string): void {
  const actual = databaseIdentityFingerprint(connectionString);
  if (!/^[a-f0-9]{64}$/i.test(expectedFingerprint)) {
    throw new ProductionMigrationError(
      "INVALID_EXPECTED_FINGERPRINT",
      "Expected Production database fingerprint is invalid",
    );
  }
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expectedFingerprint.toLowerCase(), "hex");
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    throw new ProductionMigrationError(
      "DATABASE_IDENTITY_MISMATCH",
      "Production database identity did not match the approved fingerprint",
    );
  }
}

export function normalizedRuntimeDatabaseIdentity(
  connectedIdentity: ConnectedDatabaseIdentity,
): string {
  return JSON.stringify({
    database: connectedIdentity.database,
    currentUser: connectedIdentity.currentUser,
  });
}

export function runtimeDatabaseIdentityFingerprint(
  connectedIdentity: ConnectedDatabaseIdentity,
): string {
  return createHash("sha256")
    .update(normalizedRuntimeDatabaseIdentity(connectedIdentity))
    .digest("hex");
}

export function assertExpectedRuntimeFingerprint(
  connectedIdentity: ConnectedDatabaseIdentity,
  expectedFingerprint: string,
): void {
  if (!/^[a-f0-9]{64}$/i.test(expectedFingerprint)) {
    throw new ProductionMigrationError(
      "INVALID_EXPECTED_RUNTIME_FINGERPRINT",
      "Expected Production runtime database fingerprint is invalid",
    );
  }
  const actualBytes = Buffer.from(runtimeDatabaseIdentityFingerprint(connectedIdentity), "hex");
  const expectedBytes = Buffer.from(expectedFingerprint.toLowerCase(), "hex");
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    throw new ProductionMigrationError(
      "DATABASE_RUNTIME_IDENTITY_MISMATCH",
      "Connected database runtime identity did not match the approved fingerprint",
    );
  }
}

export function listRepositoryMigrations(migrationRoot: string): string[] {
  return readdirSync(migrationRoot)
    .filter((name) => {
      const directory = path.join(migrationRoot, name);
      const migrationFile = path.join(directory, "migration.sql");
      return (
        statSync(directory).isDirectory() &&
        existsSync(migrationFile) &&
        statSync(migrationFile).isFile()
      );
    })
    .sort();
}

export function migrationChecksum(migrationRoot: string, migrationName: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(migrationRoot, migrationName, "migration.sql")))
    .digest("hex");
}

export function crlfVariantFromLfBytes(input: Buffer): Buffer {
  let insertedCarriageReturns = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === 0x0a && (index === 0 || input[index - 1] !== 0x0d)) {
      insertedCarriageReturns += 1;
    }
  }

  const output = Buffer.alloc(input.length + insertedCarriageReturns);
  let outputIndex = 0;
  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];
    if (byte === 0x0a && (index === 0 || input[index - 1] !== 0x0d)) {
      output[outputIndex] = 0x0d;
      outputIndex += 1;
    }
    output[outputIndex] = byte;
    outputIndex += 1;
  }
  return output;
}

export function migrationChecksumMatchesApplied(
  migrationRoot: string,
  migrationName: string,
  storedChecksum: string,
): boolean {
  const migrationFile = path.join(migrationRoot, migrationName, "migration.sql");
  const raw = readFileSync(migrationFile);
  const rawChecksum = createHash("sha256").update(raw).digest("hex");
  if (rawChecksum === storedChecksum) return true;
  if (migrationName !== LEGACY_CRLF_MIGRATION) return false;

  const crlfVariant = crlfVariantFromLfBytes(raw);
  return createHash("sha256").update(crlfVariant).digest("hex") === storedChecksum;
}

export function evaluateMigrationState({
  repositoryMigrations,
  rows,
  expectedMigrations,
  migrationRoot,
}: {
  repositoryMigrations: string[];
  rows: MigrationRow[];
  expectedMigrations: string[];
  migrationRoot: string;
}): MigrationState {
  if (expectedMigrations.length === 0) {
    throw new ProductionMigrationError("EXPECTED_MIGRATIONS_EMPTY", "Expected migration list is empty");
  }
  if (new Set(expectedMigrations).size !== expectedMigrations.length) {
    throw new ProductionMigrationError("EXPECTED_MIGRATIONS_DUPLICATE", "Expected migration list contains duplicates");
  }

  const repositorySet = new Set(repositoryMigrations);
  for (const name of expectedMigrations) {
    if (!repositorySet.has(name)) {
      throw new ProductionMigrationError(
        "EXPECTED_MIGRATION_MISSING",
        `Expected migration is missing from the approved payload: ${name}`,
      );
    }
  }

  const activeRows = rows.filter((row) => row.rolled_back_at === null);
  const failedMigrations = activeRows
    .filter((row) => row.finished_at === null)
    .map((row) => row.migration_name)
    .sort();
  if (failedMigrations.length > 0) {
    throw new ProductionMigrationError(
      "FAILED_MIGRATIONS",
      `Production has failed or incomplete migrations: ${failedMigrations.join(", ")}`,
    );
  }

  const appliedRows = activeRows.filter((row) => row.finished_at !== null);
  const appliedByName = new Map(appliedRows.map((row) => [row.migration_name, row]));
  const appliedMigrations = [...appliedByName.keys()].sort();
  const unknownApplied = appliedMigrations.filter((name) => !repositorySet.has(name));
  if (unknownApplied.length > 0) {
    throw new ProductionMigrationError(
      "DATABASE_HISTORY_AHEAD",
      `Production migration history is not represented by the approved payload: ${unknownApplied.join(", ")}`,
    );
  }

  for (const [name, row] of appliedByName) {
    if (!migrationChecksumMatchesApplied(migrationRoot, name, row.checksum)) {
      throw new ProductionMigrationError(
        "APPLIED_MIGRATION_CHANGED",
        `Applied migration checksum differs from the approved payload: ${name}`,
      );
    }
  }

  const pendingMigrations = repositoryMigrations.filter((name) => !appliedByName.has(name));
  const expectedSet = new Set(expectedMigrations);
  const unexpectedPending = pendingMigrations.filter((name) => !expectedSet.has(name));
  if (unexpectedPending.length > 0) {
    throw new ProductionMigrationError(
      "UNEXPECTED_PENDING_MIGRATIONS",
      `Production has unexpected pending migrations: ${unexpectedPending.join(", ")}`,
    );
  }

  const expectedPending = expectedMigrations.filter((name) => pendingMigrations.includes(name));
  const expectedApplied = expectedMigrations.filter((name) => appliedByName.has(name));
  if (expectedPending.length > 0 && expectedApplied.length > 0) {
    throw new ProductionMigrationError(
      "PARTIAL_EXPECTED_MIGRATIONS",
      "Expected migrations are only partially applied; manual recovery review is required",
    );
  }

  return {
    repositoryMigrations,
    appliedMigrations,
    pendingMigrations,
    failedMigrations,
    expectedMigrations: [...expectedMigrations].sort(),
    deployRequired: expectedPending.length === expectedMigrations.length,
  };
}

type QueryClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray): Promise<T>;
};

async function runTrustedBlocker(client: QueryClient, blocker: string): Promise<void> {
  if (blocker === "phase16-unmapped-teacher") {
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "User" WHERE "role" = 'TEACHER'
    `;
    if ((rows[0]?.count ?? 0n) > 0n) {
      throw new ProductionMigrationError(
        "MIGRATION_PREFLIGHT_BLOCKED",
        "Phase 16 migration requires explicit mapping for existing TEACHER users",
      );
    }
    return;
  }
  throw new ProductionMigrationError(
    "UNKNOWN_MIGRATION_PREFLIGHT",
    `Migration requests an unsupported trusted preflight: ${blocker}`,
  );
}

export function trustedPreflightNames(
  migrationRoot: string,
  migrationName: string,
): string[] {
  if (migrationName === PHASE_16_MIGRATION) return ["phase16-unmapped-teacher"];
  const sql = readFileSync(path.join(migrationRoot, migrationName, "migration.sql"), "utf8");
  return [...sql.matchAll(PREFLIGHT_MARKER)].map((match) => match[1]);
}

async function runTrustedPreflights(
  client: QueryClient,
  migrationRoot: string,
  migrationNames: string[],
): Promise<void> {
  for (const migrationName of migrationNames) {
    for (const blocker of trustedPreflightNames(migrationRoot, migrationName)) {
      await runTrustedBlocker(client, blocker);
    }
  }
}

function expectedMigrationsFromEnvironment(environment: NodeJS.ProcessEnv): string[] {
  const raw = environment.EXPECTED_MIGRATIONS;
  if (!raw) {
    throw new ProductionMigrationError("MISSING_SECRET", "Expected migration list is missing");
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error();
    return value;
  } catch {
    throw new ProductionMigrationError("INVALID_EXPECTED_MIGRATIONS", "Expected migration list is invalid");
  }
}

export function readProductionMigrationEnvironment(environment: NodeJS.ProcessEnv = process.env): {
  directUrl: string;
  expectedFingerprint: string;
  expectedRuntimeFingerprint: string;
  expectedMigrations: string[];
} {
  const directUrl = environment.PRODUCTION_DIRECT_URL;
  const expectedFingerprint = environment.PRODUCTION_DB_IDENTITY_SHA256;
  const expectedRuntimeFingerprint = environment.PRODUCTION_DB_RUNTIME_IDENTITY_SHA256;
  if (!directUrl || !expectedFingerprint || !expectedRuntimeFingerprint) {
    throw new ProductionMigrationError("MISSING_SECRET", "Production migration secrets are missing");
  }
  assertExpectedFingerprint(directUrl, expectedFingerprint);
  if (!/^[a-f0-9]{64}$/i.test(expectedRuntimeFingerprint)) {
    throw new ProductionMigrationError(
      "INVALID_EXPECTED_RUNTIME_FINGERPRINT",
      "Expected Production runtime database fingerprint is invalid",
    );
  }
  return {
    directUrl,
    expectedFingerprint,
    expectedRuntimeFingerprint,
    expectedMigrations: expectedMigrationsFromEnvironment(environment),
  };
}

export function assertPostMigrationState(
  state: MigrationState,
  code: "POST_DEPLOY_PENDING" | "POST_STATUS_PENDING",
): void {
  if (state.deployRequired || state.pendingMigrations.length > 0) {
    throw new ProductionMigrationError(code, "Production migration status is not clean");
  }
}

async function inspectState(
  client: PrismaClient,
  expectedRuntimeFingerprint: string,
  migrationRoot: string,
  expectedMigrations: string[],
): Promise<MigrationState> {
  const identity = await client.$queryRaw<Array<ConnectedDatabaseIdentity & { connected: number }>>`
    SELECT current_database() AS database, current_user AS "currentUser", 1 AS connected
  `;
  if (identity[0]?.connected !== 1) {
    throw new ProductionMigrationError(
      "DATABASE_IDENTITY_MISMATCH",
      "Production database connection identity could not be verified",
    );
  }
  assertExpectedRuntimeFingerprint(identity[0], expectedRuntimeFingerprint);
  const rows = await client.$queryRaw<MigrationRow[]>`
    SELECT "migration_name", "checksum", "finished_at", "rolled_back_at"
    FROM "_prisma_migrations"
    ORDER BY "started_at" ASC
  `;
  return evaluateMigrationState({
    repositoryMigrations: listRepositoryMigrations(migrationRoot),
    rows,
    expectedMigrations,
    migrationRoot,
  });
}

export type CommandRunner = (binary: string, args: string[], environment: NodeJS.ProcessEnv) => void;

const defaultCommandRunner: CommandRunner = (binary, args, environment) => {
  execFileSync(binary, args, {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
};

export function runApprovedPrismaCommand({
  command,
  schemaPath,
  directUrl,
  runner = defaultCommandRunner,
}: {
  command: "deploy" | "status";
  schemaPath: string;
  directUrl: string;
  runner?: CommandRunner;
}): void {
  const prismaBinary = path.resolve("node_modules/.bin/prisma");
  const args = command === "deploy"
    ? ["migrate", "deploy", "--schema", schemaPath]
    : ["migrate", "status", "--schema", schemaPath];
  runner(prismaBinary, args, {
    ...process.env,
    DATABASE_URL: directUrl,
    DIRECT_URL: directUrl,
  });
}

function writeSummary(stage: string, state: MigrationState): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const lines = [
    `### Production migration ${stage}`,
    "- environment: production",
    `- migrations: ${state.expectedMigrations.join(", ")}`,
    `- result: success`,
  ];
  if (summaryPath) appendFileSync(summaryPath, `${lines.join("\n")}\n`);
  console.log(`[production-migration] ${stage} succeeded for ${state.expectedMigrations.join(", ")}`);
}

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const stage = process.argv[2];
  if (stage !== "preflight" && stage !== "deploy" && stage !== "verify") {
    throw new ProductionMigrationError("INVALID_STAGE", "Use preflight, deploy, or verify");
  }
  const schemaPath = path.resolve(argument("--schema", "prisma/schema.prisma") as string);
  const migrationRoot = path.resolve(argument("--migrations", path.join(path.dirname(schemaPath), "migrations")) as string);
  const { directUrl, expectedRuntimeFingerprint, expectedMigrations } =
    readProductionMigrationEnvironment();
  const client = new PrismaClient({ datasourceUrl: directUrl });

  try {
    let state = await inspectState(
      client,
      expectedRuntimeFingerprint,
      migrationRoot,
      expectedMigrations,
    );
    if (stage === "preflight") {
      if (state.deployRequired) await runTrustedPreflights(client, migrationRoot, expectedMigrations);
      writeSummary(stage, state);
      return;
    }

    if (stage === "deploy") {
      if (state.deployRequired) {
        await runTrustedPreflights(client, migrationRoot, expectedMigrations);
        runApprovedPrismaCommand({ command: "deploy", schemaPath, directUrl });
        state = await inspectState(
          client,
          expectedRuntimeFingerprint,
          migrationRoot,
          expectedMigrations,
        );
      }
      assertPostMigrationState(state, "POST_DEPLOY_PENDING");
      writeSummary(stage, state);
      return;
    }

    runApprovedPrismaCommand({ command: "status", schemaPath, directUrl });
    assertPostMigrationState(state, "POST_STATUS_PENDING");
    writeSummary(stage, state);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof ProductionMigrationError ? error.code : "UNEXPECTED_FAILURE";
    console.error(`[production-migration] failed (${code})`);
    process.exitCode = 1;
  });
}
