import { describe, expect, it } from "vitest";
import {
  closureApprovalInputSchema, closureNextReviewAt, executeClosureInputSchema, lookupApprovalInputSchema,
  pollEligibility, pollRowDeliveryInputSchema, responsibilityReviewInputSchema, sevenDayReviewInputSchema,
} from "@/server/kakao/review-actions";
import { syntheticLookupBinding } from "@/server/kakao/budget";

describe("pollEligibility", () => {
  const now = new Date("2026-11-07T10:00:00.000Z");
  it("rejects a lookup within 5 minutes of the last one", () => {
    expect(pollEligibility(new Date(now.getTime() - 4 * 60 * 1000 - 59 * 1000), false, now)).toEqual({ ok: false, reason: "too_soon" });
    expect(pollEligibility(new Date(now.getTime() - 1000), false, now)).toEqual({ ok: false, reason: "too_soon" });
  });
  it("allows a lookup exactly 5 minutes after the last one", () => {
    expect(pollEligibility(new Date(now.getTime() - 5 * 60 * 1000), false, now)).toEqual({ ok: true });
  });
  it("allows a first lookup with no prior lookup", () => {
    expect(pollEligibility(null, false, now)).toEqual({ ok: true });
  });
  it("rejects while a lookup is in flight, regardless of interval", () => {
    expect(pollEligibility(null, true, now)).toEqual({ ok: false, reason: "lookup_in_flight" });
    expect(pollEligibility(new Date(now.getTime() - 60 * 60 * 1000), true, now)).toEqual({ ok: false, reason: "lookup_in_flight" });
  });
});

describe("closureNextReviewAt", () => {
  it("is exactly 30 days after the closure time", () => {
    const at = new Date("2026-11-07T09:30:00.000Z");
    expect(closureNextReviewAt(at)).toEqual(new Date("2026-12-07T09:30:00.000Z"));
    expect(closureNextReviewAt(at).getTime() - at.getTime()).toBe(30 * 86400000);
  });
});

describe("lookup binding determinism", () => {
  const base = { commandId: "cmd-1", slotId: "slot-1", actorId: "executor-1", approvalId: "appr-1", day: "2026-11-07", month: "2026-11" };
  it("returns the same binding for the same inputs", () => {
    expect(syntheticLookupBinding(base)).toBe(syntheticLookupBinding({ ...base }));
  });
  it("changes when the day changes", () => {
    expect(syntheticLookupBinding({ ...base, day: "2026-11-08" })).not.toBe(syntheticLookupBinding(base));
  });
  it("changes when the month changes", () => {
    expect(syntheticLookupBinding({ ...base, day: "2026-12-07", month: "2026-12" })).not.toBe(syntheticLookupBinding(base));
  });
  it("changes when the command, slot, executor, or approval changes", () => {
    expect(syntheticLookupBinding({ ...base, commandId: "cmd-2" })).not.toBe(syntheticLookupBinding(base));
    expect(syntheticLookupBinding({ ...base, slotId: "slot-2" })).not.toBe(syntheticLookupBinding(base));
    expect(syntheticLookupBinding({ ...base, actorId: "executor-2" })).not.toBe(syntheticLookupBinding(base));
    expect(syntheticLookupBinding({ ...base, approvalId: "appr-2" })).not.toBe(syntheticLookupBinding(base));
  });
});

describe("review action input validation", () => {
  const at = new Date("2026-11-07T10:00:00.000Z");
  it("accepts valid inputs", () => {
    expect(sevenDayReviewInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1", at })).toMatchObject({ dispatchId: "d1" });
    expect(responsibilityReviewInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1", at })).toMatchObject({ dispatchId: "d1" });
    expect(closureApprovalInputSchema.parse({ dispatchId: "d1", commandId: "c1", approvalId: "ap1", evidenceId: "ev-1", actorId: "a1", at })).toMatchObject({ evidenceId: "ev-1" });
    expect(executeClosureInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1", approvalId: "ap1", evidenceId: "ev-1", at })).toMatchObject({ approvalId: "ap1" });
    expect(lookupApprovalInputSchema.parse({ slotId: "s1", commandId: "c1", approvalId: "ap1", executorId: "e1", actorId: "a1", at })).toMatchObject({ slotId: "s1" });
    expect(pollRowDeliveryInputSchema.parse({ slotId: "s1", commandId: "c1", approvalId: "ap1", actorId: "a1", at })).toMatchObject({ slotId: "s1" });
  });
  it("rejects invalid identifiers", () => {
    expect(() => sevenDayReviewInputSchema.parse({ dispatchId: "bad id!", commandId: "c1", actorId: "a1", at })).toThrow();
    expect(() => closureApprovalInputSchema.parse({ dispatchId: "d1", commandId: "c1", approvalId: "ap1", evidenceId: "evidence with spaces", actorId: "a1", at })).toThrow();
    expect(() => lookupApprovalInputSchema.parse({ slotId: "", commandId: "c1", approvalId: "ap1", executorId: "e1", actorId: "a1", at })).toThrow();
    expect(() => pollRowDeliveryInputSchema.parse({ slotId: "s1", commandId: "c1", approvalId: "a".repeat(129), actorId: "a1", at })).toThrow();
  });
  it("rejects non-date times and missing fields", () => {
    expect(() => sevenDayReviewInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1", at: "2026-11-07" })).toThrow();
    expect(() => responsibilityReviewInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1" })).toThrow();
    expect(() => executeClosureInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1", approvalId: "ap1", at })).toThrow();
    expect(() => lookupApprovalInputSchema.parse({ slotId: "s1", commandId: "c1", approvalId: "ap1", executorId: "e1", actorId: "a1" })).toThrow();
  });
  it("rejects unknown extra fields", () => {
    expect(() => sevenDayReviewInputSchema.parse({ dispatchId: "d1", commandId: "c1", actorId: "a1", at, extra: "no" })).toThrow();
  });
});
