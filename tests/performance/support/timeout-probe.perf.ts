import { writeFileSync } from "node:fs";
import { vi, type TestContext } from "vitest";
import type { Suite } from "@vitest/runner";
import { emptyCodes, requireFact, type Environment, type Report } from "./contract";
import type { Fixture, Snapshot } from "./fixtures";

// Executed only by timeoutSelfChecks in an isolated, database-free Vitest child.
// The attribution mode additionally exercises the real missing-terminal gate.
const probe = vi.hoisted(() => ({
  mode: process.env.YAHO_OBS01_TIMEOUT_PROBE,
  events: [] as string[], pending: 0, fixtures: 0, calls: 0,
  release: undefined as (() => void) | undefined,
}));

vi.mock("vitest", async (original) => {
  const actual = await original<typeof import("vitest")>();
  return {
    ...actual,
    it: ((name: string, callback: (context: TestContext) => Promise<void>) => actual.it(name, callback, name === "OBS01_FINAL" ? 1000 : 20)) as typeof actual.it,
    beforeAll: (callback: () => Promise<void>) => actual.beforeAll(callback, probe.mode === "setup" ? 20 : 1000),
    afterAll: (callback: (suite: Suite) => Promise<void>) => actual.afterAll(async (suite) => {
      if (probe.mode === "setup") {
        probe.events.push("runner-timeout");
        setImmediate(() => probe.release!());
      }
      await callback(suite);
      const report = (suite.meta as { obs01: Report }).obs01;
      if (probe.mode === "attribution") {
        requireFact(report.status === "INVALID" && report.failure === "ATTRIBUTION" && report.attributionDiagnostic?.stage === "SAMPLE" && report.attributionDiagnostic.condition === "UNPROVEN", "CALIBRATION");
        requireFact(probe.pending === 0 && probe.fixtures === 1 && probe.calls === 1 && report.cleanup === "PASS", "CALIBRATION");
        requireFact(report.rows[0]!.status === "INVALID" && report.rows.every((row) => row.attempted === 0 && row.warmups === 0) && report.rows.slice(1).every((row) => row.status === "NOT RUN"), "CALIBRATION");
        requireFact(probe.events.includes("roots-start") && probe.events.includes("roots-clean") && probe.events.filter((event) => event === "disconnect").length === 1 && probe.events.indexOf("roots-clean") < probe.events.indexOf("disconnect"), "CALIBRATION");
        writeFileSync(process.env.YAHO_OBS01_TIMEOUT_RESULT!, "PASS");
        return;
      }
      requireFact(report.status === "INCOMPLETE" && report.failure === "INCOMPLETE" && probe.pending === 0, "CALIBRATION");
      requireFact(probe.events.filter((e) => e === "disconnect").length === 1 && probe.events.indexOf("settled") < probe.events.indexOf("disconnect"), "CALIBRATION");
      if (probe.mode === "setup") {
        requireFact(probe.fixtures === 0 && probe.calls === 0 && report.cleanup === "UNKNOWN", "CALIBRATION");
      } else {
        requireFact(probe.fixtures === 1 && probe.calls === 1 && report.rows[0]!.status === "INCOMPLETE" && report.rows[0]!.warmups === 0 && report.rows.slice(1).every((r) => r.status === "NOT RUN"), "CALIBRATION");
        requireFact(probe.events.indexOf("settled") < probe.events.indexOf("fixture-clean") && probe.events.indexOf("fixture-clean") < probe.events.indexOf("roots-clean") && probe.events.indexOf("roots-clean") < probe.events.indexOf("disconnect"), "CALIBRATION");
        const cleanup = probe.mode === "cleanup-failure" ? "FAIL" : "PASS";
        requireFact(report.cleanup === cleanup && report.rows[0]!.cleanup === cleanup, "CALIBRATION");
      }
      writeFileSync(process.env.YAHO_OBS01_TIMEOUT_RESULT!, "PASS");
    }, 1000),
  };
});

