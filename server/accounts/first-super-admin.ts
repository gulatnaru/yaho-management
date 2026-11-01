import { createFirstSuperAdminCore } from "./first-super-admin-core";
export { BootstrapError } from "./first-super-admin-core";
// No product endpoint or delivery adapter may enable this while the integration gate is pending.
// Only unit tests or a verified disposable local development database may enable it.
export function firstSuperAdminHarnessEnabled(): boolean {
  if (process.env.YAHO_P7_ISOLATED_HARNESS !== "1" || process.env.VERCEL_ENV) return false;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_ENV !== "development") return false;
  try {
    return [process.env.DATABASE_URL, process.env.DIRECT_URL].every(value => {
      const url = new URL(value ?? "");
      return ["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "55432" && url.pathname === "/yaho_e2e" && url.username === "yaho_e2e";
    });
  } catch { return false; }
}


export const { prepareFirstSuperAdmin, issueFirstSuperAdminToken, revokeFirstSuperAdmin, acceptFirstSuperAdmin, executeFirstSuperAdmin, getFirstSuperAdminAcceptanceState } = createFirstSuperAdminCore({ enabled: firstSuperAdminHarnessEnabled, approverId: () => process.env.YAHO_P7_APPROVER_USER_ID });
