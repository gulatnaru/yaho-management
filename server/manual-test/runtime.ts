import { MockManualTestPrisma } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, tokenHash } from "./auth";
import { ManualTestCleanup } from "./cleanup";
import { ManualTestFlow } from "./flow";
import { requireManual } from "./errors";

export function createManualTestRuntime(auth: ManualTestAuth) {
  return { auth, flow: new ManualTestFlow(auth), cleanup: new ManualTestCleanup(auth) };
}
let cached: { key: string; value: ReturnType<typeof createManualTestRuntime> } | undefined;

/** Opt-in mock singleton for local/test and Preview deployments; no database or network capability. */
export function getManualTestRuntime() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const deploymentEnv = process.env.VERCEL_ENV;
  requireManual(process.env.MANUAL_TEST_ENABLED === "true" && deploymentEnv !== "production", "MOCK_RUNTIME_DISABLED", 503);
  const origin = process.env.MANUAL_TEST_MOCK_ORIGIN;
  const syntheticBootstrapSecret = process.env.MANUAL_TEST_MOCK_BOOTSTRAP_SECRET;
  requireManual(origin && syntheticBootstrapSecret, "MOCK_RUNTIME_DISABLED", 503);
  const key = tokenHash("mock-config", JSON.stringify([origin, syntheticBootstrapSecret, nodeEnv, deploymentEnv]));
  if (cached?.key !== key) {
    const auth = new ManualTestAuth(new MockManualTestPrisma(), { enabled: true, nodeEnv, deploymentEnv, origin, syntheticBootstrapSecret });
    cached = { key, value: createManualTestRuntime(auth) };
  }
  cached.value.auth.assertRuntime();
  return cached.value;
}
