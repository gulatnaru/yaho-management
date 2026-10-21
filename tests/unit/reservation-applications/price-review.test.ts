import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";
import { applicationReviewScope, issueApplicationPriceReview, verifyApplicationPriceReview, ApplicationPriceChangedError, ApplicationAlreadySubmittedError } from "@/server/reservation-applications/price-review";
import { recheckApplicationGroupPricesCore, submitApplicationGroupCore } from "@/server/reservation-applications/groups";
const token = "a".repeat(43), now = new Date("2030-01-01T00:00:00Z");
const scope = applicationReviewScope({ token });
const prices = [{ classScheduleId: "class-1", amount: 40000 }];
const child = { classScheduleId: "class-1", childName: "합성 아이", childBirthDate: "2020-01-01", childGender: "UNSPECIFIED" as const, programTerms: true as const, privacyConsent: true as const, legalGuardianConfirmation: true as const, refundTerms: true as const, photoShareConsent: false, photoMarketingConsent: false };
function harness(amount = 40000) {
  const schedule = { id: "class-1", applicationPrice: amount, status: "SCHEDULED", startsAt: new Date("2040-01-01") };
  const group = { id: "group-1", isActive: true, classes: [{ classSchedule: schedule }] };
  const write = vi.fn().mockResolvedValue({ id: "saved" });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "locked" }]),
    reservationApplicationLink: { findUnique: vi.fn().mockResolvedValue({ id: "link-1", isActive: true, group }) },
    reservationApplicationGroupClass: { findMany: vi.fn().mockResolvedValue([{ classScheduleId: "class-1" }]) },
    classSchedule: { findMany: vi.fn().mockResolvedValue([schedule]) },
    reservationApplicationSubmission: { findUnique: vi.fn().mockResolvedValue(null), create: write },
    reservationApplication: { create: write }, applicationDevice: { create: write, findFirst: vi.fn().mockResolvedValue(null) },
    deviceSubmission: { create: write },
  };
  const client = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never;
  return { tx, client, write };
}
function input(proof = issueApplicationPriceReview({ scope, prices, now }).proof) {
  return { token, data: { reviewedPriceProof: proof, consentVersion: APPLICATION_CONSENT_CONTENT.version, guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" as const, declaredPayerName: "합성 입금자", children: [child] }, consentVersion: APPLICATION_CONSENT_CONTENT.version, configReady: true, now, completionTokenHash: "completion", completionExpiresAt: new Date("2030-01-02"), deviceTokenHash: "device", deviceExpiresAt: new Date("2030-01-02") };
}
beforeEach(() => vi.stubEnv("AUTH_SECRET", "synthetic-unit-price-review-secret"));
afterEach(() => vi.unstubAllEnvs());
describe("signed Policy A price review", () => {
  it("signs assigned prices without guardian or child input and binds the raw-link scope", () => {
    const result = issueApplicationPriceReview({ scope, prices, now });
    expect(verifyApplicationPriceReview(result.proof, scope, now).prices).toEqual(prices);
    expect(() => verifyApplicationPriceReview(result.proof, applicationReviewScope({ token: "other" }), now)).toThrow(ApplicationClosedError);
    expect(Buffer.from(result.proof.split(".")[0]!, "base64url").toString()).not.toMatch(/guardian|childName|consentOriginal/);
  });
  it("rejects client changed amounts, malformed proofs, expired proofs and missing signing secret", () => {
    const review = issueApplicationPriceReview({ scope, prices, now });
    const [body, sig] = review.proof.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString()); forged.prices[0].amount = 1;
    expect(() => verifyApplicationPriceReview(`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, scope, now)).toThrow(ApplicationClosedError);
    expect(() => verifyApplicationPriceReview("invalid", scope, now)).toThrow(ApplicationClosedError);
    expect(() => verifyApplicationPriceReview(review.proof, scope, new Date("2030-01-02"))).toThrow(ApplicationClosedError);
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => issueApplicationPriceReview({ scope, prices, now })).toThrow(ApplicationClosedError);
  });
  it("rechecks only assigned valid-link prices without family writes", async () => {
    const { client, tx, write } = harness();
    const review = await recheckApplicationGroupPricesCore(client, { token, classScheduleIds: ["class-1", "class-1"], now });
    expect(review.prices).toEqual(prices); expect(write).not.toHaveBeenCalled();
    const locks = tx.$queryRaw.mock.calls.map(([parts]) => String(parts));
    expect(locks[0]).toContain("ReservationApplicationGroup"); expect(locks[2]).toContain("ClassSchedule");
  });
  it("revoked links and foreign class requests never receive prices", async () => {
    const h = harness(); h.tx.reservationApplicationLink.findUnique.mockResolvedValueOnce({ id: "link-1", isActive: false, group: { id: "group-1", isActive: true, classes: [] } } as never);
    await expect(recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], now })).rejects.toThrow(ApplicationClosedError);
    await expect(recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["foreign"], now })).rejects.toThrow(ApplicationClosedError);
    expect(h.write).not.toHaveBeenCalled();
  });
  it("a price mismatch returns a fresh signed review before any family write", async () => {
    const h = harness(65000); const payload = input(); const before = structuredClone(payload.data);
    let mismatch: unknown;
    try { await submitApplicationGroupCore(h.client, payload); } catch (error) { mismatch = error; }
    expect(mismatch).toBeInstanceOf(ApplicationPriceChangedError);
    expect((mismatch as ApplicationPriceChangedError).priceReview.prices).toEqual([{ classScheduleId: "class-1", amount: 65000 }]);
    expect(h.write).not.toHaveBeenCalled(); expect(payload.data).toEqual(before);
  });
  it("a second price change rejects the explicitly reconfirmed prior revision again", async () => {
    const proof = issueApplicationPriceReview({ scope, prices: [{ classScheduleId: "class-1", amount: 65000 }], now }).proof;
    const h = harness(70000);
    await expect(submitApplicationGroupCore(h.client, input(proof))).rejects.toThrow(ApplicationPriceChangedError);
    expect(h.write).not.toHaveBeenCalled();
  });
  it("rejects missing review, changed assignment and stale consent before writes", async () => {
    const h = harness(); const payload = input();
    await expect(submitApplicationGroupCore(h.client, { ...payload, data: { ...payload.data, reviewedPriceProof: "" } })).rejects.toThrow();
    await expect(submitApplicationGroupCore(h.client, { ...payload, data: { ...payload.data, children: [{ ...child, classScheduleId: "foreign" }] } })).rejects.toThrow(ApplicationClosedError);
    await expect(submitApplicationGroupCore(h.client, { ...payload, data: { ...payload.data, consentVersion: "stale" } })).rejects.toThrow(ApplicationClosedError);
    expect(h.write).not.toHaveBeenCalled();
  });
  it("null class price never becomes zero or a program default", async () => {
    const h = harness();
    h.tx.classSchedule.findMany.mockResolvedValue([{ id: "class-1", status: "SCHEDULED", startsAt: new Date("2040-01-01"), applicationPrice: null }] as never);
    await expect(submitApplicationGroupCore(h.client, input())).rejects.toThrow(ApplicationClosedError);
    expect(h.write).not.toHaveBeenCalled();
  });
  it("a committed operation never creates a duplicate or grants a completion cookie to a proof-only replay", async () => {
    const h = harness(); h.tx.reservationApplicationSubmission.findUnique.mockResolvedValue({ id: "saved", completionTokenHash: "owned-cookie", completionExpiresAt: new Date("2030-01-02"), personalDataPurgedAt: null } as never);
    await expect(submitApplicationGroupCore(h.client, input())).rejects.toThrow(ApplicationAlreadySubmittedError);
    await expect(submitApplicationGroupCore(h.client, { ...input(), previousCompletionTokenHash: "owned-cookie" })).resolves.toMatchObject({ submissionId: "saved", replayed: true });
    expect(h.write).not.toHaveBeenCalled();
  });
  it("wrong device capability rejects an existing-child selection without linking by phone", async () => {
    const h = harness(); const payload = input();
    await expect(submitApplicationGroupCore(h.client, { ...payload, previousDeviceTokenHash: "unowned", data: { ...payload.data, children: [{ ...child, requestedChildId: "existing" }] } })).rejects.toThrow(ApplicationClosedError);
    expect(h.write).not.toHaveBeenCalled();
  });
});
