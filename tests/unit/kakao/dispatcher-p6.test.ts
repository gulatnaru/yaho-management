import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { createSyntheticDispatchHandler, dispatchSyntheticOnce } from "@/server/kakao/dispatcher";
import { GET } from "@/app/api/cron/kakao-notifications/route";
import { createP5Fixture, p5At } from "./p5-fixture";

const identity = { environment: "preview", app: "g2-kakao-app", db: "g2-kakao-db", run: "g2-kakao-run" };
async function setup() {
  const bearer = randomBytes(32).toString("base64url");
  const fixture = await createP5Fixture({ code: "S_UNKNOWN" });
  const readDbIdentity = vi.fn(async () => "g2-kakao-db");
  const deps = { ...fixture, expectedBearer: bearer, runner: identity, app: identity, readDbIdentity, clock: () => 0, deadline: 20000, now: () => p5At };
  const request = new Request("http://fixture.invalid", { headers: { authorization: `Bearer ${bearer}` } });
  return { ...fixture, deps, request };
}

describe("synthetic dispatcher", () => {
  it("keeps the deployment route closed when real identity is unavailable", async () => {
    const response = await GET(new Request("http://fixture.invalid"));
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("routes an authenticated synthetic request to the safe worker with a limited response", async () => {
    const { deps, request } = await setup();
    const response = await createSyntheticDispatchHandler(deps)(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: "ok", processed: 1 });
  });
  it("does not reflect exceptions in the synthetic route response", async () => {
    const { deps, request } = await setup();
    const response = await createSyntheticDispatchHandler({ ...deps, readDbIdentity: async () => { throw new Error("sensitive fixture"); } })(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "unauthorized" });
  });
  it("rejects invalid authorization or targets before DB or store access", async () => {
    const { deps, request, store } = await setup();
    const sweep = vi.spyOn(store, "recoverStale"); const claim = vi.spyOn(store, "claimDue");
    for (const [req, change] of [
      [new Request("http://fixture.invalid"), {}],
      [new Request("http://fixture.invalid", { headers: { authorization: `Bearer ${randomBytes(32).toString("base64url")}` } }), {}],
      [request, { expectedBearer: undefined }],
      [request, { runner: { ...identity, environment: "production" } }],
      [request, { runner: { ...identity, environment: "unknown" } }],
      [new Request("http://fixture.invalid", { headers: { authorization: request.headers.get("authorization")!, "x-vercel-env": "preview" } }), { runner: { ...identity, environment: "production" } }],
      [request, { app: { ...identity, run: "other" } }],
      [new Request("http://fixture.invalid/?credential=x", { headers: request.headers }), {}],
    ] as const) {
      expect(await dispatchSyntheticOnce(req, { ...deps, ...change })).toEqual({ code: "unauthorized" });
    }
    expect(deps.readDbIdentity).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
  });
  it("stops before sweep and claim for a mismatched DB", async () => {
    const { deps, request, store } = await setup();
    const sweep = vi.spyOn(store, "recoverStale"); const claim = vi.spyOn(store, "claimDue");
    expect(await dispatchSyntheticOnce(request, { ...deps, readDbIdentity: async () => "other" })).toEqual({ code: "unauthorized" });
    expect(sweep).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
  });
  it.each([12001, 12000, 11999])("checks starting budget %i", async (remaining) => {
    const { deps, request, store } = await setup();
    const sweep = vi.spyOn(store, "recoverStale");
    await dispatchSyntheticOnce(request, { ...deps, deadline: remaining });
    expect(sweep).toHaveBeenCalledTimes(remaining > 12000 ? 1 : 0);
  });
  it("rejects a budget larger than the synthetic contract", async () => {
    const { deps, request, store } = await setup();
    const sweep = vi.spyOn(store, "recoverStale");
    expect(await dispatchSyntheticOnce(request, { ...deps, deadline: 20001 })).toEqual({ code: "budget" });
    expect(sweep).not.toHaveBeenCalled();
  });
  it.each([10001, 10000, 9999])("checks post-sweep budget %i", async (remaining) => {
    const { deps, request, store } = await setup();
    const claim = vi.spyOn(store, "claimDue"); let reads = 0;
    await dispatchSyntheticOnce(request, { ...deps, clock: () => ++reads === 1 ? 0 : 20000 - remaining });
    expect(claim).toHaveBeenCalledTimes(remaining > 10000 ? 1 : 0);
  });
  it("stops after a failed sweep without claiming", async () => {
    const { deps, request, store } = await setup();
    vi.spyOn(store, "recoverStale").mockRejectedValueOnce(new Error("sensitive fixture"));
    const claim = vi.spyOn(store, "claimDue");
    expect(await dispatchSyntheticOnce(request, deps)).toEqual({ code: "sweep_failed" });
    expect(claim).not.toHaveBeenCalled();
  });
  it("rechecks after preparation and returns an unissued fenced claim to pending", async () => {
    const { deps, request, store, input, repository } = await setup();
    let reads = 0;
    const send = vi.spyOn(MockProvider.prototype, "send");
    try {
      await dispatchSyntheticOnce(request, { ...deps, clock: () => ++reads < 3 ? 0 : 10000 });
      expect(send.mock.calls.length).toBe(0);
      expect((await repository.snapshot()).slots).toHaveLength(0);
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "pending", claimToken: null, leaseExpiresAt: null });
    } finally { send.mockRestore(); }
  });
  it("preserves an issued reservation as unknown when the budget expires", async () => {
    const { deps, request, store, input, repository } = await setup();
    let reads = 0;
    const send = vi.spyOn(MockProvider.prototype, "send");
    try {
      await dispatchSyntheticOnce(request, { ...deps, clock: () => ++reads < 4 ? 0 : 10000 });
      expect(send.mock.calls.length).toBe(0);
      expect((await repository.snapshot()).slots).toMatchObject([{ status: "unknown", reserved: 15000 }]);
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null });
    } finally { send.mockRestore(); }
  });
  it("does not release a claim with an incorrect fencing token", async () => {
    const { store, input } = await setup();
    const [claim] = await store.claimDue(1, p5At);
    await expect(store.releaseUnissued(claim.id, "stale", p5At)).rejects.toThrow();
    const saved = await store.findByDedupeKey(input.dedupeKey);
    expect(saved?.status).toBe("processing"); expect(saved?.claimToken === claim.claimToken).toBe(true);
  });
  it("runs only one safe worker under simultaneous calls", async () => {
    const { deps, request, repository } = await setup();
    const send = vi.spyOn(MockProvider.prototype, "send");
    try {
      await Promise.all([dispatchSyntheticOnce(request, deps), dispatchSyntheticOnce(request, deps)]);
      expect(send.mock.calls.length).toBe(1); expect((await repository.snapshot()).slots).toHaveLength(1);
    } finally { send.mockRestore(); }
  });
});
