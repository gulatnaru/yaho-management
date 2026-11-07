import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { createP5Fixture, p5At } from "./p5-fixture";
import type { SyntheticDependencies } from "@/server/kakao/dispatcher";

const source = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/server/kakao/dispatch-test-source", () => ({ getSyntheticTestDependencies: source.get }));
import { GET } from "@/app/api/cron/kakao-notifications/route";

const identity = { environment: "preview", app: "g2-kakao-app", db: "g2-kakao-db", run: "g2-kakao-run" };
async function setup(mock: unknown = { code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` }) {
  const bearer = randomBytes(32).toString("base64url");
  const fixture = await createP5Fixture(mock);
  const deps: SyntheticDependencies = { ...fixture, expectedBearer: bearer, runner: identity, app: identity, readDbIdentity: vi.fn(async () => "g2-kakao-db"), clock: () => 0, deadline: 20000, now: () => p5At };
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", bearer);
  source.get.mockReturnValue(deps);
  const request = () => new Request("http://fixture.invalid", { headers: { authorization: `Bearer ${bearer}` } });
  return { ...fixture, deps, request };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); source.get.mockReset(); });

describe("route synthetic integration", () => {
  it("commits permit, cost and audit before the only mock send and marks a valid ref sent", async () => {
    const { repository, store, input, request } = await setup();
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const original = MockProvider.prototype.send;
    const send = vi.spyOn(MockProvider.prototype, "send").mockImplementation(async function (this: MockProvider, permit) {
      const state = await repository.snapshot();
      expect(state.slots).toMatchObject([{ status: "in_flight", reserved: 15000 }]);
      expect(state.dispatches).toMatchObject([{ state: "in_flight", slotCount: 1 }]);
      expect(state.audits.some((a) => a.eventType === "permit_issued")).toBe(true);
      return original.call(this, permit);
    });
    expect(await (await GET(request())).json()).toEqual({ code: "ok", processed: 1 });
    expect(send).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "sent", providerRef: `g2ref_${"a".repeat(32)}` });
  });
  it("does not mark invalid ref sent or resend unknown", async () => {
    const { request, store, input } = await setup({ code: "S_ACCEPTED", ref: "bad" });
    const send = vi.spyOn(MockProvider.prototype, "send");
    await GET(request()); await GET(request());
    expect(send).toHaveBeenCalledOnce();
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown" });
  });
  it("rejects authentication and server environment before touching source or store", async () => {
    const { request, store } = await setup(); const sweep = vi.spyOn(store, "recoverStale");
    expect((await GET(new Request("http://fixture.invalid"))).status).toBe(403);
    vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", ""); expect((await GET(request())).status).toBe(403);
    vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", request().headers.get("authorization")!.slice(7));
    for (const env of ["production", "", "development"]) { vi.stubEnv("VERCEL_ENV", env); expect((await GET(new Request("http://fixture.invalid", { headers: { authorization: request().headers.get("authorization")!, "x-vercel-env": "preview" } }))).status).toBe(403); }
    expect(source.get).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
  });
  it("rejects DB identity mismatch before sweep, claim or send", async () => {
    const { deps, request, store } = await setup(); deps.readDbIdentity = async () => "other";
    const sweep = vi.spyOn(store, "recoverStale"), claim = vi.spyOn(store, "claimDue"), send = vi.spyOn(MockProvider.prototype, "send");
    expect((await GET(request())).status).toBe(403); expect(sweep).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it.each(["missing-key", "key-version", "ciphertext-version", "missing-config", "off", "blocked", "revoked"])("does not send for %s", async (kind) => {
    const { deps, repository, request } = await setup();
    if (kind === "blocked") await repository.transaction(async (s) => { s.runtime!.blocked = true; });
    if (kind === "revoked") await repository.transaction(async (s) => { (s.recipients[0].registration as { state: string }).state = "revoked"; });
    if (kind === "ciphertext-version") await repository.transaction(async (s) => { (s.recipients[0].registration as { ciphertext: { keyVersion: string } }).ciphertext.keyVersion = "other"; });
    const prepare = deps.safe.prepare;
    deps.safe = { ...deps.safe, prepare: async (row) => {
      const value = await prepare(row);
      if (kind === "missing-key") return { ...value, syntheticKey: undefined };
      if (kind === "key-version") return { ...value, syntheticKey: { ...value.syntheticKey!, keyVersion: "other" } };
      if (kind === "missing-config") return { ...value, config: undefined };
      if (kind === "off") return { ...value, config: { ...value.config as object, enabled: false } };
      return value;
    } };
    const send = vi.spyOn(MockProvider.prototype, "send"); await GET(request());
    expect(send).not.toHaveBeenCalled(); expect((await repository.snapshot()).slots).toHaveLength(0);
  });
  it("blocks sweep failure and inadequate time before a permit", async () => {
    const { deps, request, store, repository } = await setup();
    const claim = vi.spyOn(store, "claimDue"); vi.spyOn(store, "recoverStale").mockRejectedValueOnce(new Error());
    expect(await (await GET(request())).json()).toEqual({ code: "sweep_failed" }); expect(claim).not.toHaveBeenCalled();
    deps.clock = () => 10000; deps.deadline = 20000;
    expect(await (await GET(request())).json()).toEqual({ code: "budget" });
    expect((await repository.snapshot()).slots).toHaveLength(0);
  });
  it("fences concurrent calls to one send and rejects HTTP fixture injection", async () => {
    const { request, repository } = await setup(); const send = vi.spyOn(MockProvider.prototype, "send");
    const forged = new Request("http://fixture.invalid/?key=synthetic", { headers: { authorization: request().headers.get("authorization")!, "x-test-config": "enabled" } });
    expect((await GET(forged)).status).toBe(403);
    await Promise.all([GET(request()), GET(request())]);
    expect(send).toHaveBeenCalledOnce(); expect((await repository.snapshot()).slots).toHaveLength(1);
  });
  it("cannot enable an OFF configuration through request headers", async () => {
    const { deps, request, repository } = await setup(); const prepare = deps.safe.prepare;
    deps.safe = { ...deps.safe, prepare: async (row) => ({ ...await prepare(row), config: { mode: "live", enabled: false, provider: "solapi", environment: "preview" } }) };
    const send = vi.spyOn(MockProvider.prototype, "send");
    const forged = new Request("http://fixture.invalid", { headers: { authorization: request().headers.get("authorization")!, "x-test-config": "enabled", "x-test-key": "synthetic" } });
    await GET(forged); expect(send).not.toHaveBeenCalled(); expect((await repository.snapshot()).slots).toHaveLength(0);
  });
});
