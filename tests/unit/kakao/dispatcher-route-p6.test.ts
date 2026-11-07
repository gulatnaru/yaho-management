import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeDatabaseIdentityFingerprint } from "@/lib/e2e/preview-safety";

const fake = vi.hoisted(() => ({ identity: vi.fn(), sweep: vi.fn(), batch: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: fake.identity } }));
vi.mock("@/lib/kakao/outbox-worker", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/kakao/outbox-worker")>();
  return { ...original, recoverStaleProcessing: fake.sweep, processOutboxBatch: fake.batch };
});
import { GET } from "@/app/api/cron/kakao-notifications/route";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function setup() {
  const secret = randomBytes(32).toString("base64url");
  const identity = { database: "synthetic_db", currentUser: "synthetic_user", currentSchema: "public" };
  vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", secret);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("KAKAO_PREVIEW_PROJECT_REF", "syntheticpreview");
  vi.stubEnv("KAKAO_PRODUCTION_PROJECT_REF", "syntheticproduction");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@db.syntheticpreview.supabase.co/synthetic");
  vi.stubEnv("KAKAO_PREVIEW_DB_IDENTITY_SHA256", runtimeDatabaseIdentityFingerprint(identity, "syntheticpreview"));
  fake.identity.mockResolvedValue([identity]); fake.sweep.mockResolvedValue([]); fake.batch.mockResolvedValue({ outcomes: [], error: "guard_unavailable" });
  return new Request("http://fixture.invalid", { headers: { authorization: `Bearer ${secret}` } });
}
describe("actual manual GET with fake Prisma and worker", () => {
  it("rejects authentication and server environment before DB access", async () => {
    const request = setup();
    expect((await GET(new Request("http://fixture.invalid"))).status).toBe(403);
    expect((await GET(new Request("http://fixture.invalid", { headers: { authorization: `Bearer ${randomBytes(32).toString("base64url")}` } }))).status).toBe(403);
    vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", ""); expect((await GET(request)).status).toBe(403);
    vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", request.headers.get("authorization")!.slice(7)); vi.stubEnv("VERCEL_ENV", "production"); expect((await GET(new Request(request, { headers: { ...Object.fromEntries(request.headers), "x-vercel-env": "preview" } }))).status).toBe(403);
    vi.stubEnv("VERCEL_ENV", ""); expect((await GET(request)).status).toBe(403);
    expect(fake.identity).not.toHaveBeenCalled(); expect(fake.sweep).not.toHaveBeenCalled(); expect(fake.batch).not.toHaveBeenCalled();
  });
  it("rejects a mismatched runtime DB identity before sweep", async () => {
    const request = setup(); fake.identity.mockResolvedValue([{ database: "other", currentUser: "synthetic_user", currentSchema: "public" }]);
    expect((await GET(request)).status).toBe(503); expect(fake.sweep).not.toHaveBeenCalled(); expect(fake.batch).not.toHaveBeenCalled();
  });
  it("sweeps before a batch limited to one and supplies no unsafe provider", async () => {
    const request = setup();
    expect(await (await GET(request)).json()).toEqual({ code: "batch_failed" });
    expect(fake.sweep).toHaveBeenCalledTimes(1); expect(fake.batch).toHaveBeenCalledTimes(1);
    expect(fake.sweep.mock.invocationCallOrder[0]).toBeLessThan(fake.batch.mock.invocationCallOrder[0]);
    expect(fake.batch.mock.calls[0][1]).toMatchObject({ limit: 1, provider: null });
    expect(fake.batch.mock.calls[0][1].safe).toBeUndefined();
  });
  it("does not process a batch when sweep fails", async () => {
    const request = setup(); fake.sweep.mockRejectedValueOnce(new Error("fixture"));
    expect(await (await GET(request)).json()).toEqual({ code: "sweep_failed" }); expect(fake.batch).not.toHaveBeenCalled();
  });
  it.each([12001, 12000, 11999])("checks start budget %i", async (remaining) => {
    const request = setup(); let calls = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ++calls === 1 ? 0 : 20000 - remaining);
    await GET(request);
    expect(fake.sweep).toHaveBeenCalledTimes(remaining > 12000 ? 1 : 0);
  });
  it.each([10001, 10000, 9999])("checks post-sweep budget %i", async (remaining) => {
    const request = setup(); let calls = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ++calls < 3 ? 0 : 20000 - remaining);
    await GET(request);
    expect(fake.batch).toHaveBeenCalledTimes(remaining > 10000 ? 1 : 0);
  });
});
