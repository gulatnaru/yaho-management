import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEMA_PATH = "prisma/schema.prisma";
const MIGRATIONS_PREFIX = "prisma/migrations/";
const MIGRATION_LOCK_PATH = "prisma/migrations/migration_lock.toml";

export type SchemaChangeKind = "NO_SCHEMA_CHANGE" | "SCHEMA_CHANGE" | "FAIL";

export type GitDiffEntry = {
  status: string;
  path: string;
  previousPath?: string;
};

export type SchemaChangeResult = {
  kind: SchemaChangeKind;
  schemaChanged: boolean;
  migrationNames: string[];
  errors: string[];
};

type AnalyzeSchemaChangeInput = {
  entries: GitDiffEntry[];
  baseMigrationFiles: string[];
  headMigrationFiles: string[];
};

function migrationName(path: string): string | undefined {
  if (!path.startsWith(MIGRATIONS_PREFIX) || path === MIGRATION_LOCK_PATH) return undefined;
  return path.slice(MIGRATIONS_PREFIX.length).split("/")[0] || undefined;
}

export function parseNameStatus(output: string): GitDiffEntry[] {
  if (output.trim() === "") return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const [status, firstPath, secondPath] = line.split("\t");
      if (!status || !firstPath) throw new Error("invalid git name-status output");
      if (status.startsWith("R") || status.startsWith("C")) {
        if (!secondPath) throw new Error("rename/copy entry is missing its destination path");
        return { status, path: secondPath, previousPath: firstPath };
      }
      return { status, path: firstPath };
    });
}

export function analyzeSchemaChange({
  entries,
  baseMigrationFiles,
  headMigrationFiles,
}: AnalyzeSchemaChangeInput): SchemaChangeResult {
  const errors: string[] = [];
  const baseMigrationNames = new Set(
    baseMigrationFiles.map(migrationName).filter((name): name is string => Boolean(name)),
  );
  const headMigrationNames = new Set(
    headMigrationFiles.map(migrationName).filter((name): name is string => Boolean(name)),
  );
  const newMigrationNames = [...headMigrationNames]
    .filter((name) => !baseMigrationNames.has(name))
    .sort();
  const newMigrationNameSet = new Set(newMigrationNames);
  let schemaFileChanged = false;

  for (const entry of entries) {
    const paths = [entry.previousPath, entry.path].filter((path): path is string => Boolean(path));
    if (paths.includes(SCHEMA_PATH)) {
      schemaFileChanged = true;
      if (entry.status.startsWith("D") || entry.status.startsWith("R")) {
        errors.push("prisma/schema.prisma cannot be deleted or renamed");
      }
    }

    if (paths.includes(MIGRATION_LOCK_PATH)) {
      errors.push("migration_lock.toml changes require a separate release review");
    }

    const touchedMigrationNames = paths.map(migrationName).filter((name): name is string => Boolean(name));
    for (const name of touchedMigrationNames) {
      if (baseMigrationNames.has(name)) {
        errors.push(`existing migration cannot be modified, deleted, copied, or renamed: ${name}`);
      } else if (!newMigrationNameSet.has(name)) {
        errors.push(`migration change could not be classified safely: ${name}`);
      }
    }
  }

  for (const name of newMigrationNames) {
    const directoryPrefix = `${MIGRATIONS_PREFIX}${name}/`;
    const files = headMigrationFiles.filter((path) => path.startsWith(directoryPrefix));
    if (!files.includes(`${directoryPrefix}migration.sql`)) {
      errors.push(`new migration is missing migration.sql: ${name}`);
    }
    const unsupportedFiles = files.filter((path) => path !== `${directoryPrefix}migration.sql`);
    if (unsupportedFiles.length > 0) {
      errors.push(`new migration contains unsupported files: ${name}`);
    }
  }

  if (schemaFileChanged && newMigrationNames.length === 0) {
    errors.push("prisma/schema.prisma changed without a new migration");
  }

  const schemaChanged = schemaFileChanged || newMigrationNames.length > 0;
  return {
    kind: errors.length > 0 ? "FAIL" : schemaChanged ? "SCHEMA_CHANGE" : "NO_SCHEMA_CHANGE",
    schemaChanged,
    migrationNames: newMigrationNames,
    errors: [...new Set(errors)].sort(),
  };
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function filesAtRevision(revision: string): string[] {
  const output = git(["ls-tree", "-r", "--name-only", revision, "--", "prisma/migrations"]);
  return output.trim() === "" ? [] : output.trim().split("\n");
}

export function detectSchemaChange(base: string, head: string): SchemaChangeResult {
  const output = git([
    "diff",
    "--name-status",
    "--find-renames",
    `${base}...${head}`,
    "--",
    SCHEMA_PATH,
    "prisma/migrations",
  ]);
  return analyzeSchemaChange({
    entries: parseNameStatus(output),
    baseMigrationFiles: filesAtRevision(base),
    headMigrationFiles: filesAtRevision(head),
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeGithubOutput(path: string, result: SchemaChangeResult): void {
  appendFileSync(
    path,
    [
      `kind=${result.kind}`,
      `schema_change=${String(result.schemaChanged)}`,
      `migration_names=${JSON.stringify(result.migrationNames)}`,
      `errors=${JSON.stringify(result.errors)}`,
    ].join("\n") + "\n",
  );
}

function main(): void {
  const base = argument("--base");
  const head = argument("--head");
  const githubOutput = argument("--github-output");
  if (!base || !head) {
    console.error("schema change detection requires --base and --head");
    process.exitCode = 2;
    return;
  }

  const result = detectSchemaChange(base, head);
  if (githubOutput) writeGithubOutput(githubOutput, result);
  console.log(JSON.stringify(result));
  if (result.kind === "FAIL") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
