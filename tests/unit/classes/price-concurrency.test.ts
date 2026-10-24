import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), operational: vi.fn(), find: vi.fn(), update: vi.fn(), transaction: vi.fn(), teachers: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin, requireOperationalPrincipal: mocks.operational }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT"); } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { classSchedule: { findUnique: mocks.find, updateMany: mocks.update }, $transaction: mocks.transaction } }));
const { updateClass, saveApplicationPrice } = await import("@/app/(admin)/classes/actions");
const loadedRevision = "2026-10-20T00:00:00.000Z";
let stored: { applicationPrice: number | null; updatedAt: Date; status: "SCHEDULED"; startsAt: Date; endsAt: Date; location: string; capacity: number };
function form(price = "40000", baseline = "40000", revision = loadedRevision) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ programId: "program", date: "2099-01-01", startTime: "09:00", endTime: "11:00", location: "new location", capacity: "8", teacherIds: "teacher", applicationPrice: price, applicationPriceBaseline: baseline, applicationPriceRevision: revision })) data.set(key, value);
  return data;
}
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ userId: "admin", role: "ADMIN" }); mocks.operational.mockResolvedValue({ userId: "admin", role: "ADMIN" });
  stored = { applicationPrice: 40000, updatedAt: new Date(loadedRevision), status: "SCHEDULED", startsAt: new Date("2099-01-01"), endsAt: new Date("2099-01-02"), location: "old location", capacity: 8 };
  mocks.find.mockImplementation(async () => ({ ...stored }));
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (where.updatedAt && where.updatedAt.getTime() !== stored.updatedAt.getTime()) return { count: 0 };
    Object.assign(stored, data); return { count: 1 };
  });
  mocks.teachers.mockResolvedValue([{ teacherId: "teacher" }]);
  mocks.transaction.mockImplementation(async (callback) => {
    const before = structuredClone(stored);
    try { return await callback({ $queryRaw: async () => [{ id: "class" }], classSchedule: { findUnique: mocks.find, updateMany: mocks.update }, program: { findUnique: async () => ({ status: "ACTIVE" }) }, teacher: { count: async () => 1 }, classTeacher: { findMany: mocks.teachers, createMany: vi.fn(), deleteMany: vi.fn() } }); }
    catch (error) { stored = before; throw error; }
  });
});
it("A's full form loaded at 40000 preserves B's inline 50000 while saving location", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(loadedRevision));
  const a = form();
  expect((await saveApplicationPrice({ classScheduleId: "class", revision: loadedRevision, applicationPrice: 50000 })).error).toBeUndefined();
  await expect(updateClass("class", {}, a)).rejects.toThrow("REDIRECT");
  expect(stored).toMatchObject({ applicationPrice: 50000, location: "new location", capacity: 8 });
  expect(mocks.update.mock.calls[1]![0].data).not.toHaveProperty("applicationPrice");
  expect(stored.updatedAt.getTime()).toBe(Date.parse(loadedRevision) + 2);
  expect(mocks.teachers).toHaveBeenCalledOnce();
  expect((await saveApplicationPrice({ classScheduleId: "class", revision: loadedRevision, applicationPrice: 60000 })).error).toContain("다른 관리자가");
  vi.useRealTimers();
});
it("rejects A's deliberate stale price change atomically and preserves loaded retry baseline", async () => {
  await saveApplicationPrice({ classScheduleId: "class", revision: loadedRevision, applicationPrice: 50000 });
  const result = await updateClass("class", {}, form("45000"));
  expect(result.formError).toContain("다른 관리자가"); expect(result.values).toMatchObject({ applicationPrice: "45000", applicationPriceBaseline: "40000", applicationPriceRevision: loadedRevision });
  expect(stored).toMatchObject({ applicationPrice: 50000, location: "old location" }); expect(mocks.teachers).not.toHaveBeenCalled();
});
it.each(["60000", ""])("full edit deliberately writes %s through the same CAS and then rejects a stale inline save", async (price) => {
  await expect(updateClass("class", {}, form(price))).rejects.toThrow("REDIRECT");
  expect(stored.applicationPrice).toBe(price ? 60000 : null);
  expect(mocks.update.mock.calls[0]![0].where.updatedAt).toEqual(new Date(loadedRevision));
  expect(mocks.update.mock.calls[1]![0].data.updatedAt).toEqual(stored.updatedAt);
  expect((await saveApplicationPrice({ classScheduleId: "class", revision: loadedRevision, applicationPrice: 50000 })).error).toContain("다른 관리자가");
});
it("never writes an unversioned full-form price", async () => {
  const data = form("60000"); data.delete("applicationPriceRevision");
  expect((await updateClass("class", {}, data)).formError).toBeTruthy(); expect(mocks.update).not.toHaveBeenCalled();
});
