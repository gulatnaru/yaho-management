import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { environmentSchema, requireFact, SafeFailure, type Environment } from "./contract";

export function assertOptInAndLocal(environment: Readonly<Record<string, string | undefined>> = process.env): void {
  requireFact(environment.YAHO_OBS01_PERF === "1", "OPT_IN_REQUIRED");
  requireFact(!environment.VERCEL && !environment.VERCEL_ENV && environment.PLAYWRIGHT_PREVIEW_E2E !== "1", "LOCAL_ONLY");
}

export function assertUrls(environment: Readonly<Record<string, string | undefined>> = process.env): void {
  try { assertSafeE2eDatabaseUrls({ DATABASE_URL: environment.DATABASE_URL, DIRECT_URL: environment.DIRECT_URL }); }
  catch { throw new SafeFailure("UNSAFE_DATABASE"); }
}

export function guardEnvironment(): void {
  delete process.env.DEBUG;
  delete process.env.PRISMA_LOG_LEVEL;
  guardEnvironmentBoundary(process.env, () => { loadEnvConfig(process.cwd(), false, { info: () => undefined, error: () => undefined }); });
  delete process.env.DEBUG;
  delete process.env.PRISMA_LOG_LEVEL;
}

export function guardEnvironmentBoundary(environment: Readonly<Record<string, string | undefined>>, load: () => void): void {
  assertOptInAndLocal(environment);
  load();
  assertOptInAndLocal(environment);
  assertUrls(environment);
}

export function poolUrl(): string {
  assertOptInAndLocal(); assertUrls();
  try {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", "1");
    url.searchParams.set("pool_timeout", "10");
    const result = url.toString();
    assertSafeE2eDatabaseUrls({ DATABASE_URL: result, DIRECT_URL: process.env.DIRECT_URL });
    return result;
  } catch { throw new SafeFailure("UNSAFE_DATABASE"); }
}

function privateCommand(command: string, args: string[]): string {
  try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }).trim(); }
  catch { throw new SafeFailure("SOURCE_IDENTITY"); }
}

export function assertNoCompetingWorkload(): void {
  let listing: string;
  try { listing = execFileSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 }); }
  catch { throw new SafeFailure("COMPETING_WORKLOAD"); }
  const rows = listing.split("\n").flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3]! }] : [];
  });
  const ancestors = new Set<number>();
  let current = process.pid;
  while (current > 0 && !ancestors.has(current)) { ancestors.add(current); current = rows.find((row) => row.pid === current)?.parent ?? 0; }
  const workload = /(?:^|[\s/])next(?:\.js)?\s+(?:dev|start)\b|(?:^|[\s/])(?:vitest|playwright)(?:\.m?js)?(?:\s|$)|(?:^|\s)(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:dev|start|test)(?:\s|$)|next-server\s/;
  requireFact(!rows.some((row) => !ancestors.has(row.pid) && workload.test(row.command)), "COMPETING_WORKLOAD");
}

export function harnessDigest(): string {
  const files = ["vitest.performance.config.ts"];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(filename);
    }
  }
  visit("tests/performance");
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(file).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}

const actualMetadataSchema = z.array(z.object({ version: z.string().regex(/^PostgreSQL 16(?:\.|\s)/), database: z.literal("yaho_e2e"), username: z.literal("yaho_e2e"), numeric_version: z.string().regex(/^16\d{4}$/) }).strict()).length(1);
const migrationRowsSchema = z.array(z.object({ migration_name: z.string(), checksum: z.string(), finished_at: z.date().nullable(), rolled_back_at: z.date().nullable(), applied_steps_count: z.number() }).strict());

