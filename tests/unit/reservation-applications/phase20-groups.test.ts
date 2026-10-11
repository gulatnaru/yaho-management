import { describe, expect, it, vi } from "vitest";
import { ApplicationClosedError, ApplicationLinkClassClosedError } from "@/lib/reservation-applications/errors";
import { groupSubmissionSchema } from "@/lib/reservation-applications/phase20-validation";
import { issueApplicationGroupLinkCore, issueCompanionInviteCore, stopApplicationGroupCore, submitApplicationGroupCore, updateApplicationGroupCore } from "@/server/reservation-applications/groups";

const submission = groupSubmissionSchema.parse({ guardianName: "보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER", declaredPayerName: "입금자", children: [{ classScheduleId: "class-1", childName: "아이", childBirthDate: "2020-01-01", childGender: "UNSPECIFIED", programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true, photoShareConsent: false, photoMarketingConsent: false }] });

function queryText(query: unknown): string {
  if (Array.isArray(query)) return query.join("");
  if (query && typeof query === "object" && "strings" in query) {
    return (query as { strings?: readonly string[] }).strings?.join("") ?? "";
  }
  return "";
}

describe("Phase 20 application groups", () => {
  it("fails closed before any write when DB-owned bank settings are not ready", async () => {
    const transaction = vi.fn();
    await expect(submitApplicationGroupCore({ $transaction: transaction } as never, { token: "opaque", data: submission, consentVersion: "v1", now: new Date(), configReady: false, completionTokenHash: "completion", completionExpiresAt: new Date(), deviceTokenHash: "device", deviceExpiresAt: new Date() })).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates an opaque companion invite limited by class end or fourteen days", async () => {
    const companionInvite = { create: vi.fn().mockResolvedValue({}) };
    const companionGroup = { create: vi.fn().mockResolvedValue({ id: "companion-group-1" }) };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "locked" }]),
      reservationApplicationSubmission: { findUnique: vi.fn().mockResolvedValue({ id: "submission-1", groupId: "group-1", personalDataPurgedAt: null, applications: [{ status: "SUBMITTED" }] }) },
      reservationApplicationGroup: { findUnique: vi.fn().mockResolvedValue({ isActive: true, classes: [{ classSchedule: { id: "class-1", status: "SCHEDULED", startsAt: new Date("2026-10-01T12:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z"), applicationPrice: 10_000 } }] }) },
      classSchedule: { findMany: vi.fn().mockResolvedValue([{ id: "class-1", status: "SCHEDULED", startsAt: new Date("2026-10-01T12:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z"), applicationPrice: 10_000 }]) },
      companionGroup,
      companionInvite,
    };
    const result = await issueCompanionInviteCore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never, { submissionId: "submission-1", now: new Date("2026-10-01T00:00:00Z"), classEndsAt: new Date("2026-10-02T00:00:00Z"), generateToken: () => "x".repeat(64) });
    expect(result.expiresAt).toEqual(new Date("2026-10-02T00:00:00Z"));
    expect(companionInvite.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ groupId: "group-1", tokenHash: expect.any(String) }) }));
  });

  it.each([
    ["closed", { id: "submission-1", groupId: "group-1", personalDataPurgedAt: null, applications: [{ status: "REJECTED" }] }],
    ["purged", { id: "submission-1", groupId: "group-1", personalDataPurgedAt: new Date("2026-10-01T00:00:00Z"), applications: [{ status: "SUBMITTED" }] }],
  ])("re-reads a %s issuer after parent and application locks before capability writes", async (_state, lockedSubmission) => {
    const companionGroup = { create: vi.fn() };
    const companionInvite = { create: vi.fn() };
    const raw = vi.fn().mockResolvedValue([{ id: "locked" }]);
    const tx = {
      $queryRaw: raw,
      reservationApplicationSubmission: { findUnique: vi.fn().mockResolvedValue(lockedSubmission) },
      reservationApplicationGroup: { findUnique: vi.fn() },
      classSchedule: { findMany: vi.fn() },
      companionGroup,
      companionInvite,
    };
    const client = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never;

    await expect(issueCompanionInviteCore(client, { submissionId: "submission-1", now: new Date("2026-10-01T00:00:00Z"), classEndsAt: new Date("2026-10-02T00:00:00Z") })).rejects.toBeInstanceOf(ApplicationClosedError);

    expect(raw).toHaveBeenCalledTimes(2);
    expect(tx.reservationApplicationGroup.findUnique).not.toHaveBeenCalled();
    expect(companionGroup.create).not.toHaveBeenCalled();
    expect(companionInvite.create).not.toHaveBeenCalled();
  });

  it("locks issuer submission, applications, group, then classes before creating an invite", async () => {
    const lockTexts: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (query: unknown) => {
        lockTexts.push(queryText(query));
        return [{ id: "locked" }];
      }),
      reservationApplicationSubmission: { findUnique: vi.fn().mockResolvedValue({ id: "submission-1", groupId: "group-1", personalDataPurgedAt: null, applications: [{ status: "SUBMITTED" }] }) },
      reservationApplicationGroup: { findUnique: vi.fn().mockResolvedValue({ isActive: true, classes: [{ classSchedule: { id: "class-1", status: "SCHEDULED", startsAt: new Date("2026-10-01T12:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z"), applicationPrice: 10_000 } }] }) },
      classSchedule: { findMany: vi.fn().mockResolvedValue([{ id: "class-1", status: "SCHEDULED", startsAt: new Date("2026-10-01T12:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z"), applicationPrice: 10_000 }]) },
      companionGroup: { create: vi.fn().mockResolvedValue({ id: "companion-group-1" }) },
      companionInvite: { create: vi.fn().mockResolvedValue({}) },
    };
    const client = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never;

    await issueCompanionInviteCore(client, { submissionId: "submission-1", now: new Date("2026-10-01T00:00:00Z"), classEndsAt: new Date("2026-10-02T00:00:00Z"), generateToken: () => "x".repeat(64) });

    expect(lockTexts).toHaveLength(4);
    expect(lockTexts[0]).toContain("ReservationApplicationSubmission");
    expect(lockTexts[1]).toContain("ReservationApplication");
    expect(lockTexts[2]).toContain("ReservationApplicationGroup");
    expect(lockTexts[3]).toContain("ClassSchedule");
  });

  it("keeps membership edits scoped to future submissions and revokes old URLs on reissue or stop", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "locked" }]),
      classSchedule: { findMany: vi.fn().mockResolvedValue([{ id: "class-1", status: "SCHEDULED", startsAt: new Date("2026-11-01"), applicationPrice: 10_000 }]) },
      reservationApplicationGroup: { updateMany, findUnique: vi.fn()
        .mockResolvedValueOnce({ classes: [{ classScheduleId: "class-1" }] })
        .mockResolvedValueOnce({ id: "group-1", isActive: true, classes: [{ classSchedule: { id: "class-1", status: "SCHEDULED", startsAt: new Date("2026-11-01"), applicationPrice: 10_000 } }] }) },
      reservationApplicationGroupClass: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([{ classScheduleId: "class-1" }]) },
      reservationApplicationLink: { updateMany, create: vi.fn() },
    };
    const client = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as never;
    await updateApplicationGroupCore(client, { groupId: "group-1", classScheduleIds: ["class-1"], now: new Date("2026-10-01") });
    await issueApplicationGroupLinkCore(client, { groupId: "group-1", actorUserId: "admin-1", now: new Date("2026-10-01"), generateToken: () => "x".repeat(64) });
    await stopApplicationGroupCore(client, { groupId: "group-1" });
    expect(tx.reservationApplicationLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ groupId: "group-1", isActive: true }), data: { isActive: false } }));
    expect(tx.reservationApplicationLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ groupId: "group-1", tokenHash: expect.any(String) }) }));
  });

  it("preserves an already selected ineligible class until the ADMIN explicitly removes it, while rejecting a new one", async () => {
    const past = { id: "past-class", status: "CANCELLED", startsAt: new Date("2026-09-01"), applicationPrice: null };
    const fresh = { id: "fresh-class", status: "SCHEDULED", startsAt: new Date("2026-11-01"), applicationPrice: 10_000 };
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: "group-lock" }])
        .mockResolvedValueOnce([{ id: past.id }, { id: fresh.id }]),
      classSchedule: { findMany: vi.fn().mockResolvedValue([past, fresh]) },
      reservationApplicationGroup: { findUnique: vi.fn().mockResolvedValue({ classes: [{ classScheduleId: past.id }] }) },
      reservationApplicationGroupClass: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const client = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as never;
    await expect(updateApplicationGroupCore(client, { groupId: "group-1", classScheduleIds: [past.id, fresh.id], now: new Date("2026-10-01") })).resolves.toBeUndefined();
    expect(tx.reservationApplicationGroupClass.createMany).toHaveBeenCalledWith({ data: [{ groupId: "group-1", classScheduleId: "fresh-class" }, { groupId: "group-1", classScheduleId: "past-class" }] });

    const newIneligibleTx = {
      ...tx,
      $queryRaw: vi.fn().mockResolvedValue([{ id: "locked" }]),
      classSchedule: { findMany: vi.fn().mockResolvedValue([past]) },
      reservationApplicationGroup: { findUnique: vi.fn().mockResolvedValue({ classes: [] }) },
      reservationApplicationGroupClass: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const newIneligibleClient = { $transaction: async (callback: (value: typeof newIneligibleTx) => Promise<unknown>) => callback(newIneligibleTx) } as never;
    await expect(updateApplicationGroupCore(newIneligibleClient, { groupId: "group-1", classScheduleIds: [past.id], now: new Date("2026-10-01") })).rejects.toBeInstanceOf(ApplicationLinkClassClosedError);
    expect(newIneligibleTx.reservationApplicationGroupClass.deleteMany).not.toHaveBeenCalled();
  });
});
