import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient, role: "ADMIN" }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: async () => { if (context.role !== "ADMIN") throw new Error("FORBIDDEN"); return { role: "ADMIN" }; } }));
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient(); context.db = db;
const run = `ux4-${crypto.randomUUID()}`;
const s1 = `${run}-s1`, s2 = `${run}-s2`, childId = `${run}-child`, reservationId = `${run}-reservation`, paymentId = `${run}-payment`, itemId = `${run}-item`, mappingId = `${run}-mapping`, depositId = `${run}-deposit`, obligationId = `${run}-return`;
const classIds = [0, 1, 2].map((n) => `${run}-c${n}`);
const now = new Date("2040-01-01T00:00:00Z"), birth = new Date("2020-01-01");
const fields = { childName: "합성 아이", childBirthDate: birth, childGender: "UNSPECIFIED" as const, programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version, requestNote: "SYNTHETIC_ORIGINAL_REQUEST" };
beforeAll(async () => {
  await db.user.create({ data: { id: run, email: `${run}@example.test`, role: "ADMIN", name: "합성 관리자" } });
  await db.program.create({ data: { id: run, name: "합성 프로그램", defaultPrice: 999999 } });
  await db.classSchedule.createMany({ data: classIds.map((id, n) => ({ id, programId: run, startsAt: new Date(now.getTime() + n * 86400000), endsAt: new Date(now.getTime() + n * 86400000 + 3600000), location: "합성 장소", capacity: 8 })) });
  await db.child.create({ data: { id: childId, name: "합성 아이", birthDate: birth, gender: "UNSPECIFIED", guardianName: "합성 보호자", guardianPhone: "01000000000" } });
  await db.reservation.create({ data: { id: reservationId, childId, classScheduleId: classIds[0]!, memo: "SYNTHETIC_ADMIN_MEMO" } });
  await db.reservationApplicationSubmission.createMany({ data: [s1, s2].map((id) => ({ id, guardianName: "합성 보호자", guardianPhone: "01000000000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자" })) });
  await db.reservationApplication.create({ data: { ...fields, id: `${s1}-a1`, submissionId: s1, classScheduleId: classIds[0]!, quotedAmount: 10000, status: "CONFIRMED", childId, reservationId, resolvedAt: now, resolvedById: run } });
  await db.reservationApplication.create({ data: { ...fields, id: `${s1}-a2`, submissionId: s1, classScheduleId: classIds[1]!, quotedAmount: 10000, requestedChildId: childId } });
  await db.reservationApplication.create({ data: { ...fields, id: `${s1}-a3`, submissionId: s1, classScheduleId: classIds[2]!, quotedAmount: 10000, status: "REJECTED", resolvedAt: now, resolvedById: run, resolutionNote: "합성 사유" } });
  await db.reservationApplication.create({ data: { ...fields, id: `${s2}-foreign`, submissionId: s2, classScheduleId: classIds[0]!, quotedAmount: 10000 } });
  await db.payment.create({ data: { id: paymentId, method: "TRANSFER", status: "PARTIAL_REFUNDED", totalAmount: 10000, items: { create: { id: itemId, reservationId, amount: 10000, paidAmount: 10000, refundedAmount: 1000 } } } });
  await db.reservationApplicationPaymentMapping.create({ data: { id: mappingId, applicationId: `${s1}-a1`, paymentItemId: itemId } });
  await db.refund.create({ data: { id: `${run}-refund`, paymentItemId: itemId, amount: 1000, reason: "OTHER", reasonDetail: "합성 환불", processedById: run } });
  await db.applicationDeposit.create({ data: { id: depositId, submissionId: s1, amount: 25000, payerName: "합성 입금자", depositedAt: now, confirmedAt: now, confirmedById: run } });
  await db.returnObligation.create({ data: { id: obligationId, submissionId: s1, kind: "EXCESS", amount: 5000, returnedAmount: 2000 } });
  await db.fundAllocation.createMany({ data: [{ depositId, amount: 10000, paymentMappingId: mappingId }, { depositId, amount: 5000, returnObligationId: obligationId }] });
  await db.applicationReturn.create({ data: { returnObligationId: obligationId, amount: 2000, returnedAt: now, processedById: run, reason: "합성 반환" } });
  await db.childConsent.create({ data: { childId, reservationApplicationId: `${s1}-a1`, consentType: "PHOTO_SHARE", action: "DECLINED", consentVersion: APPLICATION_CONSENT_CONTENT.version } });
}, 30000);
afterAll(async () => {
  context.role = "ADMIN";
  await db.fundAllocation.deleteMany({ where: { depositId } });
  await db.applicationReturn.deleteMany({ where: { returnObligationId: obligationId } });
  await db.returnObligation.deleteMany({ where: { submissionId: { in: [s1, s2] } } });
  await db.applicationDeposit.deleteMany({ where: { submissionId: { in: [s1, s2] } } });
  await db.childConsent.deleteMany({ where: { childId } });
  await db.reservationApplicationPaymentMapping.deleteMany({ where: { id: mappingId } });
  await db.reservationApplication.deleteMany({ where: { submissionId: { in: [s1, s2] } } });
  await db.refund.deleteMany({ where: { paymentItemId: itemId } });
  await db.paymentItem.deleteMany({ where: { id: itemId } });
  await db.payment.deleteMany({ where: { id: paymentId } });
  await db.reservation.deleteMany({ where: { id: reservationId } });
  await db.reservationApplicationSubmission.deleteMany({ where: { id: { in: [s1, s2] } } });
  await db.child.deleteMany({ where: { id: childId } });
  await db.classSchedule.deleteMany({ where: { id: { in: classIds } } });
  await db.program.deleteMany({ where: { id: run } }); await db.user.deleteMany({ where: { id: run } }); await db.$disconnect();
}, 30000);
describe.sequential("real PostgreSQL Phase 4 read-only family detail", () => {
  it("reads every sibling independently and never merges same-name/contact submissions", async () => {
    const detail = (await getApplicationWorkflowDetail(s1))!;
    expect(detail.applications).toHaveLength(3); expect(new Set(detail.applications.map((row) => row.status))).toEqual(new Set(["SUBMITTED", "CONFIRMED", "REJECTED"]));
    expect(detail.applications.every((row) => row.submissionId === s1)).toBe(true);
    expect((await getApplicationWorkflowDetail(s2))?.applications).toHaveLength(1);
  });
  it("validates partial-confirmation/return ledger exactly, without multiplying sibling joins or replenishing from Refund", async () => {
    const detail = (await getApplicationWorkflowDetail(s1))!;
    expect(detail.ledger).toEqual({ state: "available", Q: 30000, D: 25000, P: 10000, R: 3000, T: 2000, A: 10000 });
    if (detail.ledger.state === "available") expect(detail.ledger.D).toBe(detail.ledger.A + detail.ledger.P + detail.ledger.R + detail.ledger.T);
    const confirmed = detail.applications.find((row) => row.status === "CONFIRMED")!;
    expect(confirmed.reservation?.paymentItem?.refunds[0]?.amount).toBe(1000); expect(confirmed.reservation?.memo).toBe("SYNTHETIC_ADMIN_MEMO"); expect(confirmed.requestNote).toBe("SYNTHETIC_ORIGINAL_REQUEST");
  });
  it("reads fixed quotes, exact original/optional refusal, reference candidates and appropriate retention without mutating Child", async () => {
    const before = await db.child.findUnique({ where: { id: childId } });
    const detail = (await getApplicationWorkflowDetail(s1))!;
    const pending = detail.applications.find((row) => row.status === "SUBMITTED")!;
    expect(pending.quotedAmount).toBe(10000); expect(pending.consentOriginal?.version).toBe(APPLICATION_CONSENT_CONTENT.version); expect(pending.photoShareConsentAgreed).toBe(false); expect(pending.isPurged).toBe(false);
    expect(pending.reviewCandidates.map((row) => row.id)).toEqual([childId]); expect(pending.childId).toBeNull(); expect(pending.retention.basis).toBe("CLASS_DATE");
    const confirmed = detail.applications.find((row) => row.status === "CONFIRMED")!; expect(confirmed.retention.basis).toBe("LAST_RESERVED_CLASS_DATE"); expect(confirmed.consentHistory?.[0]?.action).toBe("DECLINED");
    expect(await db.child.findUnique({ where: { id: childId } })).toEqual(before);
  });
  it("validates child focus within one submission; foreign/missing IDs do not query another family", async () => {
    expect((await getApplicationWorkflowDetail(s1, `${s1}-a2`))?.focusedApplicationId).toBe(`${s1}-a2`);
    for (const input of [`${s2}-foreign`, "missing", ["repeated"]]) {
      const detail = (await getApplicationWorkflowDetail(s1, input))!; expect(detail.focusedApplicationId).toBeNull(); expect(detail.invalidApplicationFocus).toBe(true); expect(detail.applications).toHaveLength(3);
    }
  });
  it.each(["MANAGER", "TEACHER"])("denies %s before even starting a real DB transaction", async (role) => {
    const transaction = vi.spyOn(db, "$transaction"); context.role = role;
    try { await expect(getApplicationWorkflowDetail(s1)).rejects.toThrow("FORBIDDEN"); expect(transaction).not.toHaveBeenCalled(); }
    finally { context.role = "ADMIN"; transaction.mockRestore(); }
  });
});
