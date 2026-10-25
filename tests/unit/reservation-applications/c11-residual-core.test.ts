import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InsufficientApplicationDepositError,
  recordApplicationDepositCore,
  SuspectedDuplicateApplicationDepositError,
} from "@/server/reservation-applications/finance";
import { depositInputSchema, MAX_POSTGRES_INTEGER } from "@/lib/reservation-applications/phase20-validation";

// Query/validation evidence only. Real PostgreSQL equality, locking and rollback
// are covered by separate integration cells, never inferred from these doubles.
const now = new Date("2026-10-25T00:00:00.000Z");
const storedTime = new Date("2026-01-01T00:30:12.123Z");
function input(overrides: Partial<Parameters<typeof recordApplicationDepositCore>[1]> = {}) {
  return { submissionId: "c11-unit-submission", amount: 10_000, payerName: "Synthetic Payer", depositedAt: storedTime,
    actorUserId: "c11-unit-admin", now, idempotencyKey: "c11-unit-fresh-key-0001", ...overrides };
}
function fixture(candidateIds: string[] = []) {
  const query = vi.fn().mockResolvedValue(candidateIds.map((id) => ({ id })));
  const create = vi.fn().mockResolvedValue({ id: "c11-new-deposit" });
  const applications = vi.fn().mockResolvedValue([{ id: "c11-app", status: "SUBMITTED", quotedAmount: 100_000 }]);
  const allocations = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() };
  const obligations = { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const lock = vi.fn().mockResolvedValue([{ id: "c11-unit-submission" }]);
  const tx = {
    $queryRaw: lock,
    applicationDeposit: { findUnique: vi.fn().mockResolvedValue(null), create,
      findMany: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) =>
        "amount" in args.where ? query(args) : [{ id: "c11-stored-deposit", amount: 10_000, confirmedAt: storedTime }]) },
    reservationApplication: { findMany: applications }, fundAllocation: allocations, returnObligation: obligations,
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  const client = { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">;
  function noWrites() {
    for (const mutation of [create, allocations.create, obligations.create, obligations.update]) expect(mutation).not.toHaveBeenCalled();
    expect(applications).not.toHaveBeenCalled();
  }
  return { client, query, tx, transaction, noWrites };
}

describe("C11 T05 unit: parsing belongs to ADMIN schema; core forwards exact strings", () => {
  it.each([" Synthetic Payer", "Synthetic Payer ", "\tSynthetic Payer\n", "\u3000Synthetic Payer\u3000"])("ADMIN trims only surrounding whitespace: %j", (payerName) => {
    expect(depositInputSchema.parse({ amount: "10000", payerName, depositedAt: "2026-01-01T09:30" }).payerName).toBe("Synthetic Payer");
  });
  const names = [
    ["internal whitespace", "Synthetic  Payer"], ["English case", "synthetic payer"],
    ["NFC", "가"], ["NFD", "가"], ["NFKC full-width", "ＡＢＣ"], ["NFKC ASCII", "ABC"],
    ["core leading whitespace", " Synthetic Payer"], ["core trailing whitespace", "Synthetic Payer "],
  ] as const;
  it.each(names)("preserves %s in the core candidate predicate", async (_label, payerName) => {
    const f = fixture();
    await recordApplicationDepositCore(f.client, input({ payerName }));
    expect(f.query).toHaveBeenCalledWith({ where: { submissionId: "c11-unit-submission", amount: 10_000, payerName, depositedAt: storedTime }, select: { id: true }, orderBy: { id: "asc" } });
    expect(f.tx.applicationDeposit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payerName }) }));
  });
  it.each(names.slice(0, 6))("ADMIN does not normalize %s", (_label, payerName) => {
    expect(depositInputSchema.parse({ amount: "10000", payerName, depositedAt: "2026-01-01T09:30" }).payerName).toBe(payerName);
  });
  it("does not load or reprocess stored payer names before comparing", async () => {
    const f = fixture(["c11-candidate"]);
    await expect(recordApplicationDepositCore(f.client, input())).rejects.toBeInstanceOf(SuspectedDuplicateApplicationDepositError);
    expect(f.query.mock.calls[0]![0].select).toEqual({ id: true });
    expect(f.tx.applicationDeposit.findMany).toHaveBeenCalledTimes(1);
    f.noWrites();
  });
});

