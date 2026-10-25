import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuspectedDuplicateApplicationDepositError } from "@/server/reservation-applications/finance";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), transaction: vi.fn(), core: vi.fn(), lock: vi.fn(), ledger: vi.fn(), prior: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/reservation-applications/finance", async (original) => ({
  ...(await original<typeof import("@/server/reservation-applications/finance")>()), recordApplicationDepositCore: mocks.core,
}));
import { recordApplicationDeposit } from "@/app/(admin)/reservation-applications/actions";

function form(change: Record<string, string> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries({ amount: "10000", payerName: "Synthetic Payer", depositedAt: "2026-01-01T09:30", idempotencyKey: "c11-action-fresh-key-0001", ...change })) data.set(name, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ userId: "c11-synthetic-admin" });
  mocks.lock.mockResolvedValue([{ id: "c11-submission" }]);
  mocks.prior.mockResolvedValue(null);
  mocks.ledger.mockResolvedValue({ applications: [{ id: "c11-app", status: "SUBMITTED", quotedAmount: 100_000, paymentMapping: null }], deposits: [], returnObligations: [] });
  mocks.transaction.mockImplementation((callback) => callback({ $queryRaw: mocks.lock, reservationApplicationSubmission: { findUnique: mocks.ledger }, applicationDeposit: { findUnique: mocks.prior } }));
  mocks.core.mockRejectedValue(new SuspectedDuplicateApplicationDepositError("c11-submission", ["c11-existing-deposit"]));
});

describe("C11 T05/T06 ADMIN layer (core double; no PG/browser verdict)", () => {
  it.each([" Synthetic Payer", "Synthetic Payer ", "\tSynthetic Payer\n", "\u3000Synthetic Payer\u3000"])("trims %j before sending to the guard", async (payerName) => {
    const result = await recordApplicationDeposit("c11-submission", form({ payerName }));
    expect(mocks.core).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payerName: "Synthetic Payer", depositedAt: new Date("2026-01-01T00:30:00.000Z") }));
    expect(result).toMatchObject({ status: "failure", code: "suspected-duplicate-deposit" });
  });
  it.each(["Synthetic  Payer", "synthetic payer", "가", "가", "ＡＢＣ", "ABC"])("preserves internal/case/Unicode %j before the guard", async (payerName) => {
    await recordApplicationDeposit("c11-submission", form({ payerName }));
    expect(mocks.core.mock.calls[0]![1].payerName).toBe(payerName);
  });
  it.each<Record<string, string>>([
    { amount: "0" }, { amount: "-1" }, { amount: "1.5" }, { amount: "2147483648" },
    { depositedAt: "invalid" }, { depositedAt: "2099-01-01T09:30" }, { depositedAt: "2026-01-01T09:30:00" },
  ])("invalid input %j is an input failure before the transaction, never guard rejection", async (change) => {
    const result = await recordApplicationDeposit("c11-submission", form(change));
    expect(result.status).toBe("failure"); expect(result.code).toBeUndefined(); expect(result.errors).toBeDefined();
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.core).not.toHaveBeenCalled();
  });
});

describe("C11 T07/T09 action mapping only (rendered alert asserted by browser cells)", () => {
  it.each([["c11-deposit-a"], ["c11-deposit-a", "c11-deposit-b", "c11-deposit-c"]])("preserves all candidate IDs %j and confirmation guidance without a success receipt", async (...candidateIds) => {
    mocks.core.mockRejectedValueOnce(new SuspectedDuplicateApplicationDepositError("c11-submission", candidateIds));
    const result = await recordApplicationDeposit("c11-submission", form());
    expect(result).toMatchObject({ status: "failure", code: "suspected-duplicate-deposit", submissionId: "c11-submission" });
    expect(result.error).toContain("동일한 신청·금액·입금자명·입금일시의 입금 기록이 있어 새 기록을 저장하지 않았습니다.");
    expect(result.error).toContain(`일치 후보 ${candidateIds.length}건:`);
    for (const id of candidateIds) expect(result.error).toContain(id);
    expect(result.error).toContain("가족 상세: /reservation-applications/submissions/c11-submission");
    expect(result.error).toContain("기존 입금 기록과 은행 거래를 확인해주세요.");
    expect(result.error).toContain("정상 별도 입금으로 확인되어도 별도 절차가 필요합니다.");
    for (const key of ["receiptId", "verified", "paymentId", "reservationIds"]) expect(result).not.toHaveProperty(key);
    expect(mocks.core).toHaveBeenCalledTimes(1);
  });
  it("keeps infrastructure failure unknown without candidate guidance or automatic replay", async () => {
    mocks.core.mockRejectedValueOnce(new Error("SYNTHETIC_CONNECTION_LOSS"));
    const result = await recordApplicationDeposit("c11-submission", form());
    expect(result.status).toBe("result-unknown"); expect(result.code).toBeUndefined();
    expect(result.error).not.toContain("일치 후보"); expect(result.receiptId).toBeUndefined();
    expect(mocks.core).toHaveBeenCalledTimes(1);
  });
});
