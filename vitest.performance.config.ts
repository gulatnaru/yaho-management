import path from "node:path";
import { writeSync } from "node:fs";
import type { UserConfig } from "vitest/config";
import { guardEnvironment } from "./tests/performance/support/environment";
import { failureCode } from "./tests/performance/support/contract";

try { guardEnvironment(); }
catch (error) { writeSync(1, `OBS01 failure=${failureCode(error)} clients_constructed=0 fixture_writes=0\n`); process.exit(1); }

export default {
  resolve: { alias: { "server-only": path.resolve(__dirname, "tests/unit/manual-test/server-only.ts"), "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["tests/performance/reservation-applications/obs-01.perf.ts"], environment: "node", globals: false,
    minWorkers: 1, maxWorkers: 1, fileParallelism: false, sequence: { concurrent: false, shuffle: false }, retry: 0,
    testTimeout: 1_200_000, hookTimeout: 120_000, coverage: { enabled: false }, silent: true, onConsoleLog: () => false,
    reporters: [path.resolve(__dirname, "tests/performance/support/sanitized-reporter.ts")],
  },
} satisfies UserConfig;
