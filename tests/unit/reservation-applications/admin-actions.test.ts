import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ApplicationDepositNotConfirmedError,
  ApplicationNotPendingError,
} from "@/lib/reservation-applications/errors";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { ApplicationSubmissionOverbookingConfirmationError } from "@/server/reservation-applications/finance";
import {
  ChildNotActiveError,
  ChildNotFoundError,
  OverbookingConfirmationRequiredError,
} from "@/lib/reservations/errors";

const requireAdminMock = vi.fn();
const confirmCoreMock = vi.fn();
const depositCoreMock = vi.fn();
const closeCoreMock = vi.fn();
const issueCoreMock = vi.fn();
const stopCoreMock = vi.fn();
const purgeCoreMock = vi.fn();
const applicationLookupMock = vi.fn();
const createGroupCoreMock = vi.fn();
const updateGroupCoreMock = vi.fn();
const stopGroupCoreMock = vi.fn();
const issueGroupCoreMock = vi.fn();
const atomicIssueMock = vi.fn();
const upgradeLegacyCoreMock = vi.fn();
const saveSettingsCoreMock = vi.fn();
const importSettingsCoreMock = vi.fn();
const recordDepositCoreMock = vi.fn();
const recordReturnCoreMock = vi.fn();
const confirmSubmissionCoreMock = vi.fn();
const closeReturnCoreMock = vi.fn();
const workflowTransactionMock = vi.fn();
const workflowLedgerMock = vi.fn();
const workflowDepositMock = vi.fn();
const workflowReturnMock = vi.fn();
const workflowObligationMock = vi.fn();
const workflowLockMock = vi.fn();
const workflowTargetsMock = vi.fn();
const workflowClassesMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdminPrincipal: (...args: unknown[]) => requireAdminMock(...args),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  $transaction: (...args: unknown[]) => workflowTransactionMock(...args),
  applicationDeposit: { findUnique: (...args: unknown[]) => workflowDepositMock(...args) },
  applicationReturn: { findUnique: (...args: unknown[]) => workflowReturnMock(...args) },
  reservationApplication: { findUnique: (...args: unknown[]) => applicationLookupMock(...args) },
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));
vi.mock("@/server/reservation-applications/confirm", () => ({
  confirmReservationApplicationCore: (...args: unknown[]) => confirmCoreMock(...args),
}));
vi.mock("@/server/reservation-applications/resolve", () => ({
  confirmApplicationDepositCore: (...args: unknown[]) => depositCoreMock(...args),
  closeReservationApplicationCore: (...args: unknown[]) => closeCoreMock(...args),
}));
vi.mock("@/server/reservation-applications/retention", () => ({
  purgeExpiredPersonalDataCore: (...args: unknown[]) => purgeCoreMock(...args),
}));
vi.mock("@/server/reservation-applications/links", () => ({
  issueApplicationLinkCore: (...args: unknown[]) => issueCoreMock(...args),
  stopApplicationLinkCore: (...args: unknown[]) => stopCoreMock(...args),
  upgradeLegacyApplicationLinkCore: (...args: unknown[]) => upgradeLegacyCoreMock(...args),
}));
vi.mock("@/server/reservation-applications/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/reservation-applications/groups")>()),
  issueClassLinkOperationCore: (...args: unknown[]) => atomicIssueMock(...args),
  createApplicationGroupCore: (...args: unknown[]) => createGroupCoreMock(...args),
  updateApplicationGroupCore: (...args: unknown[]) => updateGroupCoreMock(...args),
  stopApplicationGroupCore: (...args: unknown[]) => stopGroupCoreMock(...args),
  issueApplicationGroupLinkCore: (...args: unknown[]) => issueGroupCoreMock(...args),
}));
vi.mock("@/server/reservation-applications/settings", () => ({
  getReservationApplicationSettings: vi.fn(),
  importLegacyReservationApplicationSettingsCore: (...args: unknown[]) => importSettingsCoreMock(...args),
  isReservationApplicationSettingsReady: vi.fn(),
  saveReservationApplicationSettingsCore: (...args: unknown[]) => saveSettingsCoreMock(...args),
}));
vi.mock("@/server/reservation-applications/finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/reservation-applications/finance")>()),
  closeApplicationWithReturnCore: (...args: unknown[]) => closeReturnCoreMock(...args),
  confirmApplicationSubmissionCore: (...args: unknown[]) => confirmSubmissionCoreMock(...args),
  recordApplicationDepositCore: (...args: unknown[]) => recordDepositCoreMock(...args),
  recordApplicationReturnCore: (...args: unknown[]) => recordReturnCoreMock(...args),
}));

