import { beforeEach, describe, expect, it, vi } from "vitest";
const { auth, query } = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: auth, requireAdminOrSuperAdminPrincipal: auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: query } }));
import { getNotificationHistory, getNotificationSummary } from "@/server/kakao/notification-queries";
import { budgetLevels } from "@/app/(admin)/reservation-applications/_components/notification-budget";

describe("notification queries", () => {
  beforeEach(() => { auth.mockReset(); query.mockReset(); query.mockResolvedValue([]); });
  it("authorizes each query before touching storage", async () => {
    auth.mockRejectedValue(new Error("denied"));
    await expect(getNotificationSummary("synthetic")).rejects.toThrow("denied");
    await expect(getNotificationHistory(1)).rejects.toThrow("denied");
    expect(query).not.toHaveBeenCalled();
  });
  it("uses bounded history and aggregate queries", async () => {
    auth.mockResolvedValue({});
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
    await getNotificationHistory(1);
    expect(query).toHaveBeenCalledTimes(2);
    await expect(getNotificationHistory(0)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("selects only operational fields, without recipient material or provider responses", async () => {
    auth.mockResolvedValue({});
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
    await getNotificationHistory(1);
    const sql = query.mock.calls.map(([parts]) => (parts as string[]).join("?")).join(" ");
    expect(sql).not.toMatch(/ciphertext|nonce|\btag\b|providerRef|recipientId|rawResponse/i);
    expect(sql).toMatch(/LIMIT 21/);
    expect(sql).toContain('s."unresolvedSlots" > 0');
    expect(sql).toContain('s."unresolvedCosts" > 0');
  });
  it("uses fake aggregate values once and reads prior reservations instead of a stale carry cache", async () => {
    auth.mockResolvedValue({});
    const budget = { dayRequests: 2, monthRequests: 3, confirmed: 1000n, reserved: 2000n, carry: 3000n, lookupConfirmed: 400n, lookupReserved: 500n, lookupCarry: 600n, other: 700n, blocked: false };
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([budget]);
    const result = await getNotificationHistory(1);
    expect(budgetLevels(result.budget)).toMatchObject({ message: 6000n, total: 8200n });
    const aggregateSql = (query.mock.calls[1][0] as string[]).join("?");
    expect(aggregateSql).toContain('c."monthKey" <');
    expect(aggregateSql).toContain('c."reservedMilliKrw" > 0');
    expect(aggregateSql).not.toContain('month."carryMilliKrw"');
  });
});