export async function collectEnvironment(setup: PrismaClient): Promise<Environment> {
  assertOptInAndLocal(); assertUrls(); assertNoCompetingWorkload();
  const checkedOutSha = privateCommand("git", ["rev-parse", "HEAD"]);
  const auditedSourceSha = "3e9fef51d1ff912c055ff7e7226dfc607c601ca9";
  const protectedPaths = ["app", "components", "lib", "server", "prisma", "package.json", "package-lock.json", "vitest.config.ts", "vitest.integration.config.ts"];
  privateCommand("git", ["diff", "--exit-code", auditedSourceSha, "HEAD", "--", ...protectedPaths]);
  privateCommand("git", ["diff", "--exit-code", "HEAD", "--", ...protectedPaths]);
  const dirty = privateCommand("git", ["status", "--porcelain"]).length > 0;
  const ci = process.env.GITHUB_ACTIONS === "true";
  const prHeadSha = ci ? process.env.OBS01_PR_HEAD_SHA : undefined;
  if (ci) requireFact(/^[a-f0-9]{40}$/.test(prHeadSha ?? "") && checkedOutSha === prHeadSha, "SOURCE_IDENTITY");
  let actual: z.infer<typeof actualMetadataSchema>;
  try {
    const rows: unknown = await setup.$queryRaw`SELECT version() AS version, current_database()::text AS database, current_user::text AS username, current_setting('server_version_num') AS numeric_version`;
    const parsed = actualMetadataSchema.safeParse(rows);
    requireFact(parsed.success, "SERVER_IDENTITY"); actual = parsed.data;
  } catch (error) { if (error instanceof SafeFailure) throw error; throw new SafeFailure("DATABASE_UNAVAILABLE"); }
  let migrationRevision: string;
  try {
    const names = readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const expected = names.map((name) => ({ name, checksum: createHash("sha256").update(readFileSync(path.join("prisma/migrations", name, "migration.sql"))).digest("hex") }));
    const raw: unknown = await setup.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations"`;
    const parsed = migrationRowsSchema.safeParse(raw);
    requireFact(parsed.success && parsed.data.length === expected.length, "MIGRATIONS");
    requireFact(expected.every((entry) => parsed.data.filter((row) => row.migration_name === entry.name && row.checksum === entry.checksum && row.finished_at !== null && row.rolled_back_at === null && row.applied_steps_count > 0).length === 1), "MIGRATIONS");
    migrationRevision = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  } catch { throw new SafeFailure("MIGRATIONS"); }
  const cpus = os.cpus();
  const model = cpus[0]?.model ?? "";
  const cpuModel: Environment["cpuModel"] = /intel.*xeon/i.test(model) ? "INTEL_XEON" : /intel.*core/i.test(model) ? "INTEL_CORE" : /amd.*epyc/i.test(model) ? "AMD_EPYC" : /amd.*ryzen/i.test(model) ? "AMD_RYZEN" : /apple/i.test(model) ? "APPLE" : "OTHER";
  const hardwareNumber = cpuModel === "INTEL_XEON" ? model.match(/(?:Platinum|Gold|Silver|Bronze|CPU|Xeon)\s+(\d{3,5}[A-Z]{0,3})\b/i)?.[1]
    : cpuModel === "AMD_EPYC" ? model.match(/EPYC\s+([0-9][0-9A-Z]{2,7})\b/i)?.[1]
      : cpuModel === "AMD_RYZEN" ? model.match(/Ryzen\s+\d\s+(\d{3,5}[A-Z]{0,3})\b/i)?.[1]
        : cpuModel === "INTEL_CORE" ? model.match(/i[3579]-(\d{3,5}[A-Z]{0,3})\b/i)?.[1] : undefined;
  const cpuModelNumber = hardwareNumber?.toUpperCase() ?? "N/A";
  const version = actual[0]!.version.match(/^PostgreSQL (16(?:\.\d+)?)/)![1]!;
  const prismaCli = (JSON.parse(readFileSync("node_modules/prisma/package.json", "utf8")) as { version: string }).version;
  const prismaClient = (JSON.parse(readFileSync("node_modules/@prisma/client/package.json", "utf8")) as { version: string }).version;
  const optional = (value: string | undefined, pattern: RegExp): string => value && pattern.test(value) ? value : "N/A";
  const metadata = {
    auditedSourceSha, prHeadSha: prHeadSha ?? "N/A", checkedOutSha, checkoutMode: "HEAD", dirty, harnessDigest: harnessDigest(), route: ci ? "A2" : "LOCAL",
    ciRunId: optional(process.env.GITHUB_RUN_ID, /^\d+$/), ciAttempt: optional(process.env.GITHUB_RUN_ATTEMPT, /^\d+$/), integrationSha: optional(process.env.OBS01_INTEGRATION_SHA, /^[a-f0-9]{40}$/),
    runnerClass: ci ? "GITHUB_STANDARD" : "LOCAL", os: os.platform(), osRelease: os.release(), image: optional(process.env.ImageOS, /^ubuntu\d{2,4}$/), imageVersion: optional(process.env.ImageVersion, /^\d+(?:\.\d+){0,4}$/),
    cpuModel, cpuModelNumber, cpuCount: cpus.length, memoryGiB: os.totalmem() / 1024 ** 3, node: process.versions.node, prismaCli, prismaClient, postgres: version,
    migrationRevision, migrationVerified: true, databaseVerified: true, independentSessions: false, quota: "UNVERIFIED",
    poolCount: 3, connectionLimit: 1, poolTimeoutSeconds: 10, maxWaitMs: 10000, transactionTimeoutMs: 20000, setupClients: 1, measuredClients: 2, warmups: 5, repetitions: 30, plannedCells: 50, profileRevision: 1,
  };
  const parsed = environmentSchema.safeParse(metadata);
  requireFact(parsed.success, "SOURCE_IDENTITY");
  return parsed.data;
}