const actions = await import("@/app/(admin)/reservation-applications/actions");

const adminPrincipal = {
  userId: "admin-1",
  name: "관리자",
  email: "admin@yaho.test",
  role: "ADMIN",
  teacherId: null,
  authVersion: 1,
  mustChangePassword: false,
};

function formData(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const allCores = [closeReturnCoreMock, atomicIssueMock, confirmCoreMock, depositCoreMock, closeCoreMock, issueCoreMock, stopCoreMock, purgeCoreMock, createGroupCoreMock, updateGroupCoreMock, stopGroupCoreMock, issueGroupCoreMock, upgradeLegacyCoreMock, saveSettingsCoreMock, importSettingsCoreMock, recordDepositCoreMock, recordReturnCoreMock, confirmSubmissionCoreMock];

describe("reservation application admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockReset();
    applicationLookupMock.mockReset();
    applicationLookupMock.mockResolvedValue(null);
    for (const core of allCores) core.mockReset();
    workflowDepositMock.mockReset().mockResolvedValue(null); workflowReturnMock.mockReset().mockResolvedValue(null);
    workflowObligationMock.mockReset().mockResolvedValue({ submissionId: "submission-1" });
    workflowLockMock.mockReset().mockResolvedValue([{ id: "submission-1", amount: 60000, returnedAmount: 0, resolvedAt: null }]);
    workflowLedgerMock.mockReset().mockResolvedValue({ applications: [{ id: "application-1", status: "SUBMITTED", quotedAmount: 100000, paymentMapping: null }], deposits: [], returnObligations: [] });
    workflowTargetsMock.mockReset().mockResolvedValue([{ id: "application-1", classScheduleId: "class-1", status: "SUBMITTED", personalDataPurgedAt: null, programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true }]);
    workflowClassesMock.mockReset().mockResolvedValue([{ id: "class-1", capacity: 8, _count: { reservations: 8 } }]);
    workflowTransactionMock.mockReset().mockImplementation((callback) => callback({
      reservationApplication: { findMany: workflowTargetsMock }, classSchedule: { findMany: workflowClassesMock },
      $queryRaw: workflowLockMock, reservationApplicationSubmission: { findUnique: workflowLedgerMock },
      applicationDeposit: { findUnique: workflowDepositMock }, applicationReturn: { findUnique: workflowReturnMock },
      returnObligation: { findUnique: workflowObligationMock },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks MANAGER and TEACHER (requireAdminPrincipal → notFound) before any core runs", async () => {
    requireAdminMock.mockRejectedValue(new Error("NOT_FOUND"));

    const calls = [
      () => actions.issueClassApplicationLink({}),
      () => actions.issueApplicationLink("class-1", "a".repeat(64)),
      () => actions.stopApplicationLink("class-1"),
      () => actions.confirmApplicationDeposit("application-1"),
      () => actions.confirmReservationApplication("application-1", {}, formData({ childChoice: "NEW" })),
      () => actions.rejectReservationApplication("application-1", {}, formData({ resolutionNote: "사유" })),
      () => actions.cancelReservationApplication("application-1", {}, formData({ resolutionNote: "사유" })),
      () => actions.purgeExpiredPersonalData(),
      () => actions.createApplicationGroup(new FormData()),
      () => actions.updateApplicationGroup("group-1", new FormData()),
      () => actions.stopApplicationGroup("group-1"),
      () => actions.issueApplicationGroupLink("group-1"),
      () => actions.upgradeLegacyApplicationLink("class-1"),
      () => actions.saveReservationApplicationSettings(new FormData()),
      () => actions.importLegacyReservationApplicationSettings(),
      () => actions.recordApplicationDeposit("submission-1", new FormData()),
      () => actions.recordApplicationReturn("obligation-1", new FormData()),
      () => actions.lookupWorkflowReceipt("deposit", "submission-1", "key-1234567890123456"),
      () => actions.refreshApplicationWorkflow("submission-1"),
      () => actions.refreshApplicationReturn("obligation-1"),
      () => actions.refreshApplicationReturns(),
      () => actions.resolveApplicationWorkflow("application-1", "REJECTED", new FormData()),
      () => actions.confirmApplicationSubmission(new FormData()),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow("NOT_FOUND");
    }
    for (const core of allCores) expect(core).not.toHaveBeenCalled();
  });

  describe("as ADMIN", () => {
    beforeEach(() => {
      requireAdminMock.mockResolvedValue(adminPrincipal);
    });

    it("forwards an explicit bulk overbooking binding without treating a bare flag as authorization", async () => {
      confirmSubmissionCoreMock.mockResolvedValueOnce({ paymentId: "payment-1", reservationIds: ["reservation-1"] });
      const payload = {
        submissionId: "submission-1",
        choices: [{
          applicationId: "application-1",
          newChild: true,
          confirmOverbooking: true,
          overbookingConfirmation: {
            applicationId: "application-1",
            classScheduleId: "class-1",
            childChoice: "NEW",
            selectionFingerprint: '[["application-1","NEW"]]',
            classState: '["class-1",null,null,null]',
            capacity: 8, reservedCount: 8,
          },
        }],
      };
      const form = formData({ payload: JSON.stringify(payload) });

      await expect(actions.confirmApplicationSubmission(form)).resolves.toEqual({ status: "success", submissionId: "submission-1", applicationIds: ["application-1"], paymentId: "payment-1", reservationIds: ["reservation-1"] });
      expect(confirmSubmissionCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        submissionId: "submission-1",
        choices: [expect.objectContaining({ confirmOverbooking: true, overbookingConfirmation: payload.choices[0]!.overbookingConfirmation })],
        actorUserId: "admin-1",
      }));
    });

    it.each(["programTermsAcknowledged", "privacyConsentAgreed", "legalGuardianConfirmed", "refundTermsAcknowledged"])("adapter defensively blocks invalid %s before core execution", async (field) => {
      workflowTargetsMock.mockResolvedValueOnce([{ id: "application-1", classScheduleId: "class-1", status: "SUBMITTED", programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, [field]: false }]);
      const result = await actions.confirmApplicationSubmission(formData({ payload: JSON.stringify({ submissionId: "submission-1", choices: [{ applicationId: "application-1", newChild: true }] }) }));
      expect(result.status).toBe("failure"); expect(confirmSubmissionCoreMock).not.toHaveBeenCalled();
    });
    it.each(["capacity", "count", "class-time"])("does not forward an approval after latest %s changes", async (change) => {
      workflowClassesMock.mockResolvedValueOnce([{ id: "class-1", capacity: change === "capacity" ? 9 : 8, _count: { reservations: change === "count" ? 9 : 8 }, ...(change === "class-time" ? { startsAt: new Date("2040-02-01") } : {}) }]);
      confirmSubmissionCoreMock.mockResolvedValueOnce({ paymentId: "p1", reservationIds: ["r1"] });
      await actions.confirmApplicationSubmission(formData({ payload: JSON.stringify({ submissionId: "submission-1", choices: [{ applicationId: "application-1", newChild: true, confirmOverbooking: true, overbookingConfirmation: { applicationId: "application-1", classScheduleId: "class-1", childChoice: "NEW", selectionFingerprint: '[["application-1","NEW"]]', classState: '["class-1",null,null,null]', capacity: 8, reservedCount: 8 } }] }) }));
      expect(confirmSubmissionCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ choices: [expect.objectContaining({ confirmOverbooking: false, overbookingConfirmation: undefined })] }));
    });
    describe("submission confirmation failures", () => {
      function submissionForm() {
        return formData({ payload: JSON.stringify({
          submissionId: "submission-1",
          choices: [{ applicationId: "application-1", newChild: true, memo: "private form input" }],
        }) });
      }

      it.each([
        ["P2028", "예약 확정 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."],
        ["P2024", "데이터베이스 연결 대기 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."],
        ["P1001", "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해주세요."],
      ])("classifies Prisma %s before the generic submission error and logs only its code", async (code, error) => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        confirmSubmissionCoreMock.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private database details", {
          code, clientVersion: "6.19.3", meta: { privateDetails: "private input values" },
        }));

        await expect(actions.confirmApplicationSubmission(submissionForm())).resolves.toEqual({ status: "result-unknown", submissionId: "submission-1", applicationIds: ["application-1"], error });

        expect(consoleError.mock.calls).toEqual([
          ["[reservation-applications] failed to confirm submission:", `prisma:${code}`],
        ]);
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
      });

      it("classifies and safely logs a Prisma initialization errorCode", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        confirmSubmissionCoreMock.mockRejectedValueOnce(new Prisma.PrismaClientInitializationError(
          "private connection details", "6.19.3", "P1001",
        ));

        await expect(actions.confirmApplicationSubmission(submissionForm())).resolves.toEqual({
          status: "result-unknown", submissionId: "submission-1", applicationIds: ["application-1"],
          error: "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해주세요.",
        });

        expect(consoleError.mock.calls).toEqual([
          ["[reservation-applications] failed to confirm submission:", "prisma:P1001"],
        ]);
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
      });

      it.each([
        ["an unclassified Prisma request error", new Prisma.PrismaClientKnownRequestError("private database details", {
          code: "P2002", clientVersion: "6.19.3", meta: { privateDetails: "private input values" },
        }), "prisma:P2002"],
        ["an unclassified initialization error", new Prisma.PrismaClientInitializationError(
          "private connection details", "6.19.3", "P1000",
        ), "prisma:P1000"],
        ["an initialization error without a code", new Prisma.PrismaClientInitializationError(
          "private connection details", "6.19.3",
        ), "PrismaClientInitializationError"],
        ["an unexpected Error", new Error("private input values"), "Error"],
        ["a plain object with a matching code", { code: "P1001", message: "private input values" }, "unknown"],
        ["a string", "private input values", "unknown"],
        ["null", null, "unknown"],
        ["undefined", undefined, "unknown"],
      ])("retains the generic response and safe diagnostics for %s", async (_label, error, logDescription) => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        confirmSubmissionCoreMock.mockRejectedValueOnce(error);

        await expect(actions.confirmApplicationSubmission(submissionForm())).resolves.toEqual({
          status: "result-unknown", submissionId: "submission-1", applicationIds: ["application-1"],
          error: "예약 확정 결과가 불명확합니다. 재확정하지 말고 최신 예약·결제 상태를 조회해주세요.",
        });

        expect(consoleError.mock.calls).toEqual([
          ["[reservation-applications] failed to confirm submission:", logDescription],
        ]);
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
      });

      it("preserves the bound overbooking confirmation without logging or revalidating", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const selectionFingerprint = '[["application-1","NEW"]]';
        confirmSubmissionCoreMock.mockRejectedValueOnce(new ApplicationSubmissionOverbookingConfirmationError(
          "application-1", "class-1", "NEW", selectionFingerprint, 8, 8,
        ));

        await expect(actions.confirmApplicationSubmission(submissionForm())).resolves.toEqual({
          status: "failure", submissionId: "submission-1", applicationIds: ["application-1"],
          overbookingConfirmation: {
            applicationId: "application-1", classScheduleId: "class-1", childChoice: "NEW",
            selectionFingerprint, classState: '["class-1",null,null,null]', capacity: 8, reservedCount: 8, overByAfterCreate: 1,
          },
        });
        expect(consoleError).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
      });
    });

    it("confirms a new child and redirects to the reservation", async () => {
      confirmCoreMock.mockResolvedValueOnce({ reservationId: "reservation-1", childId: "child-1" });

      await expect(
        actions.confirmReservationApplication("application-1", {}, formData({ childChoice: "NEW", memo: "메모" })),
      ).rejects.toThrow("REDIRECT:/reservations/reservation-1");

      expect(confirmCoreMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          applicationId: "application-1",
          childChoice: { type: "NEW" },
          memo: "메모",
          confirmOverbooking: false,
          actorUserId: "admin-1",
        }),
      );
      expect(revalidatePath).toHaveBeenCalledWith("/reservation-applications");
      expect(revalidatePath).toHaveBeenCalledWith("/reservation-applications/application-1");
      expect(revalidatePath).toHaveBeenCalledWith("/reservations");
    });

    it("binds overbooking confirmation to the same application and child choice", async () => {
      confirmCoreMock.mockResolvedValue({ reservationId: "reservation-1", childId: "child-9" });
      const confirmed = { confirmOverbooking: "true", confirmedApplicationId: "application-1" };

      await expect(
        actions.confirmReservationApplication(
          "application-1",
          {},
          formData({ childChoice: "child-9", ...confirmed, confirmedChildChoice: "child-9" }),
        ),
      ).rejects.toThrow("REDIRECT");
      expect(confirmCoreMock).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ childChoice: { type: "EXISTING", childId: "child-9" }, confirmOverbooking: true }),
      );

      await expect(
        actions.confirmReservationApplication(
          "application-1",
          {},
          formData({ childChoice: "child-9", ...confirmed, confirmedChildChoice: "NEW" }),
        ),
      ).rejects.toThrow("REDIRECT");
      expect(confirmCoreMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ confirmOverbooking: false }));

      await expect(
        actions.confirmReservationApplication(
          "application-2",
          {},
          formData({ childChoice: "child-9", ...confirmed, confirmedChildChoice: "child-9" }),
        ),
      ).rejects.toThrow("REDIRECT");
      expect(confirmCoreMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ confirmOverbooking: false }));
    });

    it("returns the overbooking warning state instead of confirming", async () => {
      confirmCoreMock.mockRejectedValueOnce(new OverbookingConfirmationRequiredError(8, 8));

      const state = await actions.confirmReservationApplication(
        "application-1",
        {},
        formData({ childChoice: "NEW" }),
      );

      expect(state.overbookingConfirmation).toEqual({
        applicationId: "application-1",
        childChoice: "NEW",
        capacity: 8,
        reservedCount: 8,
        overByAfterCreate: 1,
      });
    });

    it("maps core failures to messages and keeps the typed values", async () => {
      confirmCoreMock.mockRejectedValueOnce(new ApplicationDepositNotConfirmedError());

      const state = await actions.confirmReservationApplication(
        "application-1",
        {},
        formData({ childChoice: "NEW", memo: "메모" }),
      );

      expect(state.formError).toBe("입금 확인을 먼저 기록해주세요.");
      expect(state.values).toEqual({ childChoice: "NEW", memo: "메모" });
    });

    it.each([
      ["P2028", "예약 확정 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."],
      ["P2024", "데이터베이스 연결 대기 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."],
      ["P1001", "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해주세요."],
    ])("returns a friendly form error for Prisma %s without exposing error details", async (code, formError) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      confirmCoreMock.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private database details", {
        code,
        clientVersion: "6.19.3",
        meta: { privateDetails: "private input values" },
      }));

      await expect(actions.confirmReservationApplication(
        "application-1", {}, formData({ childChoice: "NEW", memo: "메모" }),
      )).resolves.toEqual({ formError, values: { childChoice: "NEW", memo: "메모" } });

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "[reservation-applications] failed to confirm application:", `prisma:${code}`,
      );
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("classifies the P1001 errorCode on a Prisma initialization failure", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      confirmCoreMock.mockRejectedValueOnce(new Prisma.PrismaClientInitializationError(
        "private connection details", "6.19.3", "P1001",
      ));

      await expect(actions.confirmReservationApplication(
        "application-1", {}, formData({ childChoice: "child-9", memo: "메모" }),
      )).resolves.toEqual({
        formError: "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해주세요.",
        values: { childChoice: "child-9", memo: "메모" },
      });

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "[reservation-applications] failed to confirm application:", "prisma:P1001",
      );
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it.each([
      ["another Prisma request error", new Prisma.PrismaClientKnownRequestError("private database details", {
        code: "P2002", clientVersion: "6.19.3", meta: { privateDetails: "private input values" },
      }), "prisma:P2002"],
      ["another Prisma initialization error", new Prisma.PrismaClientInitializationError(
        "private connection details", "6.19.3", "P1000",
      ), "prisma:P1000"],
      ["an unexpected Error", new Error("private input values"), "Error"],
      ["a non-Error object", { code: "P1001", message: "private input values" }, "unknown"],
      ["a string", "private input values", "unknown"],
      ["null", null, "unknown"],
      ["undefined", undefined, "unknown"],
    ])("returns a generic form error for %s instead of throwing", async (_label, error, logDescription) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      confirmCoreMock.mockRejectedValueOnce(error);

      await expect(actions.confirmReservationApplication(
        "application-1", {}, formData({ childChoice: "NEW", memo: "메모" }),
      )).resolves.toEqual({
        formError: "예약 확정에 실패했습니다. 다시 시도해주세요.",
        values: { childChoice: "NEW", memo: "메모" },
      });

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "[reservation-applications] failed to confirm application:", logDescription,
      );
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("requires a child choice before calling the core", async () => {
      const state = await actions.confirmReservationApplication("application-1", {}, formData({ memo: "메모" }));

      expect(state.errors?.childChoice?.[0]).toBe("연결할 아이를 선택해주세요");
      expect(confirmCoreMock).not.toHaveBeenCalled();
    });

    it("requires a reason to reject and records REJECTED with the admin", async () => {
      const missing = await actions.rejectReservationApplication("application-1", {}, formData({ resolutionNote: " " }));
      expect(missing.errors?.resolutionNote?.[0]).toBe("사유를 입력해주세요");
      expect(closeCoreMock).not.toHaveBeenCalled();

      closeCoreMock.mockResolvedValueOnce(undefined);
      await expect(
        actions.rejectReservationApplication("application-1", {}, formData({ resolutionNote: "정원 마감" })),
      ).rejects.toThrow("REDIRECT:/reservation-applications/application-1");
      expect(closeCoreMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: "REJECTED", resolutionNote: "정원 마감", actorUserId: "admin-1" }),
      );
    });

    it("records CANCELLED for guardian-requested cancellations", async () => {
      closeCoreMock.mockResolvedValueOnce(undefined);
      await expect(
        actions.cancelReservationApplication("application-1", {}, formData({ resolutionNote: "보호자 요청" })),
      ).rejects.toThrow("REDIRECT");
      expect(closeCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "CANCELLED" }));
    });

    it("reports an already processed deposit confirmation", async () => {
      depositCoreMock.mockRejectedValueOnce(new ApplicationNotPendingError());

      await expect(actions.confirmApplicationDeposit("application-1")).resolves.toEqual({
        error: "이미 입금 확인되었거나 처리가 끝난 신청입니다.",
      });
    });

    it("purges expired applications and customers as the current admin and reports the counts", async () => {
      purgeCoreMock.mockResolvedValueOnce({ purgedApplicationCount: 2, purgedChildCount: 1, hasMore: true });

      await expect(actions.purgeExpiredPersonalData()).resolves.toEqual({
        purgedApplicationCount: 2,
        purgedChildCount: 1,
        hasMore: true,
      });
      expect(purgeCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: "admin-1" }));
    });

    it("tells a purged child apart from a missing or inactive child when confirming (MSG-1)", async () => {
      confirmCoreMock.mockRejectedValueOnce(new ChildPersonalDataPurgedError());
      const purged = await actions.confirmReservationApplication(
        "application-1",
        {},
        formData({ childChoice: "child-purged" }),
      );
      expect(purged.formError).toBe(
        "보관기간이 지나 개인정보를 파기한 아이에게는 예약할 수 없습니다. 새 아이로 등록해 확정해주세요.",
      );
      expect(purged.formError).not.toContain("다시 활성화");

      confirmCoreMock.mockRejectedValueOnce(new ChildNotFoundError());
      const missing = await actions.confirmReservationApplication("application-1", {}, formData({ childChoice: "gone" }));
      expect(missing.formError).toBe("선택한 아이를 찾을 수 없습니다.");

      confirmCoreMock.mockRejectedValueOnce(new ChildNotActiveError());
      const inactive = await actions.confirmReservationApplication(
        "application-1",
        {},
        formData({ childChoice: "child-inactive" }),
      );
      expect(inactive.formError).toContain("다시 활성화");
    });

    it("blocks retired unversioned issuance and locks a versioned legacy stop", async () => {
      stopCoreMock.mockResolvedValueOnce(undefined);
      expect((await actions.issueApplicationLink("class-1")).error).toBeTruthy();
      expect((await actions.issueApplicationGroupLink("group-1")).error).toBeTruthy();
      expect((await actions.createApplicationGroup(new FormData())).error).toBeTruthy();
      expect((await actions.stopApplicationLink("class-1")).error).toBeTruthy();
      expect(issueCoreMock).not.toHaveBeenCalled(); expect(createGroupCoreMock).not.toHaveBeenCalled(); expect(issueGroupCoreMock).not.toHaveBeenCalled();
      const revision = "a".repeat(64);
      issueCoreMock.mockResolvedValueOnce({ token: "legacy-new-address-must-not-leave-action" });
      await expect(actions.issueApplicationLink("class-1", revision)).resolves.toEqual({});
      expect(issueCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classScheduleId: "class-1", revision, actorUserId: adminPrincipal.userId }));
      expect(revalidatePath).toHaveBeenCalledWith("/classes/class-1");
      await expect(actions.stopApplicationLink("class-1", revision)).resolves.toEqual({});
      expect(stopCoreMock).toHaveBeenCalledWith(expect.anything(), { classScheduleId: "class-1", revision });
    });
  });
});


