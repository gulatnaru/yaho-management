import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-058 (CONC-1): 동의 기록·안전정보 저장은 Child 행을 FOR SHARE 로 잠근 뒤 파기 여부를 판정한다.
 * 실제 DB 경합은 tests/e2e/phase18-retention-concurrency.spec.ts 에서 확인하고, 여기서는 잠금이 쓰기보다 먼저
 * 같은 트랜잭션 안에서 일어나는지와 오류 안내를 확인한다.
 */

const requireOperationalMock = vi.fn();
const lockRowMock = vi.fn();
const consentCreateMock = vi.fn();
const safetyUpsertMock = vi.fn();
const transactionMock = vi.fn();
const rawSqlLog: string[] = [];

const txMock = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    rawSqlLog.push(strings.join("?"));
    const row = await lockRowMock(...values);
    return row ? [row] : [];
  },
  childConsent: { create: (...args: unknown[]) => consentCreateMock(...args) },
  childSafetyInfo: { upsert: (...args: unknown[]) => safetyUpsertMock(...args) },
};

vi.mock("@/lib/auth/authorization", () => ({
  requireOperationalPrincipal: (...args: unknown[]) => requireOperationalMock(...args),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: (...args: unknown[]) => transactionMock(...args) },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

const { recordChildConsentCore } = await import("@/server/children/consent");
const { upsertChildSafetyInfoCore } = await import("@/server/children/safety-info");
const { recordChildConsent } = await import("@/lib/children/consent/actions");
const { updateChildSafetyInfo } = await import("@/lib/children/safety-info/actions");
const { ChildPersonalDataPurgedError } = await import("@/lib/children/errors");
const { ChildNotFoundError } = await import("@/lib/reservations/errors");

const PURGED_ROW = { isActive: false, personalDataPurgedAt: new Date("2031-01-01T00:00:00Z") };
const ACTIVE_ROW = { isActive: true, personalDataPurgedAt: null };
const client = { $transaction: (...args: unknown[]) => transactionMock(...args) } as never;

function consentForm() {
  const formData = new FormData();
  formData.set("consentType", "PHOTO_SHARE");
  formData.set("action", "AGREED");
  formData.set("memo", "");
  return formData;
}

function safetyForm() {
  const formData = new FormData();
  formData.set("allergies", "합성 알레르기");
  return formData;
}

beforeEach(() => {
  rawSqlLog.length = 0;
  requireOperationalMock.mockReset();
  requireOperationalMock.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
  lockRowMock.mockReset();
  consentCreateMock.mockReset();
  safetyUpsertMock.mockReset();
  transactionMock.mockReset();
  transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
});

describe("recordChildConsentCore", () => {
  it("locks the child row FOR SHARE and appends the consent in the same transaction", async () => {
    lockRowMock.mockResolvedValue(ACTIVE_ROW);

    await recordChildConsentCore(client, {
      childId: "child-1",
      consent: { consentType: "PHOTO_SHARE", action: "AGREED" },
      actorUserId: "admin-1",
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(rawSqlLog).toEqual([expect.stringMatching(/FROM "Child" WHERE "id" = \? FOR SHARE/)]);
    expect(lockRowMock).toHaveBeenCalledWith("child-1");
    expect(lockRowMock.mock.invocationCallOrder[0]).toBeLessThan(consentCreateMock.mock.invocationCallOrder[0]!);
    expect(consentCreateMock).toHaveBeenCalledWith({
      data: { childId: "child-1", consentType: "PHOTO_SHARE", action: "AGREED", recordedById: "admin-1" },
    });
  });

  it("does not write when the locked row shows the child was purged", async () => {
    lockRowMock.mockResolvedValue(PURGED_ROW);

    await expect(
      recordChildConsentCore(client, {
        childId: "child-1",
        consent: { consentType: "PRIVACY", action: "AGREED" },
        actorUserId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(ChildPersonalDataPurgedError);
    expect(consentCreateMock).not.toHaveBeenCalled();
  });

  it("reports a missing child separately", async () => {
    lockRowMock.mockResolvedValue(null);

    await expect(
      recordChildConsentCore(client, {
        childId: "missing",
        consent: { consentType: "PRIVACY", action: "AGREED" },
        actorUserId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(ChildNotFoundError);
    expect(consentCreateMock).not.toHaveBeenCalled();
  });
});

describe("upsertChildSafetyInfoCore", () => {
  it("locks the child row FOR SHARE before saving safety info", async () => {
    lockRowMock.mockResolvedValue(ACTIVE_ROW);

    await upsertChildSafetyInfoCore(client, {
      childId: "child-1",
      safetyInfo: { allergies: "합성 알레르기" },
      actorUserId: "admin-1",
    });

    expect(rawSqlLog).toEqual([expect.stringMatching(/FROM "Child" WHERE "id" = \? FOR SHARE/)]);
    expect(lockRowMock.mock.invocationCallOrder[0]).toBeLessThan(safetyUpsertMock.mock.invocationCallOrder[0]!);
    expect(safetyUpsertMock).toHaveBeenCalledWith({
      where: { childId: "child-1" },
      create: { childId: "child-1", allergies: "합성 알레르기", updatedById: "admin-1" },
      update: { allergies: "합성 알레르기", updatedById: "admin-1" },
    });
  });

  it("does not write when the locked row shows the child was purged", async () => {
    lockRowMock.mockResolvedValue(PURGED_ROW);

    await expect(
      upsertChildSafetyInfoCore(client, { childId: "child-1", safetyInfo: {}, actorUserId: "admin-1" }),
    ).rejects.toBeInstanceOf(ChildPersonalDataPurgedError);
    expect(safetyUpsertMock).not.toHaveBeenCalled();
  });
});

describe("consent and safety actions map lock results to messages", () => {
  it("recordChildConsent tells purged and missing children apart", async () => {
    lockRowMock.mockResolvedValueOnce(PURGED_ROW);
    await expect(recordChildConsent("child-1", {}, consentForm())).resolves.toEqual({
      formError: "보관기간이 지나 개인정보를 파기한 아이에게는 동의 이력을 기록할 수 없습니다.",
    });

    lockRowMock.mockResolvedValueOnce(null);
    await expect(recordChildConsent("missing", {}, consentForm())).resolves.toEqual({
      formError: "아이를 찾을 수 없습니다.",
    });
    expect(consentCreateMock).not.toHaveBeenCalled();
  });

  it("recordChildConsent succeeds for an active child", async () => {
    lockRowMock.mockResolvedValueOnce(ACTIVE_ROW);
    await expect(recordChildConsent("child-1", {}, consentForm())).resolves.toEqual({ success: true });
    expect(consentCreateMock).toHaveBeenCalledTimes(1);
  });

  it("updateChildSafetyInfo tells purged and missing children apart and redirects on success", async () => {
    lockRowMock.mockResolvedValueOnce(PURGED_ROW);
    await expect(updateChildSafetyInfo("child-1", {}, safetyForm())).resolves.toEqual({
      formError: "보관기간이 지나 개인정보를 파기한 아이에게는 안전정보를 기록할 수 없습니다.",
    });

    lockRowMock.mockResolvedValueOnce(null);
    await expect(updateChildSafetyInfo("missing", {}, safetyForm())).resolves.toEqual({
      formError: "아이를 찾을 수 없습니다.",
    });
    expect(safetyUpsertMock).not.toHaveBeenCalled();

    lockRowMock.mockResolvedValueOnce(ACTIVE_ROW);
    await expect(updateChildSafetyInfo("child-1", {}, safetyForm())).rejects.toThrow("REDIRECT");
    expect(safetyUpsertMock).toHaveBeenCalledTimes(1);
  });
});
