import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const configSchema = z.object({ mode: z.enum(["dry-run", "live"]), enabled: z.boolean(), provider: z.literal("solapi"), environment: z.literal("preview") }).strict();
export type SendConfig = z.infer<typeof configSchema>;
// No environment or secret is read implicitly; malformed input is never enabled.
export function readSendConfig(input: unknown): SendConfig | null {
  const parsed = configSchema.extend({ mode: configSchema.shape.mode.default("dry-run"), enabled: z.boolean().default(false) }).safeParse(input);
  return parsed.success ? parsed.data : null;
}
const runtimeSchema = z.object({ blocked: z.literal(false), environment: z.literal("preview"), provider: z.literal("solapi"), activationEpoch: z.date() }).strict();
export function isValidSendRuntime(input: unknown): boolean { return runtimeSchema.safeParse(input).success; }
const policySchema = z.object({ mode: z.literal("single_synthetic_only"), activeEnvironment: z.literal("preview"), otherEnvironmentActive: z.literal(false), arrangement: z.literal("unresolved"), previewAllocation: z.null(), productionAllocation: z.null() }).strict();
export const realPolicySchema = z.object({ mode: z.literal("single_real_preview"), activeEnvironment: z.literal("preview"), otherEnvironmentActive: z.literal(false), arrangement: z.literal("resolved"), previewAllocation: z.object({ dayRequestMax: z.literal(20), monthRequestMax: z.literal(200), monthMessageMilliKrw: z.literal(3_000_000), monthTotalMilliKrw: z.literal(5_000_000) }).strict(), productionAllocation: z.null() }).strict();
export const REAL_POLICY: z.infer<typeof realPolicySchema> = { mode: "single_real_preview", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "resolved", previewAllocation: { dayRequestMax: 20, monthRequestMax: 200, monthMessageMilliKrw: 3_000_000, monthTotalMilliKrw: 5_000_000 }, productionAllocation: null };
export function evaluateSendGate(input: { config: unknown; runtime: unknown; policy: unknown; occurredAt: unknown }): { allowed: boolean; reason: "allowed" | "send_disabled" | "before_activation" | "blocked" | "invalid_config" } {
  const config = configSchema.safeParse(input.config);
  const runtime = runtimeSchema.safeParse(input.runtime);
  const policyValid = policySchema.safeParse(input.policy).success || realPolicySchema.safeParse(input.policy).success;
  if (!config.success || !policyValid) return { allowed: false, reason: "invalid_config" };
  if (typeof input.runtime === "object" && input.runtime !== null && "blocked" in input.runtime && input.runtime.blocked === true) return { allowed: false, reason: "blocked" };
  if (!runtime.success) return { allowed: false, reason: "invalid_config" };
  if (config.data.mode !== "live" || !config.data.enabled) return { allowed: false, reason: "send_disabled" };
  const occurredAt = z.date().safeParse(input.occurredAt);
  if (!occurredAt.success || occurredAt.data < runtime.data.activationEpoch) return { allowed: false, reason: "before_activation" };
  return { allowed: true, reason: "allowed" }; // mock candidate or single real preview, never an external send permit
}
const identitySchema = z.object({ environment: z.literal("preview"), app: z.literal("g2-kakao-app"), db: z.literal("g2-kakao-db"), run: z.literal("g2-kakao-run") }).strict();
export async function verifySyntheticDispatchIdentity(input: { authorization: unknown; expectedBearer: unknown; queryCredential: unknown; runner: unknown; app: unknown; readDbIdentity: () => Promise<unknown> }): Promise<boolean> {
  if (input.queryCredential !== undefined || typeof input.authorization !== "string" || typeof input.expectedBearer !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.expectedBearer) || !/^Bearer [A-Za-z0-9_-]{43}$/.test(input.authorization)) return false;
  const expected = Buffer.from(input.expectedBearer); const actual = Buffer.from(input.authorization.slice(7));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  const runner = identitySchema.safeParse(input.runner); const app = identitySchema.safeParse(input.app);
  if (!runner.success || !app.success) return false;
  try { return (await input.readDbIdentity()) === "g2-kakao-db"; } catch { return false; }
}

// Explicit, fully validated OFF only; malformed configuration remains fail-closed.
export function isExplicitSendDisabled(config: unknown, policy: unknown): boolean {
  const parsed = configSchema.safeParse(config);
  const policyValid = policySchema.safeParse(policy).success || realPolicySchema.safeParse(policy).success;
  return parsed.success && policyValid && (parsed.data.mode === "dry-run" || !parsed.data.enabled);
}
