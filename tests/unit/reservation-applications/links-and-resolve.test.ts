import { describe, expect, it, vi } from "vitest";
import {
  ApplicationLinkClassClosedError,
  ApplicationLinkNotFoundError,
  ApplicationNotPendingError,
} from "@/lib/reservation-applications/errors";
import { issueApplicationLinkCore, stopApplicationLinkCore } from "@/server/reservation-applications/links";
import {
  closeReservationApplicationCore,
  confirmApplicationDepositCore,
} from "@/server/reservation-applications/resolve";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const FUTURE = new Date("2026-10-02T01:00:00.000Z");

function linkClient(classSchedule: unknown) {
  const findUnique = vi.fn(async () => classSchedule);
  const upsert = vi.fn(async () => ({}));
  const updateMany = vi.fn(async () => ({ count: 1 }));
  return {
    client: { classSchedule: { findUnique }, reservationApplicationLink: { upsert, updateMany } } as never,
    upsert,
    updateMany,
  };
}

describe("application link core", () => {
  it("creates or reissues one link per class with a fresh token", async () => {
    const { client, upsert } = linkClient({ status: "SCHEDULED", startsAt: FUTURE });

    const result = await issueApplicationLinkCore(client, {
      classScheduleId: "class-1",
      actorUserId: "admin-1",
      now: NOW,
      generateToken: () => "n".repeat(32),
    });

    expect(result).toEqual({ token: "n".repeat(32) });
    const linkData = { token: "n".repeat(32), isActive: true, issuedAt: NOW, issuedById: "admin-1" };
    expect(upsert).toHaveBeenCalledWith({
      where: { classScheduleId: "class-1" },
      create: { classScheduleId: "class-1", ...linkData },
      update: linkData,
    });
  });

  it("refuses to issue links for missing, cancelled or started classes", async () => {
    await expect(
      issueApplicationLinkCore(linkClient(null).client, { classScheduleId: "x", actorUserId: "admin-1", now: NOW }),
    ).rejects.toBeInstanceOf(ApplicationLinkNotFoundError);

    for (const classSchedule of [
      { status: "CANCELLED", startsAt: FUTURE },
      { status: "SCHEDULED", startsAt: NOW },
    ]) {
      const { client, upsert } = linkClient(classSchedule);
      await expect(
        issueApplicationLinkCore(client, { classScheduleId: "class-1", actorUserId: "admin-1", now: NOW }),
      ).rejects.toBeInstanceOf(ApplicationLinkClassClosedError);
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it("stops only an active link", async () => {
    const { client, updateMany } = linkClient(null);
    await stopApplicationLinkCore(client, { classScheduleId: "class-1" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { classScheduleId: "class-1", isActive: true },
      data: { isActive: false },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(stopApplicationLinkCore(client, { classScheduleId: "class-1" })).rejects.toBeInstanceOf(
      ApplicationLinkNotFoundError,
    );
  });
});

function applicationClient(count = 1) {
  const updateMany = vi.fn(async () => ({ count }));
  return { client: { reservationApplication: { updateMany } } as never, updateMany };
}

describe("application resolution core", () => {
  it("records deposit confirmation only once for a pending application", async () => {
    const { client, updateMany } = applicationClient();

    await confirmApplicationDepositCore(client, { applicationId: "application-1", actorUserId: "admin-1", now: NOW });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "application-1", status: "SUBMITTED", depositConfirmedAt: null },
      data: { depositConfirmedAt: NOW, depositConfirmedById: "admin-1" },
    });
    await expect(
      confirmApplicationDepositCore(applicationClient(0).client, {
        applicationId: "application-1",
        actorUserId: "admin-1",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ApplicationNotPendingError);
  });

  it.each(["REJECTED", "CANCELLED"] as const)("closes a pending application as %s with the reason", async (status) => {
    const { client, updateMany } = applicationClient();

    await closeReservationApplicationCore(client, {
      applicationId: "application-1",
      status,
      resolutionNote: "테스트 사유",
      actorUserId: "admin-1",
      now: NOW,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "application-1", status: "SUBMITTED" },
      data: { status, resolvedAt: NOW, resolvedById: "admin-1", resolutionNote: "테스트 사유" },
    });
  });

  it("refuses to close an application that is no longer pending", async () => {
    await expect(
      closeReservationApplicationCore(applicationClient(0).client, {
        applicationId: "application-1",
        status: "REJECTED",
        resolutionNote: "테스트 사유",
        actorUserId: "admin-1",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ApplicationNotPendingError);
  });
});
