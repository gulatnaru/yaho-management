import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { reservationApplicationSubmission: { findFirst: mocks.findFirst } } }));
import { loadApplicationCompletionView } from "@/lib/reservation-applications/completion";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";

const now = new Date("2026-10-21T00:00:00.000Z");
beforeEach(() => vi.resetAllMocks());
describe("actual completion loader fixed quote and capability regressions", () => {
  it("skips lookup entirely without a capability", async () => {
    await expect(loadApplicationCompletionView(undefined, now)).resolves.toBeNull(); expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it.each(["invalid", "expired", "purged"])("fails closed for a %s capability with the hash, future expiry and nonpurged predicate", async (token) => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(loadApplicationCompletionView(token, now)).resolves.toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { completionTokenHash: hashApplicationCapabilityToken(token), completionExpiresAt: { gt: now }, personalDataPurgedAt: null },
      select: { id: true, declaredPayerName: true, depositNotifiedAt: true, group: { select: { syntheticRunId: true, syntheticSettings: true } }, applications: { select: { id: true, childName: true, quotedAmount: true, status: true } } },
    });
    expect(JSON.stringify(mocks.findFirst.mock.calls)).not.toContain('"applicationPrice"');
  });
  it("returns only its own submitted stored quotes without deriving missing/current class prices", async () => {
    mocks.findFirst.mockResolvedValue({ id: "own-submission", declaredPayerName: "own-payer", depositNotifiedAt: now, group: { syntheticRunId: "own-run", syntheticSettings: { bankName: "own-bank" } }, applications: [
      { id: "first", childName: "own-first", quotedAmount: 12345, status: "SUBMITTED" },
      { id: "second", childName: "own-second", quotedAmount: 23456, status: "SUBMITTED" },
      { id: "legacy", childName: "legacy-null-price", quotedAmount: null, status: "SUBMITTED" },
      { id: "confirmed", childName: "terminal-child", quotedAmount: 777777, status: "CONFIRMED" },
      { id: "cancelled", childName: "cancelled-child", quotedAmount: 888888, status: "CANCELLED" },
      { id: "rejected", childName: "rejected-child", quotedAmount: 999999, status: "REJECTED" },
    ] });
    await expect(loadApplicationCompletionView("own-capability", now)).resolves.toEqual({
      submissionId: "own-submission", declaredPayerName: "own-payer", depositNotifiedAt: now, syntheticRunId: "own-run", syntheticSettings: { bankName: "own-bank" },
      applications: [{ id: "first", childName: "own-first", quotedAmount: 12345 }, { id: "second", childName: "own-second", quotedAmount: 23456 }],
    });
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
  });
  it("propagates read failure instead of replacing it with another family's completion", async () => {
    mocks.findFirst.mockRejectedValue(new Error("synthetic database unavailable"));
    await expect(loadApplicationCompletionView("own-capability", now)).rejects.toThrow("synthetic database unavailable"); expect(mocks.findFirst).toHaveBeenCalledTimes(1);
  });
});
