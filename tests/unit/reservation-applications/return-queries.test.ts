import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn(), find: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { APPLICATION_RETURN_SELECT, getApplicationReturn, listApplicationReturns, redactApplicationReturn, WORKFLOW_LEDGER_SELECT } from "@/lib/reservation-applications/return-queries";
import { summarizeDetailLedger } from "@/lib/reservation-applications/ledger-summary";
const date = new Date("2026-01-01T00:00:00Z");
function row() {
  return { id: "return-1", submissionId: "s1", applicationId: "a2", kind: "REJECTED" as const, amount: 60000, returnedAmount: 20000, resolvedAt: null, createdAt: date,
    returns: [{ id: "transfer-1", amount: 20000, returnedAt: date, createdAt: date, reason: "SYNTHETIC_PRIVATE_REASON", processedBy: { name: "합성 관리자" } }],
    submission: { personalDataPurgedAt: null as Date | null,
      applications: [{ id: "a1", status: "SUBMITTED", quotedAmount: 40000 as number | null, paymentMapping: null }, { id: "a2", status: "REJECTED", quotedAmount: 60000, paymentMapping: null }],
      deposits: [{ id: "d1", amount: 30000, confirmedAt: date, allocations: [{ depositId: "d1", amount: 30000, paymentMappingId: null, returnObligationId: "return-1" }] }, { id: "d2", amount: 70000, confirmedAt: date, allocations: [{ depositId: "d2", amount: 30000, paymentMappingId: null, returnObligationId: "return-1" }] }],
      returnObligations: [{ id: "return-1", amount: 60000, returnedAmount: 20000, returns: [{ amount: 20000 }] }],
    } };
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ role: "ADMIN" }); mocks.find.mockResolvedValue(row()); mocks.list.mockResolvedValue([row()]); mocks.transaction.mockImplementation((task) => task({ returnObligation: { findUnique: mocks.find, findMany: mocks.list } })); });
describe("shared return workbench projection", () => {
  it("family and whole-return reads share a receipt/history and preserve the exact conservation scenario", async () => {
    const raw = row(); const { submission, ...record } = raw; const family = redactApplicationReturn(record, false);
    expect(submission).toBeDefined();
    const detail = await getApplicationReturn("return-1"); const list = await listApplicationReturns();
    expect(detail).toEqual(list[0]); expect(detail).toMatchObject({ ...family, ledgerVerified: true });
    expect(detail?.returns[0]?.id).toBe("transfer-1"); expect(detail?.amount).toBe(60000); expect(detail?.returnedAmount).toBe(20000);
    const ledger = summarizeDetailLedger(raw.submission);
    expect(ledger).toEqual({ state: "available", Q: 100000, D: 100000, P: 0, R: 40000, T: 20000, A: 40000 });
    if (ledger.state === "available") expect(ledger.D).toBe(ledger.A + ledger.P + ledger.R + ledger.T);
    expect(mocks.find.mock.calls[0]![0].select).toMatchObject(APPLICATION_RETURN_SELECT);
    expect(mocks.transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "RepeatableRead" });
  });
  it.each(["MANAGER", "TEACHER", "anonymous"])("denies %s before touching the DB", async (role) => {
    mocks.auth.mockRejectedValue(new Error(role)); await expect(getApplicationReturn("return-1")).rejects.toThrow(role); await expect(listApplicationReturns()).rejects.toThrow(role);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["../unsafe", "", "a".repeat(129)])("bounds identifiers %s after auth, before query", async (id) => {
    expect(await getApplicationReturn(id)).toBeNull(); expect(mocks.auth).toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("keeps completed history and masks purged free text before crossing the server boundary", async () => {
    const data = row(); data.submission.personalDataPurgedAt = date; mocks.find.mockResolvedValue(data);
    const result = await getApplicationReturn("return-1");
    expect(result?.returns[0]?.reason).toBeNull(); expect(result?.returns[0]?.amount).toBe(20000);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_REASON"); expect(result).not.toHaveProperty("submission");
    expect(JSON.stringify({ APPLICATION_RETURN_SELECT, WORKFLOW_LEDGER_SELECT })).not.toMatch(/guardian|payerName|childName|childBirthDate|consent|safety|idempotencyKey|token/);
  });
  it.each(["unknown-quote", "bad-allocation", "bad-return"])("marks %s unavailable instead of displaying a normal balance", async (mode) => {
    const data = row();
    if (mode === "unknown-quote") data.submission.applications[0]!.quotedAmount = null;
    if (mode === "bad-allocation") data.submission.deposits[0]!.allocations[0]!.amount = 30001;
    if (mode === "bad-return") data.submission.returnObligations[0]!.returns[0]!.amount = 19999;
    mocks.find.mockResolvedValue(data); expect((await getApplicationReturn("return-1"))?.ledgerVerified).toBe(false);
  });
  it("propagates read failure instead of returning empty/successful balance", async () => {
    mocks.find.mockRejectedValue(new Error("SYNTHETIC_DB_FAILURE")); await expect(getApplicationReturn("return-1")).rejects.toThrow("SYNTHETIC_DB_FAILURE");
  });
});
