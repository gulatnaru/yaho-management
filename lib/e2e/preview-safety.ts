import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const PREVIEW_E2E_PRODUCTION_HOST = "yaho-management.vercel.app";

export class PreviewE2eSafetyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PreviewE2eSafetyError";
  }
}

export type RuntimeDatabaseIdentity = {
  database: string;
  currentUser: string;
  currentSchema: string;
};

export type PrismaMigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

function isSha256(value: string | undefined): value is string {
  return value !== undefined && /^[a-f0-9]{64}$/i.test(value);
}

function opaqueError(code: string, message: string): never {
  throw new PreviewE2eSafetyError(code, message);
}

function normalizedOrigin(value: string, code: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return opaqueError(code, "Preview E2E URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return opaqueError(code, "Preview E2E URL must be an HTTPS origin");
  }
  return parsed.origin;
}

/** Exact origin approval prevents a guessed Vercel URL from becoming an E2E target. */
export function assertApprovedPreviewUrl(baseUrl: string | undefined, allowedUrls: string | undefined): string {
  if (!baseUrl) opaqueError("MISSING_BASE_URL", "Preview E2E base URL is missing");
  if (!allowedUrls) opaqueError("MISSING_URL_ALLOWLIST", "Preview E2E URL allowlist is missing");

  const origin = normalizedOrigin(baseUrl, "INVALID_BASE_URL");
  const host = new URL(origin).hostname.toLowerCase();
  if (host === PREVIEW_E2E_PRODUCTION_HOST) {
    opaqueError("PRODUCTION_URL", "Preview E2E refuses the Production URL");
  }
  if (!host.endsWith(".vercel.app")) {
    opaqueError("NON_PREVIEW_URL", "Preview E2E requires a Vercel Preview URL");
  }

  const approvedOrigins = allowedUrls.split(",").map((item) => normalizedOrigin(item.trim(), "INVALID_URL_ALLOWLIST"));
  if (!approvedOrigins.includes(origin)) {
    opaqueError("UNAPPROVED_URL", "Preview E2E URL is not approved");
  }
  return origin;
}

function isProjectRef(value: string | undefined): value is string {
  return value !== undefined && /^[a-z0-9]{8,}$/i.test(value);
}

/** Extracts the Supabase project ref without ever returning a credential or URL. */
export function supabaseProjectRefFromDatabaseUrl(connectionString: string | undefined): string {
  if (!connectionString) opaqueError("MISSING_DATABASE_URL", "Preview E2E database URL is missing");
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return opaqueError("INVALID_DATABASE_URL", "Preview E2E database URL is invalid");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return opaqueError("INVALID_DATABASE_URL", "Preview E2E database URL must use PostgreSQL");
  }
  const hostname = parsed.hostname.toLowerCase();
  const direct = hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
  let pooler: string | undefined;
  if (hostname.endsWith(".pooler.supabase.com")) {
    try {
    const username = decodeURIComponent(parsed.username);
      // Supabase shared pooler usernames are [ROLE].[PROJECT-REF]. The role
      // can be custom, so derive the ref from the final component only.
      pooler = username.match(/^.+\.([a-z0-9]+)$/i)?.[1];
    } catch {
      return opaqueError("INVALID_DATABASE_URL", "Preview E2E database URL is invalid");
    }
  }
  const projectRef = direct ?? pooler;
  if (!isProjectRef(projectRef)) {
    return opaqueError("DATABASE_PROJECT_UNKNOWN", "Preview E2E database project identity could not be verified");
  }
  return projectRef.toLowerCase();
}

export function assertApprovedSupabaseProjectRef({
  databaseUrl,
  expectedProjectRef,
  productionProjectRef,
}: {
  databaseUrl: string | undefined;
  expectedProjectRef: string | undefined;
  productionProjectRef?: string | undefined;
}): string {
  if (!isProjectRef(expectedProjectRef)) {
    opaqueError("INVALID_PREVIEW_PROJECT", "Preview E2E approved project identity is invalid");
  }
  const actual = supabaseProjectRefFromDatabaseUrl(databaseUrl);
  if (productionProjectRef !== undefined) {
    if (!isProjectRef(productionProjectRef)) {
      opaqueError("INVALID_PRODUCTION_PROJECT", "Preview E2E Production project identity is invalid");
    }
    if (actual === productionProjectRef.toLowerCase()) {
      opaqueError("PRODUCTION_DATABASE", "Preview E2E refuses the Production database");
    }
  }
  if (actual !== expectedProjectRef.toLowerCase()) {
    opaqueError("DATABASE_PROJECT_MISMATCH", "Preview E2E database is not the approved Preview project");
  }
  return actual;
}

/** Phase 19 uses only Prisma's explicit public schema target. */
export function prismaSchemaTargetFromDatabaseUrl(connectionString: string | undefined): string {
  if (!connectionString) opaqueError("MISSING_DATABASE_URL", "Preview E2E database URL is missing");
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { return opaqueError("INVALID_DATABASE_URL", "Preview E2E database URL is invalid"); }
  const schema = parsed.searchParams.get("schema") ?? "public";
  if (schema !== "public") opaqueError("UNSUPPORTED_PRISMA_SCHEMA", "Preview E2E database schema is not approved");
  return schema;
}

