import "server-only";
import { DatabaseManualTestPrisma, MockManualTestPrisma } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, tokenHash } from "./auth";
import { ManualTestCleanup } from "./cleanup";
import { ManualTestFlow } from "./flow";
import { requireManual } from "./errors";

export function createManualTestRuntime(auth: ManualTestAuth) {
  return { auth, flow: new ManualTestFlow(auth), cleanup: new ManualTestCleanup(auth) };
}
let cached: { key: string; value: ReturnType<typeof createManualTestRuntime> } | undefined;

/** Opt-in mock singleton. Auth.js bootstrap verifies identity; mock operations stay in memory. */
export function getManualTestRuntime() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const deploymentEnv = process.env.VERCEL_ENV;
  requireManual(process.env.MANUAL_TEST_ENABLED === "true" && deploymentEnv !== "production", "MOCK_RUNTIME_DISABLED", 503);
  const databaseUrl = process.env.MANUAL_TEST_DATABASE_URL;
  requireManual(databaseUrl !== undefined || nodeEnv === "test", "MOCK_RUNTIME_DISABLED", 503);
  const origin = process.env.MANUAL_TEST_MOCK_ORIGIN;
  const syntheticBootstrapSecret = process.env.MANUAL_TEST_MOCK_BOOTSTRAP_SECRET;
  requireManual(origin, "MOCK_RUNTIME_DISABLED", 503);
  const key = tokenHash("mock-config", JSON.stringify([databaseUrl, origin, syntheticBootstrapSecret, nodeEnv, deploymentEnv]));
  if (cached?.key !== key) {
    const db = databaseUrl !== undefined ? new DatabaseManualTestPrisma(databaseUrl) : new MockManualTestPrisma();
    const auth = new ManualTestAuth(db, { enabled: true, nodeEnv, deploymentEnv, origin, syntheticBootstrapSecret });
    const previous = cached;
    cached = { key, value: createManualTestRuntime(auth) };
    void previous?.value.auth.db.$disconnect?.().catch(() => undefined);
  }
  cached.value.auth.assertRuntime();
  return cached.value;
}
