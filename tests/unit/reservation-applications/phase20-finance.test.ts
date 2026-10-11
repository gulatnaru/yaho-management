import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ApplicationReturnAmountExceededError, hasBoundOverbookingConfirmation, newChildIdentityLockKey, recordApplicationReturnCore, submissionSelectionFingerprint } from "@/server/reservation-applications/finance";

const now = new Date("2026-10-06T00:00:00.000Z");
const returnTime = new Date("2026-10-05T09:00:00.000Z");
const key = "return-idempotency-key-0001";

function returnClient(
  obligation: { id: string; amount: number; returnedAmount: number } | undefined,
  options: { prior?: { id: string; returnObligationId: string } | null; fundedAmount?: number | null } = {},
) {
  const applicationReturn = {
    findUnique: vi.fn().mockResolvedValue(options.prior ?? null),
    create: vi.fn().mockResolvedValue({ id: "return-1" }),
  };
  const returnObligation = {
    findUnique: vi.fn().mockResolvedValue(obligation ? { submissionId: "submission-1" } : null),
    update: vi.fn().mockResolvedValue({}),
  };
  const fundAllocation = { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: options.fundedAmount ?? obligation?.amount ?? null } }) };
  const transaction = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: "submission-1" }])
      .mockResolvedValueOnce(obligation ? [obligation] : []),
    applicationReturn,
    returnObligation,
    fundAllocation,
  };
  return { client: { $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as never, applicationReturn, returnObligation, fundAllocation };
}

function input(overrides: Partial<{ obligationId: string; amount: number; reason: string; returnedAt: Date; idempotencyKey: string }> = {}) {
  return { obligationId: "obligation-1", amount: 2_000, reason: "부분 반환", returnedAt: returnTime, idempotencyKey: key, actorUserId: "admin-1", now, ...overrides };
}

describe("Phase 20 pre-reservation returns", () => {
  it("records a partial actual bank return and leaves the fully funded obligation open", async () => {
    const { client, applicationReturn, returnObligation, fundAllocation } = returnClient({ id: "obligation-1", amount: 10_000, returnedAmount: 3_000 });
    await expect(recordApplicationReturnCore(client, input())).resolves.toEqual({ returnId: "return-1", remainingAmount: 5_000 });
    expect(fundAllocation.aggregate).toHaveBeenCalledWith({ where: { returnObligationId: "obligation-1" }, _sum: { amount: true } });
    expect(applicationReturn.create).toHaveBeenCalledWith({ data: expect.objectContaining({ returnObligationId: "obligation-1", amount: 2_000, reason: "부분 반환", returnedAt: returnTime, idempotencyKey: key }), select: { id: true } });
    expect(returnObligation.update).toHaveBeenCalledWith({ where: { id: "obligation-1" }, data: { returnedAmount: 5_000, resolvedAt: null } });
  });

  it("rejects an over-return before creating a return row", async () => {
    const { client, applicationReturn } = returnClient({ id: "obligation-1", amount: 10_000, returnedAmount: 9_000 });
    await expect(recordApplicationReturnCore(client, input({ amount: 1_001 }))).rejects.toBeInstanceOf(ApplicationReturnAmountExceededError);
    expect(applicationReturn.create).not.toHaveBeenCalled();
  });

  it("returns the completed request for the same key before checking the exhausted balance", async () => {
    const { client, applicationReturn, returnObligation } = returnClient(
      { id: "obligation-1", amount: 10_000, returnedAmount: 10_000 },
      { prior: { id: "return-complete", returnObligationId: "obligation-1" } },
    );
    await expect(recordApplicationReturnCore(client, input({ amount: 10_000, reason: "재시도" }))).resolves.toEqual({ returnId: "return-complete", remainingAmount: 0 });
    expect(applicationReturn.create).not.toHaveBeenCalled();
    expect(returnObligation.update).not.toHaveBeenCalled();
  });

  it("rejects a key already used for another obligation without creating a second return", async () => {
    const { client, applicationReturn } = returnClient(
      { id: "obligation-1", amount: 10_000, returnedAmount: 0 },
      { prior: { id: "return-other", returnObligationId: "obligation-2" } },
    );
    await expect(recordApplicationReturnCore(client, input())).rejects.toBeInstanceOf(ApplicationReturnAmountExceededError);
    expect(applicationReturn.create).not.toHaveBeenCalled();
  });

  it("refuses a return when the obligation is not completely funded by its own allocations", async () => {
    const { client, applicationReturn } = returnClient({ id: "obligation-1", amount: 10_000, returnedAmount: 0 }, { fundedAmount: 9_999 });
    await expect(recordApplicationReturnCore(client, input())).rejects.toBeInstanceOf(ApplicationReturnAmountExceededError);
    expect(applicationReturn.create).not.toHaveBeenCalled();
  });
});

describe("Phase 20 new-child advisory identity key", () => {
  it("uses a JSON tuple without PostgreSQL-invalid NUL bytes and mirrors duplicate identity", () => {
    const base = { name: "아이", birthDate: new Date("2020-01-01T00:00:00.000Z"), guardianName: "보호자", guardianPhone: "010-0000-0000" };
    const value = newChildIdentityLockKey(base);
    expect(value).not.toContain("\u0000");
    expect(JSON.parse(value)).toEqual(["phase20-new-child-v1", "아이", "2020-01-01T00:00:00.000Z", "보호자", "010-0000-0000"]);
  });

  it("uses a scalar advisory-lock query so Prisma never deserializes PostgreSQL void", () => {
    const financeSource = readFileSync(fileURLToPath(new URL("../../../server/reservation-applications/finance.ts", import.meta.url)), "utf8");

    expect(financeSource).toMatch(/SELECT 1 AS "locked"\s+FROM pg_advisory_xact_lock\(hashtextextended\(/);
  });
});

describe("Phase 20 submission overbooking authority", () => {
  const choices = [{ applicationId: "application-1", newChild: true }];
  const selectionFingerprint = submissionSelectionFingerprint(choices);
  const application = { id: "application-1", classScheduleId: "class-1" };
  const binding = { applicationId: "application-1", classScheduleId: "class-1", childChoice: "NEW", selectionFingerprint };

  it("authorizes overbooking only with the exact server-bound application, class, child choice, and selected set", () => {
    expect(hasBoundOverbookingConfirmation({ choice: { ...choices[0]!, confirmOverbooking: true, overbookingConfirmation: binding }, application, selectionFingerprint })).toBe(true);
  });

  it("does not authorize a bare confirmOverbooking flag", () => {
    expect(hasBoundOverbookingConfirmation({ choice: { ...choices[0]!, confirmOverbooking: true }, application, selectionFingerprint })).toBe(false);
  });

  it("does not authorize a confirmation after the selected set changed", () => {
    const changedSelection = submissionSelectionFingerprint([...choices, { applicationId: "application-2", childId: "child-2" }]);
    expect(hasBoundOverbookingConfirmation({ choice: { ...choices[0]!, confirmOverbooking: true, overbookingConfirmation: binding }, application, selectionFingerprint: changedSelection })).toBe(false);
  });

  it("does not authorize mismatched class, application, or stable child choices", () => {
    for (const mismatched of [
      { ...binding, classScheduleId: "class-2" },
      { ...binding, applicationId: "application-2" },
      { ...binding, childChoice: "child-1" },
    ]) {
      expect(hasBoundOverbookingConfirmation({ choice: { ...choices[0]!, confirmOverbooking: true, overbookingConfirmation: mismatched }, application, selectionFingerprint })).toBe(false);
    }
  });
});
