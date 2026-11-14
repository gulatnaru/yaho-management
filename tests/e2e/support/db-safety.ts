const EXPECTED_DATABASE = {
  hosts: new Set(["127.0.0.1", "localhost"]),
  database: "yaho_e2e",
  user: "yaho_e2e",
} as const;

/**
 * Default gate: only the dedicated local E2E cluster on port 55432.
 * Callers that need another isolated local cluster pass it explicitly via
 * `additionalPorts` — the default never widens on its own.
 */
const DEFAULT_ALLOWED_PORTS: ReadonlySet<string> = new Set(["55432"]);

type DatabaseUrlName = "DATABASE_URL" | "DIRECT_URL";

type DatabaseUrlEnvironment = {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
};

export type DatabaseSafetyOptions = {
  /**
   * Extra ports to accept in addition to the default 55432. Explicit opt-in
   * only — omitting this keeps the 55432-only gate. Only the OQ-16 form
   * test passes 55435 (its isolated integration cluster); every other
   * caller uses the default.
   */
  additionalPorts?: readonly string[];
};

export type DatabaseConnectionMetadata = {
  host: string;
  port: string;
  database: string;
  user: string;
};

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "<invalid>";
  }
}

function formatMetadata(metadata: DatabaseConnectionMetadata) {
  return `host=${metadata.host}, port=${metadata.port}, database=${metadata.database}, user=${metadata.user}`;
}

export function assertSafeE2eDatabaseUrl(
  name: DatabaseUrlName,
  value: string | undefined,
  options?: DatabaseSafetyOptions,
): DatabaseConnectionMetadata {
  if (!value) {
    throw new Error(`[Playwright DB safety] ${name} is missing.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[Playwright DB safety] ${name} cannot be parsed.`);
  }

  const metadata = {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port,
    database: decode(parsed.pathname.replace(/^\//, "")),
    user: decode(parsed.username),
  };
  const isPostgreSql = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
  const allowedPorts = new Set(DEFAULT_ALLOWED_PORTS);
  for (const port of options?.additionalPorts ?? []) {
    allowedPorts.add(port);
  }
  const isSafe =
    isPostgreSql &&
    EXPECTED_DATABASE.hosts.has(metadata.host) &&
    allowedPorts.has(metadata.port) &&
    metadata.database === EXPECTED_DATABASE.database &&
    metadata.user === EXPECTED_DATABASE.user;

  if (!isSafe) {
    throw new Error(
      `[Playwright DB safety] ${name} is not the dedicated local E2E database (${formatMetadata(metadata)}).`,
    );
  }

  return metadata;
}

export function assertSafeE2eDatabaseUrls(
  environment: DatabaseUrlEnvironment,
  options?: DatabaseSafetyOptions,
) {
  return {
    DATABASE_URL: assertSafeE2eDatabaseUrl("DATABASE_URL", environment.DATABASE_URL, options),
    DIRECT_URL: assertSafeE2eDatabaseUrl("DIRECT_URL", environment.DIRECT_URL, options),
  };
}
