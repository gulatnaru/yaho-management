import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), children: vi.fn(), submissions: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: mocks.transaction, $queryRaw: mocks.query } }));
import { FAMILY_CHILD_SELECT, familyKeysSql, listApplicationFamilies, countPendingApplicationFamilies } from "@/lib/reservation-applications/family-queries";
import { parseFamilyFilters } from "@/lib/reservation-applications/navigation";
const counts = { families: 21n, children: 24n, matching: 21n, unfiltered: 30n, pendingFamilies: 25n, pendingChildren: 28n };
const child = (id: string, status = "SUBMITTED") => ({ id, submissionId: "s1", guardianName: null, childName: id, quotedAmount: 10000, status, depositConfirmedAt: null, classScheduleId: "c1", classSchedule: { startsAt: new Date(), endsAt: new Date(), program: { name: "합성" } } });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ role: "ADMIN" }); mocks.execute.mockResolvedValue(0); mocks.query.mockResolvedValue([]);
  mocks.transaction.mockImplementation((fn) => fn({ $queryRaw: mocks.query, $executeRaw: mocks.execute, reservationApplication: { findMany: mocks.children }, reservationApplicationSubmission: { findMany: mocks.submissions } }));
  mocks.children.mockResolvedValue([child("a1"), child("a2", "CONFIRMED")]); mocks.submissions.mockResolvedValue([{ id: "s1", guardianName: "보호자", depositNotifiedAt: new Date() }]);
});
describe("family list authorization and projection", () => {
  it.each(["MANAGER", "TEACHER"])("denies %s before any application/count/transaction query", async (role) => {
    mocks.auth.mockRejectedValue(new Error(role));
    await expect(listApplicationFamilies()).rejects.toThrow(role); await expect(countPendingApplicationFamilies()).rejects.toThrow(role);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.children).not.toHaveBeenCalled();
  });
  it("returns global pending families separately from child applications", async () => {
    mocks.query.mockResolvedValueOnce([{ families: 2n, children: 5n }]);
    expect(await countPendingApplicationFamilies()).toEqual({ families: 2, childApplications: 5 });
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]!);
  });
  it("pages family keys, clamps a shrinking page, hydrates siblings and labels count scopes in repeatable read", async () => {
    mocks.query.mockResolvedValueOnce([counts]).mockResolvedValueOnce([{ kind: "submission", id: "s1" }]).mockResolvedValueOnce([{ id: "s1", quote: 20000n, deposits: 0n, paymentAllocated: 0n, returnFunded: 0n, returned: 0n, valid: true }]);
    const result = await listApplicationFamilies({ page: "99", status: "SUBMITTED", classScheduleId: "c1" });
    expect(result).toMatchObject({ page: 2, totalPages: 2, totalFamilies: 21, totalChildApplications: 24, matchingChildApplications: 21, globalPending: { families: 25, childApplications: 28 } });
    expect(result.families[0]?.children.map((c) => c.matchesFilter)).toEqual([true, false]);
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead" });
    const keySql = mocks.query.mock.calls[1]?.[0]; expect(keySql.text).toContain("LIMIT"); expect(keySql.values.slice(-2)).toEqual([20, 20]);
    expect(mocks.children).toHaveBeenCalledTimes(1); expect(mocks.submissions).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(FAMILY_CHILD_SELECT)).not.toMatch(/guardianPhone|childBirthDate|requestNote|consent|deposits|paymentMapping|returnObligations/);
    expect(result.families[0]?.deposit).toEqual({ state: "available", depositedAmount: 0, hasOutstandingReturn: false });
  });
  it("projects duplicate IDs in one batch without exposing comparison PII", async () => {
    mocks.query.mockResolvedValueOnce([counts]).mockResolvedValueOnce([{ kind: "submission", id: "s1" }]).mockResolvedValueOnce([{ id: "s1", quote: 20000n, deposits: 0n, paymentAllocated: 0n, returnFunded: 0n, returned: 0n, valid: true }]).mockResolvedValueOnce([{ id: "a1" }]);
    const result = await listApplicationFamilies();
    expect(result.families[0]?.children.map((child) => child.isPossibleDuplicate)).toEqual([true, false]);
    const comparison = mocks.query.mock.calls[3]![0]; expect(comparison.text).toContain("SELECT a.id"); expect(comparison.values).toEqual(["a1", "a2"]);
    expect(JSON.stringify(result.families)).not.toMatch(/guardianPhone|childBirthDate|requestNote/);
  });
  it("turns ledger query failure into explicit unavailable state, not zero or an empty list", async () => {
    mocks.query.mockResolvedValueOnce([counts]).mockResolvedValueOnce([{ kind: "submission", id: "s1" }]).mockRejectedValueOnce(new Error("read failure"));
    const result = await listApplicationFamilies(); expect(result.families[0]?.deposit).toEqual({ state: "unavailable" });
    expect(mocks.execute.mock.calls[1]?.[0].join("")).toContain("ROLLBACK TO SAVEPOINT");
  });
  it("propagates list count failure to the route error boundary", async () => { mocks.query.mockRejectedValue(new Error("read failed")); await expect(listApplicationFamilies()).rejects.toThrow("read failed"); });
  it("parameterizes same-child predicates without excluding cancelled/started classes or legacy merging", () => {
    const sql = familyKeysSql(parseFamilyFilters({ classScheduleId: "c1", notification: "none", bankRecord: "none" }));
    expect(sql.text).toContain("UNION ALL"); expect(sql.text).toContain('a."status"::text'); expect(sql.text).toContain('a."classScheduleId"');
    expect(sql.text).not.toContain("guardianPhone"); expect(sql.text).not.toContain('c."status"'); expect(sql.values).toContain("c1"); expect(sql.values.at(-1)).toBe(false);
  });
  it("retains separate legacy and modern identities and returns amount-unrecorded", async () => {
    mocks.query.mockResolvedValueOnce([{ ...counts, families: 1n }]).mockResolvedValueOnce([{ kind: "legacy", id: "a1" }]);
    mocks.children.mockResolvedValue([{ ...child("a1"), submissionId: null, guardianName: "보호자", quotedAmount: null }]);
    const result = await listApplicationFamilies(); expect(result.families[0]).toMatchObject({ kind: "legacy", id: "a1", notificationReceived: null, deposit: { state: "amount-unrecorded" } }); expect(mocks.submissions).not.toHaveBeenCalled();
  });
});
