import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
let principalRole: "ADMIN" | "MANAGER" | "TEACHER" = "ADMIN";
const groupLookupMock = vi.fn();
const groupUpdateManyMock = vi.fn();
const settingsLookupMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdminPrincipal: (...args: unknown[]) => requireAdminMock(...args),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservationApplicationGroup: {
      findUnique: (...args: unknown[]) => groupLookupMock(...args),
      updateMany: (...args: unknown[]) => groupUpdateManyMock(...args),
    },
    reservationApplicationSettings: { findUnique: (...args: unknown[]) => settingsLookupMock(...args) },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { markGroupManualTestSession } = await import("@/app/(admin)/reservation-applications/actions");

const settings = {
  bankName: "Synthetic bank", accountNumber: "000-000", accountHolder: "Synthetic holder",
  blogUrl: "https://blog.example.test", instagramUrl: "https://instagram.example.test", kakaoChannelUrl: "https://channel.example.test",
};

describe("markGroupManualTestSession", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    principalRole = "ADMIN";
    requireAdminMock.mockReset().mockImplementation(() => {
      if (principalRole !== "ADMIN") throw new Error("NOT_FOUND");
      return { userId: "admin-1", role: principalRole };
    });
    groupLookupMock.mockReset().mockResolvedValue({ id: "group-1", syntheticRunId: null, isActive: true });
    groupUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    settingsLookupMock.mockReset().mockResolvedValue({ ...settings, updatedAt: new Date("2026-10-19T00:00:00Z") });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["production", "development", undefined])("rejects non-Preview (%s) without reading or writing the database", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    await expect(markGroupManualTestSession("group-1")).resolves.toEqual({ error: "Preview 환경에서만 사용할 수 있습니다." });
    expect(requireAdminMock).toHaveBeenCalledOnce();
    expect(groupLookupMock).not.toHaveBeenCalled();
    expect(settingsLookupMock).not.toHaveBeenCalled();
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it("enforces admin authorization before accessing the database", async () => {
    requireAdminMock.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(markGroupManualTestSession("group-1")).rejects.toThrow("NOT_FOUND");
    expect(groupLookupMock).not.toHaveBeenCalled();
    expect(settingsLookupMock).not.toHaveBeenCalled();
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects MANAGER before any database access", async () => {
    principalRole = "MANAGER";
    await expect(markGroupManualTestSession("group-1")).rejects.toThrow("NOT_FOUND");
    expect(requireAdminMock).toHaveBeenCalledOnce();
    expect(groupLookupMock).not.toHaveBeenCalled();
    expect(settingsLookupMock).not.toHaveBeenCalled();
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("rejects an empty group ID (%j)", async (id) => {
    await expect(markGroupManualTestSession(id)).resolves.toEqual({ error: "잘못된 요청입니다." });
    expect(groupLookupMock).not.toHaveBeenCalled();
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown group", async () => {
    groupLookupMock.mockResolvedValue(null);
    await expect(markGroupManualTestSession("missing")).resolves.toEqual({ error: "그룹을 찾을 수 없습니다." });
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each(["manual-existing", "preview-existing"])("preserves an existing synthetic run (%s)", async (syntheticRunId) => {
    groupLookupMock.mockResolvedValue({ id: "group-1", syntheticRunId, isActive: true });
    await expect(markGroupManualTestSession("group-1")).resolves.toEqual({ error: "이미 테스트 세션으로 지정된 그룹입니다." });
    expect(settingsLookupMock).not.toHaveBeenCalled();
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each([null, { ...settings, accountNumber: " " }, { ...settings, blogUrl: "http://example.test" }])("rejects missing or invalid settings (%j)", async (value) => {
    settingsLookupMock.mockResolvedValue(value);
    await expect(markGroupManualTestSession("group-1")).resolves.toEqual({ error: "예약 신청 설정을 먼저 완료해주세요." });
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it("marks a group as ADMIN with a validated settings snapshot and a random run ID", async () => {
    const result = await markGroupManualTestSession("  group-1  ");
    expect(result.error).toBeUndefined();
    expect(result.runId).toMatch(/^manual-[A-Za-z0-9_-]{22}$/);
    expect(groupLookupMock).toHaveBeenCalledWith({
      where: { id: "group-1" }, select: { id: true, syntheticRunId: true, isActive: true },
    });
    expect(groupUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "group-1", syntheticRunId: null }, data: { syntheticRunId: result.runId, syntheticSettings: settings },
    });
    const second = await markGroupManualTestSession("group-2");
    expect(second.runId).toMatch(/^manual-[A-Za-z0-9_-]{22}$/);
    expect(second.runId).not.toBe(result.runId);
  });

  it("does not write when settings lookup fails", async () => {
    settingsLookupMock.mockRejectedValue(new Error("database unavailable"));
    await expect(markGroupManualTestSession("group-1")).rejects.toThrow("database unavailable");
    expect(groupUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects a lost marking race without returning a run ID", async () => {
    groupUpdateManyMock.mockResolvedValue({ count: 0 });
    await expect(markGroupManualTestSession("group-1")).resolves.toEqual({ error: "이미 테스트 세션으로 지정된 그룹입니다." });
    expect(groupUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "group-1", syntheticRunId: null },
      data: { syntheticRunId: expect.stringMatching(/^manual-[A-Za-z0-9_-]{22}$/), syntheticSettings: settings },
    });
  });

  it("returns exactly one winner when concurrent requests read an unmarked group", async () => {
    let storedRunId: string | null = null;
    groupUpdateManyMock.mockImplementation(async ({ where, data }: {
      where: { id: string; syntheticRunId: string | null };
      data: { syntheticRunId: string };
    }) => {
      if (where.syntheticRunId !== storedRunId) return { count: 0 };
      storedRunId = data.syntheticRunId;
      return { count: 1 };
    });

    const results = await Promise.all([
      markGroupManualTestSession("group-1"),
      markGroupManualTestSession("group-1"),
    ]);

    expect(groupLookupMock).toHaveBeenCalledTimes(2);
    expect(groupUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(results.filter((result) => result.runId)).toEqual([{ runId: storedRunId }]);
    expect(results.filter((result) => result.error)).toEqual([{ error: "이미 테스트 세션으로 지정된 그룹입니다." }]);
  });
});
