import { describe, expect, it, vi } from "vitest";
import { canShowApplicationCompletionGuide, canShowGenericApplicationCompletionGuide, markApplicationDepositNotified, type ApplicationCompletionView } from "@/lib/reservation-applications/completion";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";

describe("Phase 20 completion deposit notification", () => {
  const completion = (overrides: Partial<ApplicationCompletionView> = {}): ApplicationCompletionView => ({
    submissionId: "submission-1", declaredPayerName: "입금자", syntheticRunId: null, syntheticSettings: null,
    applications: [{ id: "application-1", childName: "아이", quotedAmount: 10_000 }], ...overrides,
  });

  it("shows a guide only for a non-empty capability and never exposes synthetic Preview data outside its lease", () => {
    expect(canShowApplicationCompletionGuide({ completion: completion({ syntheticRunId: "preview-run" }), vercelEnv: "production", previewAllowed: true })).toBe(false);
    expect(canShowApplicationCompletionGuide({ completion: completion({ syntheticRunId: "preview-run" }), vercelEnv: "preview", previewAllowed: false })).toBe(false);
    expect(canShowApplicationCompletionGuide({ completion: completion({ applications: [] }), vercelEnv: undefined, previewAllowed: true })).toBe(false);
    expect(canShowApplicationCompletionGuide({ completion: completion(), vercelEnv: "production", previewAllowed: false })).toBe(true);
    expect(canShowGenericApplicationCompletionGuide({ completion: completion(), vercelEnv: "production" })).toBe(false);
    expect(canShowGenericApplicationCompletionGuide({ completion: null, vercelEnv: "production" })).toBe(true);
    expect(canShowGenericApplicationCompletionGuide({ completion: null, vercelEnv: "preview" })).toBe(false);
  });

  it("records the first notification only while a quoted child application remains pending", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn();
    const now = new Date("2026-10-06T14:00:00.000Z");

    await expect(markApplicationDepositNotified("completion-capability", now, {
      reservationApplicationSubmission: { updateMany, findFirst },
    } as never)).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        completionTokenHash: hashApplicationCapabilityToken("completion-capability"),
        depositNotifiedAt: null,
        personalDataPurgedAt: null,
        applications: { some: { status: "SUBMITTED", quotedAmount: { not: null } } },
      }),
      data: { depositNotifiedAt: now },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("accepts an eligible repeat without another timestamp write", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn().mockResolvedValue({ id: "submission-1" });
    const client = { reservationApplicationSubmission: { updateMany, findFirst } } as never;

    await expect(markApplicationDepositNotified("completion-capability", new Date(), client)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ depositNotifiedAt: { not: null } }),
    }));
  });

  it("denies missing, terminal, purged, expired, and unknown capabilities", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn().mockResolvedValue(null);
    const client = { reservationApplicationSubmission: { updateMany, findFirst } } as never;

    await expect(markApplicationDepositNotified(undefined, new Date(), client)).resolves.toBe(false);
    await expect(markApplicationDepositNotified("expired-terminal-or-purged", new Date(), client)).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
