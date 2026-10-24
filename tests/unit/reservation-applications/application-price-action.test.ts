import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin, requireOperationalPrincipal: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { classSchedule: { updateMany: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const { saveApplicationPrice } = await import("@/app/(admin)/classes/actions");
const revision = "2026-10-20T00:00:00.000Z";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ userId: "admin", role: "ADMIN" }); mocks.update.mockResolvedValue({ count: 1 }); });
describe("narrow ADMIN price CAS", () => {
  it.each(["MANAGER", "TEACHER"])("blocks %s before any DB writes", async (role) => {
    mocks.admin.mockRejectedValue(new Error(`${role}_DENIED`));
    await expect(saveApplicationPrice({ classScheduleId: "class", revision, applicationPrice: 20000 })).rejects.toThrow("DENIED");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates only explicit price and monotonically advancing revision, preserving teachers/capacity/status and past applications/payments", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(revision));
    try {
      expect(await saveApplicationPrice({ classScheduleId: "class", revision, applicationPrice: 20000 })).toEqual({ revision: "2026-10-20T00:00:00.001Z" });
      const request = mocks.update.mock.calls[0]![0];
      expect(Object.keys(request.data).sort()).toEqual(["applicationPrice", "updatedAt"]);
      expect(request.data.updatedAt.getTime()).toBe(Date.parse(revision) + 1);
      expect(request.where).toEqual({ id: "class", updatedAt: new Date(revision), status: "SCHEDULED", startsAt: { gt: new Date(revision) } });
      expect(mocks.revalidate).toHaveBeenCalledWith("/classes/class");
    } finally { vi.useRealTimers(); }
  });
  it.each([null, 0, -1, 1.2, 2147483648])("rejects invalid amount %s without default-price fallback", async (applicationPrice) => {
    expect((await saveApplicationPrice({ classScheduleId: "class", revision, applicationPrice })).error).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects extra class fields rather than overwriting a stale teacher/capacity/status", async () => {
    expect((await saveApplicationPrice({ classScheduleId: "class", revision, applicationPrice: 10000, capacity: 99 })).error).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects a stale revision and does not advertise success", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await saveApplicationPrice({ classScheduleId: "class", revision, applicationPrice: 10000 })).error).toContain("다른 관리자가");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
