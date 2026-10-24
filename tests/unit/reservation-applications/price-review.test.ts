import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";
import { applicationReviewScope, issueApplicationPriceReview, verifyApplicationPriceReview, ApplicationPriceReviewExpiredError, ApplicationPriceChangedError, ApplicationAlreadySubmittedError } from "@/server/reservation-applications/price-review";
import { recheckApplicationGroupPricesCore, submitApplicationGroupCore } from "@/server/reservation-applications/groups";
const token = "a".repeat(43), now = new Date("2030-01-01T00:00:00Z");
const scope = applicationReviewScope({ token });
const expiredAt = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 1);
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
    expect(() => verifyApplicationPriceReview(review.proof, scope, new Date("2030-01-02"))).toThrow(ApplicationPriceReviewExpiredError);
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => issueApplicationPriceReview({ scope, prices, now })).toThrow(ApplicationClosedError);
  });
  it("recovers a signed proof older than two hours with current prices and the same operation before any writes", async () => {
    const h = harness(65000); const original = issueApplicationPriceReview({ scope, prices, now });
    const expiredAt = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 1);
    const renewed = await recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], reviewedPriceProof: original.proof, now: expiredAt });
    expect(renewed.prices).toEqual([{ classScheduleId: "class-1", amount: 65000 }]);
    expect(verifyApplicationPriceReview(renewed.proof, scope, expiredAt).operation).toBe(verifyApplicationPriceReview(original.proof, scope, now).operation);
    expect(h.write).not.toHaveBeenCalled();
  });
  it("normal submission at the two-hour boundary saves the reviewed amount", async () => {
    const h = harness();
    await expect(submitApplicationGroupCore(h.client, { ...input(), now: new Date(now.getTime() + 2 * 60 * 60 * 1000) })).resolves.toMatchObject({ applicationIds: ["saved"] });
    expect(h.tx.reservationApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quotedAmount: 40000 }) }));
  });
  it.each([40000, 65000])("expired submit renews current price %i without writes, preserves the draft, then permits a separate resubmit", async (amount) => {
    const h = harness(amount), payload = input();
    payload.data.children[0] = { ...child, photoShareConsent: true, photoMarketingConsent: true };
    const original = structuredClone(payload.data);
    let recovery: ApplicationPriceReviewExpiredError | undefined;
    try { await submitApplicationGroupCore(h.client, { ...payload, now: expiredAt }); } catch (error) { expect(error).toBeInstanceOf(ApplicationPriceReviewExpiredError); recovery = error as ApplicationPriceReviewExpiredError; }
    expect(recovery?.priceReview?.prices).toEqual([{ classScheduleId: "class-1", amount }]);
    expect(h.write).not.toHaveBeenCalled(); expect(payload.data).toEqual(original);
    const renewed = recovery!.priceReview!;
    expect(verifyApplicationPriceReview(renewed.proof, scope, expiredAt).operation).toBe(verifyApplicationPriceReview(payload.data.reviewedPriceProof, scope, now).operation);
    // Merely fetching the replacement does not make the old review usable.
    await expect(submitApplicationGroupCore(h.client, { ...payload, now: expiredAt })).rejects.toBeInstanceOf(ApplicationPriceReviewExpiredError);
    expect(h.write).not.toHaveBeenCalled();
    await expect(submitApplicationGroupCore(h.client, { ...payload, now: expiredAt, data: { ...payload.data, reviewedPriceProof: renewed.proof } })).resolves.toMatchObject({ applicationIds: ["saved"] });
  });
  it("rechecking expired unchanged prices still marks explicit reconfirmation required", async () => {
    const h = harness(), original = input();
    const result = await recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], reviewedPriceProof: original.data.reviewedPriceProof, now: expiredAt });
    expect(result).toMatchObject({ priceReviewExpired: true, prices }); expect(h.write).not.toHaveBeenCalled();
  });
  it.each(["tampered", "cross-group"])("expired %s proofs are rejected before scope/price access or writes", async (kind) => {
    const h = harness();
    const review = issueApplicationPriceReview({ scope: kind === "cross-group" ? applicationReviewScope({ token: "another-link" }) : scope, prices, now });
    const [body, signature] = review.proof.split(".");
    const proof = kind === "tampered" ? `${body}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}` : review.proof;
    await expect(recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], reviewedPriceProof: proof, now: expiredAt })).rejects.toBeInstanceOf(ApplicationClosedError);
    await expect(submitApplicationGroupCore(h.client, { ...input(proof), now: expiredAt })).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(h.tx.reservationApplicationLink.findUnique).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });
  it("revocation during locking rejects expired recovery before price or prior-operation lookup", async () => {
    const h = harness(), payload = input();
    h.tx.reservationApplicationLink.findUnique.mockResolvedValueOnce({ id: "link-1", isActive: true, group: { id: "group-1", isActive: true, classes: [] } } as never).mockResolvedValue({ isActive: false } as never);
    await expect(submitApplicationGroupCore(h.client, { ...payload, now: expiredAt })).rejects.toBeInstanceOf(ApplicationClosedError);
    await expect(recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], reviewedPriceProof: payload.data.reviewedPriceProof, now: expiredAt })).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(h.tx.classSchedule.findMany).not.toHaveBeenCalled(); expect(h.tx.reservationApplicationSubmission.findUnique).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });
  it.each([false, true])("lost-response then proof-expiry never renews a saved operation (completion cookie present: %s)", async (ownedCookie) => {
    const h = harness(65000), payload = input();
    h.tx.reservationApplicationSubmission.findUnique.mockResolvedValue({ id: "saved", completionTokenHash: "owned-cookie", completionExpiresAt: new Date("2030-01-02"), personalDataPurgedAt: null } as never);
    const request = submitApplicationGroupCore(h.client, { ...payload, now: expiredAt, previousCompletionTokenHash: ownedCookie ? "owned-cookie" : undefined });
    if (ownedCookie) await expect(request).resolves.toMatchObject({ submissionId: "saved", replayed: true });
    else await expect(request).rejects.toBeInstanceOf(ApplicationAlreadySubmittedError);
    await expect(recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], reviewedPriceProof: payload.data.reviewedPriceProof, now: expiredAt })).rejects.toBeInstanceOf(ApplicationAlreadySubmittedError);
    const operation = verifyApplicationPriceReview(payload.data.reviewedPriceProof, scope, now).operation;
    expect(h.tx.reservationApplicationSubmission.findUnique).toHaveBeenLastCalledWith({ where: { id: `phase8_${operation}` }, select: { id: true } });
    expect(h.write).not.toHaveBeenCalled();
  });
  it("renewed proof reuses the durable original identity and cannot duplicate its saved application", async () => {
    const h = harness(), payload = input();
    const renewed = await recheckApplicationGroupPricesCore(h.client, { token, classScheduleIds: ["class-1"], reviewedPriceProof: payload.data.reviewedPriceProof, now: expiredAt });
    h.tx.reservationApplicationSubmission.findUnique.mockResolvedValue({ id: "saved" } as never);
    await expect(submitApplicationGroupCore(h.client, { ...payload, now: expiredAt, data: { ...payload.data, reviewedPriceProof: renewed.proof } })).rejects.toBeInstanceOf(ApplicationAlreadySubmittedError);
    expect(h.write).not.toHaveBeenCalled();
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
