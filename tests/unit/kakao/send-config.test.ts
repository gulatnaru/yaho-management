import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { evaluateSendGate, readSendConfig, verifySyntheticDispatchIdentity } from "@/lib/kakao/send-config";

const config = { mode: "live", enabled: true, provider: "solapi", environment: "preview" };
const runtime = { blocked: false, environment: "preview", provider: "solapi", activationEpoch: new Date("2026-10-28T00:00:00Z") };
const policy = { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null };
const input = { config, runtime, policy, occurredAt: new Date("2026-10-28T00:00:00Z") };
const identity = { environment: "preview", app: "g2-kakao-app", db: "g2-kakao-db", run: "g2-kakao-run" };
describe("synthetic send gate", () => {
  it("defaults to dry-run and disabled, and permits only an explicit mock candidate", () => {
    expect(readSendConfig({ provider: "solapi", environment: "preview" })).toEqual({ ...config, mode: "dry-run", enabled: false });
    expect(evaluateSendGate(input).allowed).toBe(true);
  });
  it.each([
    { config: {} }, { config: { ...config, mode: "liv" } }, { config: { ...config, enabled: "true" } },
    { config: { isProviderConfigured: true, key: "synthetic" } }, { config: { ...config, environment: "production" } },
    { config: { ...config, extra: true } }, { runtime: null }, { runtime: { ...runtime, blocked: true } },
    { runtime: { ...runtime, activationEpoch: new Date("invalid") } }, { occurredAt: new Date("2026-10-27T23:59:59Z") },
    { policy: { ...policy, otherEnvironmentActive: true } }, { policy: { ...policy, activeEnvironment: "production" } },
    { policy: { ...policy, activeEnvironment: undefined } }, { policy: { ...policy, otherEnvironmentActive: undefined } },
    { policy: { ...policy, arrangement: "shared" } }, { policy: { ...policy, previewAllocation: 1 } },
    { policy: { ...policy, productionAllocation: 0 } }, { policy: { ...policy, verified: true } },
  ])("fails closed: %s", (change) => { expect(evaluateSendGate({ ...input, ...change }).allowed).toBe(false); });
});
describe("D-07 authentication and identity order", () => {
  it("reads minimal DB identity only after successful authentication and matching targets", async () => {
    const bearer = randomBytes(32).toString("base64url"); const readDbIdentity = vi.fn(async () => "g2-kakao-db");
    const request = { authorization: `Bearer ${bearer}`, expectedBearer: bearer, queryCredential: undefined, runner: identity, app: identity, readDbIdentity };
    expect(await verifySyntheticDispatchIdentity(request)).toBe(true);
    expect(readDbIdentity).toHaveBeenCalledTimes(1);
    for (const change of [{ authorization: undefined }, { authorization: `bearer ${bearer}` }, { authorization: `Bearer ${randomBytes(32).toString("base64url")}` }, { expectedBearer: undefined }, { queryCredential: "x" }, { runner: { ...identity, environment: "production" } }, { app: { ...identity, run: "wrong" } }]) {
      readDbIdentity.mockClear(); expect(await verifySyntheticDispatchIdentity({ ...request, ...change })).toBe(false); expect(readDbIdentity).not.toHaveBeenCalled();
    }
    readDbIdentity.mockResolvedValueOnce("other"); expect(await verifySyntheticDispatchIdentity(request)).toBe(false);
    readDbIdentity.mockRejectedValueOnce(new Error("redacted")); expect(await verifySyntheticDispatchIdentity(request)).toBe(false);
  });
});
