import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationDepositNotConfirmedError,
  ApplicationNotPendingError,
} from "@/lib/reservation-applications/errors";
import { OverbookingConfirmationRequiredError } from "@/lib/reservations/errors";

const requireAdminMock = vi.fn();
const confirmCoreMock = vi.fn();
const depositCoreMock = vi.fn();
const closeCoreMock = vi.fn();
const issueCoreMock = vi.fn();
const stopCoreMock = vi.fn();
const purgeCoreMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdminPrincipal: (...args: unknown[]) => requireAdminMock(...args),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
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

const allCores = [confirmCoreMock, depositCoreMock, closeCoreMock, issueCoreMock, stopCoreMock, purgeCoreMock];

describe("reservation application admin actions", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    for (const core of allCores) core.mockReset();
  });

  it("blocks MANAGER and TEACHER (requireAdminPrincipal → notFound) before any core runs", async () => {
    requireAdminMock.mockRejectedValue(new Error("NOT_FOUND"));

    const calls = [
      () => actions.issueApplicationLink("class-1"),
      () => actions.stopApplicationLink("class-1"),
      () => actions.confirmApplicationDeposit("application-1"),
      () => actions.confirmReservationApplication("application-1", {}, formData({ childChoice: "NEW" })),
      () => actions.rejectReservationApplication("application-1", {}, formData({ resolutionNote: "사유" })),
      () => actions.cancelReservationApplication("application-1", {}, formData({ resolutionNote: "사유" })),
      () => actions.purgeExpiredPersonalData(),
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

    it("confirms a new child and redirects to the reservation", async () => {
      confirmCoreMock.mockResolvedValueOnce({ reservationId: "reservation-1", childId: "child-1" });

      await expect(
        actions.confirmReservationApplication("application-1", {}, formData({ childChoice: "NEW", memo: "메모" })),
      ).rejects.toThrow("REDIRECT:/reservations/reservation-1");

      expect(confirmCoreMock).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          applicationId: "application-1",
          childChoice: { type: "NEW" },
          memo: "메모",
          confirmOverbooking: false,
          actorUserId: "admin-1",
        }),
      );
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
        {},
        expect.objectContaining({ childChoice: { type: "EXISTING", childId: "child-9" }, confirmOverbooking: true }),
      );

      await expect(
        actions.confirmReservationApplication(
          "application-1",
          {},
          formData({ childChoice: "child-9", ...confirmed, confirmedChildChoice: "NEW" }),
        ),
      ).rejects.toThrow("REDIRECT");
      expect(confirmCoreMock).toHaveBeenLastCalledWith({}, expect.objectContaining({ confirmOverbooking: false }));

      await expect(
        actions.confirmReservationApplication(
          "application-2",
          {},
          formData({ childChoice: "child-9", ...confirmed, confirmedChildChoice: "child-9" }),
        ),
      ).rejects.toThrow("REDIRECT");
      expect(confirmCoreMock).toHaveBeenLastCalledWith({}, expect.objectContaining({ confirmOverbooking: false }));
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
        {},
        expect.objectContaining({ status: "REJECTED", resolutionNote: "정원 마감", actorUserId: "admin-1" }),
      );
    });

    it("records CANCELLED for guardian-requested cancellations", async () => {
      closeCoreMock.mockResolvedValueOnce(undefined);
      await expect(
        actions.cancelReservationApplication("application-1", {}, formData({ resolutionNote: "보호자 요청" })),
      ).rejects.toThrow("REDIRECT");
      expect(closeCoreMock).toHaveBeenCalledWith({}, expect.objectContaining({ status: "CANCELLED" }));
    });

    it("reports an already processed deposit confirmation", async () => {
      depositCoreMock.mockRejectedValueOnce(new ApplicationNotPendingError());

      await expect(actions.confirmApplicationDeposit("application-1")).resolves.toEqual({
        error: "이미 입금 확인되었거나 처리가 끝난 신청입니다.",
      });
    });

    it("purges expired applications and customers as the current admin and reports the counts", async () => {
      purgeCoreMock.mockResolvedValueOnce({ purgedApplicationCount: 2, purgedChildCount: 1 });

      await expect(actions.purgeExpiredPersonalData()).resolves.toEqual({ purgedApplicationCount: 2, purgedChildCount: 1 });
      expect(purgeCoreMock).toHaveBeenCalledWith({}, expect.objectContaining({ actorUserId: "admin-1" }));
    });

    it("issues and stops class links as the current admin", async () => {
      issueCoreMock.mockResolvedValueOnce({ token: "n".repeat(32) });
      stopCoreMock.mockResolvedValueOnce(undefined);

      await expect(actions.issueApplicationLink("class-1")).resolves.toEqual({});
      await expect(actions.stopApplicationLink("class-1")).resolves.toEqual({});

      expect(issueCoreMock).toHaveBeenCalledWith({}, expect.objectContaining({ classScheduleId: "class-1", actorUserId: "admin-1" }));
      expect(stopCoreMock).toHaveBeenCalledWith({}, { classScheduleId: "class-1" });
    });
  });
});
