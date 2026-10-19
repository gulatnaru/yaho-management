import { getOptionalOperationalPrincipal } from "@/lib/auth/authorization";

export type PreviewApplyAccess = { allowed: boolean; operatorSession: boolean };

export const MANUAL_TEST_RUN_ID_PATTERN = /^manual-[A-Za-z0-9_-]{22}$/;

export function isManualTestRunId(value: unknown): value is string {
  return typeof value === "string" && MANUAL_TEST_RUN_ID_PATTERN.test(value);
}

export async function hasOperatorPreviewTestSession(): Promise<boolean> {
  if (process.env.VERCEL_ENV !== "preview") return false;
  try {
    return (await getOptionalOperationalPrincipal()) !== null;
  } catch {
    return false;
  }
}

export async function resolvePreviewApplyAccess(
  hasLease: boolean,
  syntheticRunId: string | null,
): Promise<PreviewApplyAccess> {
  if (process.env.VERCEL_ENV !== "preview") return { allowed: true, operatorSession: false };
  if (hasLease) return { allowed: true, operatorSession: false };
  // Operator sessions are honored only for admin-marked manual test groups,
  // so automated E2E preview-* groups and ordinary groups stay lease-only.
  if (!isManualTestRunId(syntheticRunId)) return { allowed: false, operatorSession: false };
  const operator = await hasOperatorPreviewTestSession();
  return { allowed: operator, operatorSession: operator };
}
