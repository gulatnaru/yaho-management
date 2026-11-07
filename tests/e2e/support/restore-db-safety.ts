import { assertSafeE2eDatabaseUrls, type DatabaseConnectionMetadata } from "./db-safety";

/**
 * Derived-URL safety gate for the G2 R-01 PostgreSQL backup/restore experiment.
 *
 * The existing gate in db-safety.ts pins the database name to `yaho_e2e` with an
 * exact match, so it cannot validate the experiment's derived databases. This
 * helper validates a derived URL WITHOUT changing the existing gate's meaning:
 * db-safety.ts is never edited, and its exact-match rule still applies to the
 * base URLs first (see assertRestoreDatabaseUrls below).
 *
 * A derived URL is accepted only when every field matches the CI-local service
 * and the database name is exactly one of this run's two databases.
 */

const RESTORE_DATABASE_PATTERN = /^yaho_restore_(source|target)_[0-9a-f]{12}$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const CI_PORT = "55432";
const CI_USER = "yaho_e2e";

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "<invalid>";
  }
}

function metadataOf(parsed: URL): DatabaseConnectionMetadata {
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port,
    database: decode(parsed.pathname.replace(/^\//, "")),
    user: decode(parsed.username),
  };
}

/**
 * Derive a restore database URL from a verified base URL by replacing only the
 * database name. Host, port, user and password are never typed by hand.
 * Throws unless the database name matches this run's allowlist pattern.
 */
export function deriveRestoreDatabaseUrl(baseUrl: string, database: string): string {
  if (!RESTORE_DATABASE_PATTERN.test(database)) {
    throw new Error(`[Restore DB safety] database name is not a restore database: ${database}.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("[Restore DB safety] base URL cannot be parsed.");
  }
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Validate one derived restore URL. The database name must equal the expected
 * name for this run; the host must be CI-local; Supabase/pooler/production
 * host patterns are rejected. Returns non-secret connection metadata only
 * (host, port, database, user) for logging.
 */
export function assertRestoreDatabaseUrl(
  name: string,
  value: string | undefined,
  expectedDatabase: string,
): DatabaseConnectionMetadata {
  if (!value) {
    throw new Error(`[Restore DB safety] ${name} is missing.`);
  }
  if (!RESTORE_DATABASE_PATTERN.test(expectedDatabase)) {
    throw new Error(`[Restore DB safety] expected database name is not a restore database: ${expectedDatabase}.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[Restore DB safety] ${name} cannot be parsed.`);
  }
  const metadata = metadataOf(parsed);
  const protocolOk = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
  const host = metadata.host;
  const hostDenied =
    host.endsWith(".supabase.co") ||
    host.includes("pooler.supabase.com") ||
    host.includes("supabase") ||
    !LOCAL_HOSTS.has(host);
  const isSafe =
    protocolOk &&
    !hostDenied &&
    metadata.port === CI_PORT &&
    metadata.user === CI_USER &&
    metadata.database === expectedDatabase;
  if (!isSafe) {
    throw new Error(
      `[Restore DB safety] ${name} is not this run's isolated CI database ` +
        `(host=${metadata.host}, port=${metadata.port}, database=${metadata.database}, user=${metadata.user}).`,
    );
  }
  return metadata;
}

/**
 * Validate the base URLs with the existing exact-match gate first, then both
 * derived URLs. Call this before any derived-database work starts.
 */
export function assertRestoreDatabaseUrls(input: {
  baseDatabaseUrl: string | undefined;
  baseDirectUrl: string | undefined;
  sourceUrl: string | undefined;
  targetUrl: string | undefined;
  sourceDatabase: string;
  targetDatabase: string;
}): {
  base: { DATABASE_URL: DatabaseConnectionMetadata; DIRECT_URL: DatabaseConnectionMetadata };
  source: DatabaseConnectionMetadata;
  target: DatabaseConnectionMetadata;
} {
  const base = assertSafeE2eDatabaseUrls({
    DATABASE_URL: input.baseDatabaseUrl,
    DIRECT_URL: input.baseDirectUrl,
  });
  return {
    base,
    source: assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", input.sourceUrl, input.sourceDatabase),
    target: assertRestoreDatabaseUrl("RESTORE_TARGET_URL", input.targetUrl, input.targetDatabase),
  };
}

/** Extract the CI password for PGPASSWORD delivery only. Never log the result. */
export function restorePasswordFromUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("[Restore DB safety] base URL cannot be parsed.");
  }
  const password = decodeURIComponent(parsed.password);
  if (!password) {
    throw new Error("[Restore DB safety] base URL has no password for PGPASSWORD delivery.");
  }
  return password;
}

/** Accept only a PostgreSQL 16 service version string (server is postgres:16). */
export function assertRestoreServiceVersion(version: string): void {
  if (!version.startsWith("PostgreSQL 16.")) {
    throw new Error(`[Restore DB safety] unexpected database service version: ${version}.`);
  }
}
