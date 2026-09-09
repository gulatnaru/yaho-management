const EXPECTED_DATABASE = {
  hosts: new Set(["127.0.0.1", "localhost"]),
  port: "55432",
  database: "yaho_e2e",
  user: "yaho_e2e",
} as const;

type DatabaseUrlName = "DATABASE_URL" | "DIRECT_URL";

type DatabaseUrlEnvironment = {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
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
  const isSafe =
    isPostgreSql &&
    EXPECTED_DATABASE.hosts.has(metadata.host) &&
    metadata.port === EXPECTED_DATABASE.port &&
    metadata.database === EXPECTED_DATABASE.database &&
    metadata.user === EXPECTED_DATABASE.user;

  if (!isSafe) {
    throw new Error(
      `[Playwright DB safety] ${name} is not the dedicated local E2E database (${formatMetadata(metadata)}).`,
    );
  }

  return metadata;
}

export function assertSafeE2eDatabaseUrls(environment: DatabaseUrlEnvironment) {
  return {
    DATABASE_URL: assertSafeE2eDatabaseUrl("DATABASE_URL", environment.DATABASE_URL),
    DIRECT_URL: assertSafeE2eDatabaseUrl("DIRECT_URL", environment.DIRECT_URL),
  };
}
