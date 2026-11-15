import { randomBytes, randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// This separate harness never accepts Preview or any remote database.
if (process.env.AI_SERVICE_LOCAL_E2E_APPROVED !== "1" || process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("QC2_LOCAL_ONLY");
for (const value of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    let url: URL;
    try { url = new URL(value ?? ""); } catch { throw new Error("QC2_LOCAL_DATABASE_DENIED"); }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55435" || url.pathname !== "/yaho_e2e" || decodeURIComponent(url.username) !== "yaho_e2e") throw new Error("QC2_LOCAL_DATABASE_DENIED");
}
// Playwright reloads this config in worker processes. Reuse the per-run values
// there without setting VERCEL_ENV in the runner, which must remain local-only.
const runValues = process.env.QC2_LOCAL_RUN_VALUES
    ? JSON.parse(process.env.QC2_LOCAL_RUN_VALUES) as Record<string, string>
    : {
        AI_SERVICE_SYNTHETIC_RUN_ID: `scope-${randomUUID()}`,
        AI_SERVICE_SYNTHETIC_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
        AI_SERVICE_SKILL_SECRET: randomBytes(32).toString("hex"),
        AI_SERVICE_SKILL_TEST_SECRET: randomBytes(32).toString("hex"),
        AI_SERVICE_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
        AI_SERVICE_HMAC_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
        AUTH_SECRET: randomBytes(32).toString("hex"),
    };
process.env.QC2_LOCAL_RUN_VALUES = JSON.stringify(runValues);
const env = {
    ...process.env,
    ...runValues,
    AI_SERVICE_ADMIN_ENABLED: "true",
    AI_SERVICE_SYNTHETIC_ENABLED: "true",
    AI_SERVICE_BOT_ID: "synthetic-bot",
    AI_SERVICE_ENCRYPTION_ACTIVE: "v1",
    AI_SERVICE_HMAC_ACTIVE: "v1",
    AUTH_TRUST_HOST: "true",
};
// Worker and owned web server need identical synthetic run configuration.
Object.assign(process.env, env);
export default defineConfig({
    testDir: "./tests/qc2-local",
    workers: 1,
    use: { baseURL: "http://127.0.0.1:3217", ...devices["Desktop Chrome"] },
});