describe("C11 T06 unit: exact time, amount and Submission predicate; existing validation", () => {
  it("rejects a same-millisecond candidate without writing", async () => {
    const f = fixture(["c11-same-millisecond"]);
    await expect(recordApplicationDepositCore(f.client, input({ depositedAt: new Date(storedTime.getTime()) }))).rejects.toBeInstanceOf(SuspectedDuplicateApplicationDepositError);
    expect(f.query.mock.calls[0]![0].where.depositedAt.getTime()).toBe(storedTime.getTime());
    f.noWrites();
  });
  it.each([-1, 1, 60_000])("forwards %+d ms without tolerance or truncation when the DB reports no match", async (delta) => {
    const f = fixture(); const depositedAt = new Date(storedTime.getTime() + delta);
    await expect(recordApplicationDepositCore(f.client, input({ depositedAt }))).resolves.toMatchObject({ depositId: "c11-new-deposit" });
    expect(f.query.mock.calls[0]![0].where.depositedAt).toEqual(depositedAt);
    expect(f.tx.applicationDeposit.create.mock.calls[0]![0].data.depositedAt).toEqual(depositedAt);
  });
  it.each([{ amount: 9_999 }, { amount: 10_001 }, { submissionId: "c11-other-submission" }])("keeps the changed field in the exact predicate: %j", async (change) => {
    const f = fixture(); await recordApplicationDepositCore(f.client, input(change));
    expect(f.query.mock.calls[0]![0].where).toMatchObject(change);
  });
  it("converts KST minutes to UTC without interpreting the process timezone", () => {
    const parsed = depositInputSchema.parse({ amount: "10000", payerName: "Synthetic Payer", depositedAt: "2026-01-01T09:30" });
    expect(parsed.depositedAt.toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });
  it.each([0, -1, 1.5, MAX_POSTGRES_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])("invalid core amount %s rejects before guard/transaction", async (amount) => {
    const f = fixture(); await expect(recordApplicationDepositCore(f.client, input({ amount }))).rejects.toBeInstanceOf(InsufficientApplicationDepositError);
    expect(f.transaction).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
  });
  it.each([new Date("invalid"), new Date(now.getTime() + 1)])("invalid/future core time %s rejects before guard", async (depositedAt) => {
    const f = fixture(); await expect(recordApplicationDepositCore(f.client, input({ depositedAt }))).rejects.toBeInstanceOf(InsufficientApplicationDepositError);
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each(["2026-01-01T09:30:12", "2026-01-01T09:30:12.123", "2099-01-01T09:30", "2026-02-30T09:30", "not-a-time"])("ADMIN rejects unsupported or invalid datetime %j", (depositedAt) => {
    expect(depositInputSchema.safeParse({ amount: "10000", payerName: "Synthetic Payer", depositedAt }).success).toBe(false);
  });
  it.each(["0", "-1", "1.5", "2147483648"])("ADMIN rejects invalid amount %j", (amount) => {
    expect(depositInputSchema.safeParse({ amount, payerName: "Synthetic Payer", depositedAt: "2026-01-01T09:30" }).success).toBe(false);
  });
  it("accepts the positive Int maximum at validation only; no assertion about cumulative ledger capacity", () => {
    expect(depositInputSchema.parse({ amount: String(MAX_POSTGRES_INTEGER), payerName: "Synthetic Payer", depositedAt: "2026-01-01T09:30" }).amount).toBe(MAX_POSTGRES_INTEGER);
  });
});

describe("C11 T07 unit: candidate projection and error preserve every candidate", () => {
  it("candidate predicate has no key, allocation, refund or application-status exclusion (stored-state behavior needs PG)", async () => {
    const f = fixture(["c11-preserved-candidate"]);
    await expect(recordApplicationDepositCore(f.client, input())).rejects.toBeInstanceOf(SuspectedDuplicateApplicationDepositError);
    expect(f.query.mock.calls[0]![0].where).toEqual({ submissionId: "c11-unit-submission", amount: 10_000, payerName: "Synthetic Payer", depositedAt: storedTime });
    f.noWrites();
  });
  it("an omitted new key still checks candidates; all IDs remain in the error and no write is attempted", async () => {
    const ids = ["c11-deposit-a", "c11-deposit-b", "c11-deposit-c"];
    const f = fixture(ids);
    const error = await recordApplicationDepositCore(f.client, input({ idempotencyKey: undefined })).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SuspectedDuplicateApplicationDepositError);
    expect(error).toMatchObject({ submissionId: "c11-unit-submission", candidateDepositIds: ids, code: "suspected-duplicate-deposit" });
    expect(f.tx.applicationDeposit.findUnique).not.toHaveBeenCalled(); f.noWrites();
  });
  it("valid new name is a scalar equality, without a NULL wildcard or PII restoration", async () => {
    const f = fixture(); await recordApplicationDepositCore(f.client, input());
    expect(f.query.mock.calls[0]![0].where.payerName).toBe("Synthetic Payer");
    expect(Object.keys(f.query.mock.calls[0]![0].where).sort()).toEqual(["amount", "depositedAt", "payerName", "submissionId"]);
  });
});