vi.mock("./environment", () => ({
  guardEnvironment: () => {},
  collectEnvironment: async () => {
    if (probe.mode === "setup") {
      probe.pending++;
      await new Promise<void>((resolve) => { probe.release = resolve; });
      probe.pending--; probe.events.push("settled");
    }
    return {
      auditedSourceSha: "0".repeat(40), prHeadSha: "N/A", checkedOutSha: "0".repeat(40), checkoutMode: "HEAD", dirty: true, harnessDigest: "0".repeat(64),
      route: "LOCAL", ciRunId: "N/A", ciAttempt: "N/A", integrationSha: "N/A", runnerClass: "LOCAL", os: "linux", osRelease: "1", image: "N/A", imageVersion: "N/A",
      cpuModel: "OTHER", cpuModelNumber: "N/A", cpuCount: 1, memoryGiB: 1, node: "24", prismaCli: "6", prismaClient: "6", postgres: "N/A", migrationRevision: "0".repeat(64),
      migrationVerified: false, databaseVerified: false, independentSessions: false, quota: "UNVERIFIED", poolCount: 3, connectionLimit: 1, poolTimeoutSeconds: 10,
      maxWaitMs: 10000, transactionTimeoutMs: 20000, setupClients: 1, measuredClients: 2, warmups: 5, repetitions: 30, plannedCells: 50, profileRevision: 1,
    } satisfies Environment;
  },
}));
vi.mock("./self-checks", () => ({ selfChecks: async () => ({ count: 1, invariants: emptyCodes() }) }));
vi.mock("./fixtures", async (original) => ({
  ...await original<typeof import("./fixtures")>(),
  createRoots: async () => { probe.events.push("roots-start"); },
  cleanupRoots: async () => { requireFact(probe.pending === 0, "CALIBRATION"); probe.events.push("roots-clean"); },
  prepareFixture: async () => { probe.fixtures++; probe.events.push("fixture-start"); },
  snapshot: async (_db: unknown, f: Fixture) => ({
    apps: f.apps.map((id, i) => ({ id, quotedAmount: f.quotes[i], status: "SUBMITTED" })),
    deposits: [{ id: "deposit", amount: 100000 }], allocations: [], obligations: [], returns: [], mappings: [], items: [],
    children: [], consents: [], deviceChildren: [], devices: f.deviceIds.map((id) => ({ id })), refunds: [], payments: [], reservations: [],
  }) as unknown as Snapshot,
  cleanupFixture: async () => {
    requireFact(probe.pending === 0, "CALIBRATION"); probe.events.push("fixture-clean");
    if (probe.mode === "cleanup-failure") throw new Error("synthetic cleanup failure");
  },
}));
vi.mock("./measurement", async (original) => {
  const actual = await original<typeof import("./measurement")>();
  return {
    ...actual,
    clients: () => ({ setup: {}, measured: [0, 1].map(() => {
      if (probe.mode !== "attribution") return { counter: { bootstrapObserved: 0, drain: async () => {} } };
      let time = 0;
      const counter = new actual.EventCounter({ now: () => time, pause: async () => { time += 5; } });
      return { counter, db: { $transaction: async () => { counter.event("BEGIN"); counter.event("opaque simulated event"); return { paymentId: "synthetic", reservationIds: [] }; } } };
    }) }),
    connect: async () => true,
    calibrate: async () => [],
    disconnect: async () => { requireFact(probe.pending === 0, "CALIBRATION"); probe.events.push("disconnect"); },
    measureCore: async (...args: Parameters<typeof actual.measureCore>) => {
      if (probe.mode === "attribution") { probe.calls++; return actual.measureCore(...args); }
      probe.calls++; probe.pending++; probe.events.push("operation-start");
      await new Promise<void>((resolve) => { probe.release = resolve; });
      probe.pending--; probe.events.push("settled");
      return { fulfilled: true, outcome: "SUCCESS", queries: 1, wall: 1 };
    },
  };
});

// Release deferred work only after the real runner has reported its timeout.
// setImmediate lets the harness's finish hook close sampling before it settles.
import { afterEach } from "vitest";
afterEach(({ task }) => {
  if (task.result?.state === "fail" && probe.pending) {
    probe.events.push("runner-timeout");
    setImmediate(() => probe.release!());
  }
});
await import("../reservation-applications/obs-01.perf");