it("validates atomic issuance and returns only its one-time receipt; metadata replay does not manufacture a token", async () => {
  requireAdminMock.mockResolvedValue(adminPrincipal);
  const input = { operationId: crypto.randomUUID(), kind: "single", classScheduleIds: ["class-1"], revisions: { "class-1": "a".repeat(64) } };
  atomicIssueMock.mockResolvedValueOnce({ groupId: "group", linkId: "link", token: "one-time", replayed: false, active: true });
  expect(await actions.issueClassApplicationLink(input)).toMatchObject({ token: "one-time", replayed: false });
  atomicIssueMock.mockResolvedValueOnce({ groupId: "group", linkId: "link", replayed: true, active: false });
  const replay = await actions.issueClassApplicationLink(input); expect(replay.token).toBeUndefined(); expect(replay.active).toBe(false);
  const count = atomicIssueMock.mock.calls.length;
  expect((await actions.issueClassApplicationLink({ ...input, operationId: "invalid" })).error).toBeTruthy(); expect(atomicIssueMock.mock.calls).toHaveLength(count);
});


describe("Phase 5 bank/resolution action adapters", () => {
  const bank = () => formData({ amount: "30000", payerName: "SYNTHETIC_ACTUAL_PAYER", depositedAt: "2026-01-01T09:30", idempotencyKey: "phase5-explicit-deposit-key" });
  const transfer = () => formData({ amount: "20000", reason: "SYNTHETIC_RETURN_REASON", returnedAt: "2026-01-01T09:30", idempotencyKey: "phase5-explicit-return-key", observedAmount: "60000", observedReturnedAmount: "0" });
  beforeEach(() => {
    vi.clearAllMocks(); requireAdminMock.mockResolvedValue(adminPrincipal);
    workflowDepositMock.mockResolvedValue(null); workflowReturnMock.mockResolvedValue(null);
    workflowLedgerMock.mockResolvedValue({ applications: [{ id: "application-1", status: "SUBMITTED", quotedAmount: 100000, paymentMapping: null }], deposits: [], returnObligations: [] });
    workflowObligationMock.mockResolvedValue({ submissionId: "submission-1" });
    workflowLockMock.mockResolvedValue([{ id: "submission-1", amount: 60000, returnedAmount: 0, resolvedAt: null }]);
    workflowTransactionMock.mockImplementation((callback) => callback({ $queryRaw: workflowLockMock, reservationApplicationSubmission: { findUnique: workflowLedgerMock }, applicationDeposit: { findUnique: workflowDepositMock }, applicationReturn: { findUnique: workflowReturnMock }, returnObligation: { findUnique: workflowObligationMock } }));
    recordDepositCoreMock.mockResolvedValue({ depositId: "deposit-1" }); recordReturnCoreMock.mockResolvedValue({ returnId: "return-1" });
    applicationLookupMock.mockResolvedValue({ submissionId: "submission-1" }); closeReturnCoreMock.mockResolvedValue(undefined);
  });
  it("passes actual payer/amount/KST date and the unchanged key to the existing core under the submission lock", async () => {
    expect(await actions.recordApplicationDeposit("submission-1", bank())).toEqual({ status: "success", receiptId: "deposit-1", submissionId: "submission-1" });
    expect(recordDepositCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 30000, payerName: "SYNTHETIC_ACTUAL_PAYER", depositedAt: new Date("2026-01-01T00:30:00Z"), idempotencyKey: "phase5-explicit-deposit-key" }));
    expect(workflowLockMock.mock.invocationCallOrder[0]).toBeLessThan(workflowDepositMock.mock.invocationCallOrder[0]!);
    expect(workflowLedgerMock).toHaveBeenCalledTimes(2); expect(confirmSubmissionCoreMock).not.toHaveBeenCalled();
  });
  it.each(["amount", "payerName", "depositedAt"])("blocks same-key changed %s before calling the core", async (field) => {
    const record = { id: "deposit-1", submissionId: "submission-1", amount: 30000, payerName: "SYNTHETIC_ACTUAL_PAYER", depositedAt: new Date("2026-01-01T00:30:00Z") };
    workflowDepositMock.mockResolvedValue({ ...record, [field]: field === "amount" ? 1 : field === "payerName" ? "DIFFERENT" : new Date(0) });
    expect((await actions.recordApplicationDeposit("submission-1", bank())).status).toBe("failure"); expect(recordDepositCoreMock).not.toHaveBeenCalled();
  });
  it("keeps an already committed receipt successful even when cache invalidation fails", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error("SYNTHETIC_INVALIDATION_FAILURE"); });
    expect((await actions.recordApplicationDeposit("submission-1", bank())).status).toBe("success");
  });
  it("distinguishes uncertain database outcomes and never retries the core", async () => {
    recordDepositCoreMock.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_DB_ERROR"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await actions.recordApplicationDeposit("submission-1", bank()); expect(result.status).toBe("result-unknown");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE"); expect(recordDepositCoreMock).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
  it.each(["deposit", "return", "resolution"])("blocks %s against unknown quotes/invalid ledgers before any mutation", async (kind) => {
    workflowLedgerMock.mockResolvedValue({ applications: [{ id: "application-1", status: "SUBMITTED", quotedAmount: null, paymentMapping: null }], deposits: [], returnObligations: [] });
    const result = kind === "deposit" ? await actions.recordApplicationDeposit("submission-1", bank()) : kind === "return" ? await actions.recordApplicationReturn("obligation-1", transfer()) : await actions.resolveApplicationWorkflow("application-1", "REJECTED", formData({ resolutionNote: "합성 반려" }));
    expect(result.status).toBe("failure"); expect(recordDepositCoreMock).not.toHaveBeenCalled(); expect(recordReturnCoreMock).not.toHaveBeenCalled(); expect(closeReturnCoreMock).not.toHaveBeenCalled();
  });
  it("requires explicit return observations and rejects stale/completed obligations", async () => {
    const missing = transfer(); missing.delete("observedAmount"); expect((await actions.recordApplicationReturn("obligation-1", missing)).status).toBe("failure");
    workflowLockMock.mockResolvedValue([{ id: "obligation-1", amount: 60000, returnedAmount: 20000, resolvedAt: null }]);
    expect((await actions.recordApplicationReturn("obligation-1", transfer())).status).toBe("failure");
    workflowLockMock.mockResolvedValue([{ id: "obligation-1", amount: 60000, returnedAmount: 60000, resolvedAt: new Date() }]);
    expect((await actions.recordApplicationReturn("obligation-1", transfer())).status).toBe("failure"); expect(recordReturnCoreMock).not.toHaveBeenCalled();
  });
  it("recognizes a matching return replay before stale-observation checks, but rejects changed payload", async () => {
    const prior = { id: "return-1", returnObligationId: "obligation-1", amount: 20000, reason: "SYNTHETIC_RETURN_REASON", returnedAt: new Date("2026-01-01T00:30:00Z") };
    workflowReturnMock.mockResolvedValue(prior); workflowLockMock.mockResolvedValue([{ id: "obligation-1", amount: 60000, returnedAmount: 20000, resolvedAt: null }]);
    expect((await actions.recordApplicationReturn("obligation-1", transfer())).status).toBe("success");
    workflowReturnMock.mockResolvedValue({ ...prior, amount: 10000 }); recordReturnCoreMock.mockClear();
    expect((await actions.recordApplicationReturn("obligation-1", transfer())).status).toBe("failure"); expect(recordReturnCoreMock).not.toHaveBeenCalled();
  });
  it("receipt recovery is read-only and distinguishes absent, matching, changed and foreign targets", async () => {
    expect(await actions.lookupWorkflowReceipt("deposit", "submission-1", "phase5-explicit-deposit-key", bank())).toMatchObject({ status: "failure", code: "not-found" });
    workflowDepositMock.mockResolvedValue({ id: "deposit-1", submissionId: "submission-1", amount: 30000, payerName: "SYNTHETIC_ACTUAL_PAYER", depositedAt: new Date("2026-01-01T00:30:00Z") });
    expect((await actions.lookupWorkflowReceipt("deposit", "submission-1", "phase5-explicit-deposit-key", bank())).status).toBe("success");
    const changed = bank(); changed.set("amount", "30001"); expect((await actions.lookupWorkflowReceipt("deposit", "submission-1", "phase5-explicit-deposit-key", changed)).status).toBe("failure");
    expect((await actions.lookupWorkflowReceipt("deposit", "foreign", "phase5-explicit-deposit-key", bank())).status).toBe("failure"); expect(recordDepositCoreMock).not.toHaveBeenCalled();
  });
  it.each(["REJECTED", "CANCELLED"] as const)("requires the child-specific %s reason and delegates only that child", async (kind) => {
    expect((await actions.resolveApplicationWorkflow("application-1", kind, formData({ resolutionNote: " " }))).status).toBe("failure");
    expect((await actions.resolveApplicationWorkflow("application-1", kind, formData({ resolutionNote: " 합성 사유 " }))).status).toBe("success");
    expect(closeReturnCoreMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ applicationId: "application-1", status: kind, resolutionNote: "합성 사유" }));
  });
});