export function runtimeDatabaseIdentityFingerprint(identity: RuntimeDatabaseIdentity, projectRef: string, prismaSchema = "public"): string {
  return createHash("sha256")
    .update(JSON.stringify({ projectRef, database: identity.database, currentUser: identity.currentUser, currentSchema: identity.currentSchema, prismaSchema }))
    .digest("hex");
}

export function assertApprovedRuntimeDatabaseIdentity(
  identity: RuntimeDatabaseIdentity,
  projectRef: string,
  expectedFingerprint: string | undefined,
  prismaSchema = "public",
): string {
  if (!isSha256(expectedFingerprint)) {
    opaqueError("INVALID_DB_FINGERPRINT", "Preview E2E database approval fingerprint is invalid");
  }
  if (!identity.database || !identity.currentUser || identity.currentSchema !== prismaSchema) {
    opaqueError("DATABASE_IDENTITY_UNKNOWN", "Preview E2E database identity could not be verified");
  }
  const actual = runtimeDatabaseIdentityFingerprint(identity, projectRef, prismaSchema);
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expectedFingerprint.toLowerCase(), "hex");
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    opaqueError("DATABASE_IDENTITY_MISMATCH", "Preview E2E database is not the approved Preview database");
  }
  return actual;
}

export function assertPreviewHandshakeRequest({
  vercelEnv,
  expectedSecret,
  suppliedSecret,
  expectedFingerprint,
}: {
  vercelEnv: string | undefined;
  expectedSecret: string | undefined;
  suppliedSecret: string | null;
  expectedFingerprint: string | undefined;
}): void {
  if (vercelEnv !== "preview") {
    opaqueError("NOT_PREVIEW_DEPLOYMENT", "Preview E2E identity is unavailable");
  }
  if (!expectedSecret || !suppliedSecret || expectedSecret.length !== suppliedSecret.length) {
    opaqueError("HANDSHAKE_DENIED", "Preview E2E identity is unavailable");
  }
  if (!timingSafeEqual(Buffer.from(expectedSecret), Buffer.from(suppliedSecret))) {
    opaqueError("HANDSHAKE_DENIED", "Preview E2E identity is unavailable");
  }
  if (!isSha256(expectedFingerprint)) {
    opaqueError("INVALID_DB_FINGERPRINT", "Preview E2E identity is unavailable");
  }
}

export function listRepositoryMigrations(migrationRoot: string): string[] {
  return readdirSync(migrationRoot)
    .filter((name) => {
      const directory = path.join(migrationRoot, name);
      const migrationFile = path.join(directory, "migration.sql");
      return statSync(directory).isDirectory() && existsSync(migrationFile) && statSync(migrationFile).isFile();
    })
    .sort();
}

function migrationChecksumMatches(migrationRoot: string, migrationName: string, checksum: string): boolean {
  const contents = readFileSync(path.join(migrationRoot, migrationName, "migration.sql"));
  if (createHash("sha256").update(contents).digest("hex") === checksum) return true;
  // Prisma stored this legacy migration with CRLF in existing environments.
  if (migrationName !== "20260825090000_phase6_safety_attendance") return false;
  const crlf = Buffer.from(contents.toString("utf8").replace(/(?<!\r)\n/g, "\r\n"));
  return createHash("sha256").update(crlf).digest("hex") === checksum;
}

/** Preview must exactly represent this checkout's migration history before any E2E write. */
export function assertPreviewMigrationState({
  migrationRoot,
  rows,
}: {
  migrationRoot: string;
  rows: PrismaMigrationRow[];
}): void {
  const repositoryMigrations = listRepositoryMigrations(migrationRoot);
  const repositorySet = new Set(repositoryMigrations);
  const activeRows = rows.filter((row) => row.rolled_back_at === null);
  if (activeRows.some((row) => row.finished_at === null)) {
    opaqueError("FAILED_MIGRATION", "Preview E2E requires a clean migration history");
  }
  if (activeRows.some((row) => !repositorySet.has(row.migration_name))) {
    opaqueError("UNKNOWN_MIGRATION", "Preview E2E migration history is not recognized by this checkout");
  }

  const appliedByName = new Map(activeRows.map((row) => [row.migration_name, row]));
  if (appliedByName.size !== activeRows.length) {
    opaqueError("DUPLICATE_MIGRATION", "Preview E2E migration history is ambiguous");
  }
  for (const migrationName of repositoryMigrations) {
    const row = appliedByName.get(migrationName);
    if (!row) opaqueError("PENDING_MIGRATION", "Preview E2E requires all migrations to be applied");
    if (!migrationChecksumMatches(migrationRoot, migrationName, row.checksum)) {
      opaqueError("MIGRATION_CHECKSUM_MISMATCH", "Preview E2E migration history does not match this checkout");
    }
  }
}

export function createPreviewE2eRunId(random: () => string): string {
  return `preview-${random()}`;
}
