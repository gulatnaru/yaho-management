import { describe, expect, it, vi } from "vitest";
import {
  ApplicationLinkClassClosedError,
  ApplicationLinkNotFoundError,
  ApplicationNotPendingError,
} from "@/lib/reservation-applications/errors";
import { issueApplicationLinkCore, stopApplicationLinkCore, upgradeLegacyApplicationLinkCore } from "@/server/reservation-applications/links";
import {
  closeReservationApplicationCore,
  confirmApplicationDepositCore,
} from "@/server/reservation-applications/resolve";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const FUTURE = new Date("2026-10-02T01:00:00.000Z");

function linkClient(classSchedule: unknown) {
  const findUnique = vi.fn(async () => classSchedule);
  const upsert = vi.fn(async () => ({}));
  const linkFindUnique = vi.fn(async () => null);
  const groupFindFirst = vi.fn<() => Promise<{ id: string } | null>>(async () => null);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = { $queryRaw: vi.fn(async () => [{ id: "class-1" }]), classSchedule: { findUnique }, reservationApplicationGroup: { findFirst: groupFindFirst }, reservationApplicationLink: { findUnique: linkFindUnique, upsert, updateMany } };
  return {
    client: { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx), reservationApplicationLink: { updateMany } } as never,
    upsert,
    linkFindUnique,
    groupFindFirst,
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

  it("does not recreate a raw legacy link after the class was upgraded to a group", async () => {
    const { client, upsert, groupFindFirst } = linkClient({ status: "SCHEDULED", startsAt: FUTURE });
    groupFindFirst.mockResolvedValue({ id: "group-link-1" });
    await expect(issueApplicationLinkCore(client, { classScheduleId: "class-1", actorUserId: "admin-1", now: NOW })).rejects.toBeInstanceOf(ApplicationLinkNotFoundError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upgrades an explicit priced legacy link in place without revealing or regenerating its raw URL", async () => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "class-1" }]),
      classSchedule: { findUnique: vi.fn().mockResolvedValue({ status: "SCHEDULED", startsAt: FUTURE, applicationPrice: 10_000 }) },
      reservationApplicationLink: { findUnique: vi.fn().mockResolvedValue({ id: "link-1", token: "opaque-legacy", groupId: null }), update },
      reservationApplicationGroup: { create: vi.fn().mockResolvedValue({ id: "group-1" }) },
      reservationApplicationSettings: { findUnique: vi.fn().mockResolvedValue({ bankName: "은행", accountNumber: "123", accountHolder: "예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" }) },
    };
    const client = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as never;
    await expect(upgradeLegacyApplicationLinkCore(client, { classScheduleId: "class-1", actorUserId: "admin-1", now: NOW, configReady: true })).resolves.toEqual({ groupId: "group-1" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ classScheduleId: null, token: null, groupId: "group-1", tokenHash: expect.any(String) }) }));
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
      where: { id: "application-1", submissionId: null, status: "SUBMITTED", depositConfirmedAt: null },
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
      where: { id: "application-1", submissionId: null, status: "SUBMITTED" },
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
