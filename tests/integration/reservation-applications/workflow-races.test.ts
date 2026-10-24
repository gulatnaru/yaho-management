import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient, actor: "", role: "ADMIN" }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: async () => {
  if (context.role !== "ADMIN") throw new Error("FORBIDDEN"); return { role: "ADMIN", userId: context.actor };
} }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("UNEXPECTED_REDIRECT"); } }));
import { lookupWorkflowReceipt, recordApplicationDeposit, recordApplicationReturn, resolveApplicationWorkflow } from "@/app/(admin)/reservation-applications/actions";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { getApplicationReturn, listApplicationReturns } from "@/lib/reservation-applications/return-queries";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";

// Existing CI integration job discovers this file through its existing glob. Never admit remote/Preview DBs.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient(); context.db = db;
const run = `ux5-${crypto.randomUUID()}`;
const admins = [0, 1].map((i) => `${run}-admin-${i}`);
const classIds = [0, 1].map((i) => `${run}-class-${i}`);
const ownedSubmissions: string[] = [];
let sequence = 0; let submissionId = "", foreignId = "", app1 = "", app2 = "";
const actualDate = "2026-01-01T09:30";
const form = (fields: Record<string, string>) => { const result = new FormData(); for (const [key, value] of Object.entries(fields)) result.set(key, value); return result; };
const deposit = (amount: number, key = crypto.randomUUID()) => form({ amount: String(amount), payerName: "합성 실제 입금자 (신고명과 다름)", depositedAt: actualDate, idempotencyKey: key });
const transfer = (amount: number, observedReturnedAmount = 0, key = crypto.randomUUID(), observedAmount = 60000) => form({ amount: String(amount), reason: "합성 실제 반환", returnedAt: actualDate, idempotencyKey: key, observedAmount: String(observedAmount), observedReturnedAmount: String(observedReturnedAmount) });
const reason = () => form({ resolutionNote: "합성 운영 반려 사유" });
async function ledger() {
  const detail = (await getApplicationWorkflowDetail(submissionId))!; expect(detail.ledger.state).toBe("available");
  if (detail.ledger.state !== "available") throw new Error("SYNTHETIC_LEDGER_INVALID");
  expect(detail.ledger.D).toBe(detail.ledger.A + detail.ledger.P + detail.ledger.R + detail.ledger.T); return detail.ledger;
}
async function noConfirmedMoney() {
  expect(await db.reservation.count({ where: { classScheduleId: { in: classIds } } })).toBe(0);
  expect(await db.paymentItem.count({ where: { reservation: { classScheduleId: { in: classIds } } } })).toBe(0);
  expect(await db.reservationApplicationPaymentMapping.count({ where: { application: { submissionId } } })).toBe(0);
  expect(await db.refund.count({ where: { paymentItem: { reservation: { classScheduleId: { in: classIds } } } } })).toBe(0);
  // Revenue reads Payment/PaymentItem/Refund; no source rows exist before confirmation.
}
async function fundedRejection() {
  expect((await recordApplicationDeposit(submissionId, deposit(100000))).status).toBe("success");
  expect((await resolveApplicationWorkflow(app2, "REJECTED", reason())).status).toBe("success");
  return db.returnObligation.findFirstOrThrow({ where: { applicationId: app2 } });
}
/** Inject a failure after preceding real writes, inside the real DB transaction. */
function failWrite(delegate: "fundAllocation" | "returnObligation", method: "create" | "update") {
  context.db = { ...db, $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => db.$transaction(async (tx) => {
    const patched = { ...tx, [delegate]: { ...tx[delegate], [method]: () => { throw new Error("SYNTHETIC_AFTER_WRITE_FAILURE"); } } };
    return callback(patched as unknown as Prisma.TransactionClient);
  }, options) } as unknown as PrismaClient;
}
beforeAll(async () => {
  await db.user.createMany({ data: admins.map((id) => ({ id, email: `${id}@example.test`, name: "합성 관리자", role: "ADMIN" })) });
  await db.program.create({ data: { id: run, name: "합성 원장 프로그램", defaultPrice: 999999 } });
  await db.classSchedule.createMany({ data: classIds.map((id, i) => ({ id, programId: run, startsAt: new Date("2040-01-01T00:00:00Z"), endsAt: new Date("2040-01-01T01:00:00Z"), location: "합성 장소", capacity: 8, applicationPrice: i === 0 ? 40000 : 60000 })) });
}, 30000);
beforeEach(async () => {
  context.db = db; context.role = "ADMIN"; context.actor = admins[0]!;
  submissionId = `${run}-s-${++sequence}`; foreignId = `${submissionId}-foreign`; app1 = `${submissionId}-a1`; app2 = `${submissionId}-a2`; ownedSubmissions.push(submissionId, foreignId);
  await db.reservationApplicationSubmission.createMany({ data: [submissionId, foreignId].map((id) => ({ id, guardianName: "합성 보호자", guardianPhone: "01000000000", guardianRelationship: "MOTHER", declaredPayerName: "합성 신고명" })) });
  const fields = { childName: "합성 아이", childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED" as const, programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version };
  await db.reservationApplication.createMany({ data: [{ ...fields, id: app1, submissionId, classScheduleId: classIds[0]!, quotedAmount: 40000 }, { ...fields, id: app2, submissionId, classScheduleId: classIds[1]!, quotedAmount: 60000 }, { ...fields, id: `${foreignId}-a1`, submissionId: foreignId, classScheduleId: classIds[0]!, quotedAmount: 40000 }] });
}, 30000);
afterAll(async () => {
  context.db = db;
  await db.fundAllocation.deleteMany({ where: { deposit: { submissionId: { in: ownedSubmissions } } } });
  await db.applicationReturn.deleteMany({ where: { returnObligation: { submissionId: { in: ownedSubmissions } } } });
  await db.returnObligation.deleteMany({ where: { submissionId: { in: ownedSubmissions } } });
  await db.applicationDeposit.deleteMany({ where: { submissionId: { in: ownedSubmissions } } });
  await db.reservationApplication.deleteMany({ where: { submissionId: { in: ownedSubmissions } } });
  await db.reservationApplicationSubmission.deleteMany({ where: { id: { in: ownedSubmissions } } });
  await db.classSchedule.deleteMany({ where: { id: { in: classIds } } });
  await db.program.deleteMany({ where: { id: run } }); await db.user.deleteMany({ where: { id: { in: admins } } }); await db.$disconnect();
}, 30000);
describe.sequential("Phase 5 real PostgreSQL finance workflow and races", () => {
  it("40000/60000 quotes, 30000+70000 deposits, rejection and 20000 partial return conserve every ledger term", async () => {
    expect((await recordApplicationDeposit(submissionId, deposit(30000))).status).toBe("success"); expect(await ledger()).toMatchObject({ D: 30000, A: 30000, Q: 100000 });
    expect((await recordApplicationDeposit(submissionId, deposit(70000))).status).toBe("success"); expect(await ledger()).toMatchObject({ D: 100000, A: 100000 });
    expect((await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: submissionId } })).depositNotifiedAt).toBeNull();
    expect((await resolveApplicationWorkflow(app2, "REJECTED", reason())).status).toBe("success"); expect(await ledger()).toMatchObject({ R: 60000, A: 40000 });
    const obligation = await db.returnObligation.findFirstOrThrow({ where: { applicationId: app2 } });
    expect((await recordApplicationReturn(obligation.id, transfer(20000))).status).toBe("success");
    expect(await ledger()).toEqual({ state: "available", Q: 100000, D: 100000, P: 0, R: 40000, T: 20000, A: 40000 });
    const family = (await getApplicationWorkflowDetail(submissionId))!.returnObligations[0]!;
    const whole = (await listApplicationReturns()).find((row) => row.id === obligation.id)!;
    expect(whole).toEqual({ ...family, ledgerVerified: true }); expect(await getApplicationReturn(obligation.id)).toEqual(whole);
    expect((await db.reservationApplication.findUniqueOrThrow({ where: { id: app1 } })).status).toBe("SUBMITTED"); await noConfirmedMoney();
  });
  it("serializes two admins' different partial deposits and a same-key replay without duplicate money", async () => {
    const key = crypto.randomUUID(); const first = recordApplicationDeposit(submissionId, deposit(30000, key)); context.actor = admins[1]!;
    const results = await Promise.all([first, recordApplicationDeposit(submissionId, deposit(70000)), recordApplicationDeposit(submissionId, deposit(30000, key))]);
    expect(results.map((row) => row.status)).toEqual(["success", "success", "success"]); expect(await db.applicationDeposit.count({ where: { submissionId } })).toBe(2);
    expect(await ledger()).toMatchObject({ D: 100000, A: 100000 }); await noConfirmedMoney();
  });
  it("rejects changed payload under a contended key; recovery is read-only", async () => {
    const key = crypto.randomUUID(); const results = await Promise.all([recordApplicationDeposit(submissionId, deposit(30000, key)), recordApplicationDeposit(submissionId, deposit(70000, key))]);
    expect(results.filter((row) => row.status === "success")).toHaveLength(1); expect(results.filter((row) => row.status === "failure")).toHaveLength(1);
    const prior = await db.applicationDeposit.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect((await lookupWorkflowReceipt("deposit", submissionId, key, deposit(prior.amount, key))).status).toBe("success"); expect(await db.applicationDeposit.count({ where: { submissionId } })).toBe(1); await ledger();
  });
  it("serializes rejection versus deposit; late/excess money remains held rather than reusable", async () => {
    const before = await db.reservationApplication.findUniqueOrThrow({ where: { id: app1 } });
    const foreign = await db.reservationApplication.findMany({ where: { submissionId: foreignId } });
    const results = await Promise.all([recordApplicationDeposit(submissionId, deposit(100000)), resolveApplicationWorkflow(app2, "REJECTED", reason())]);
    expect(results.every((row) => row.status === "success")).toBe(true); expect(await ledger()).toMatchObject({ R: 60000, A: 40000 });
    expect((await recordApplicationDeposit(submissionId, deposit(15000))).status).toBe("success"); expect(await ledger()).toMatchObject({ D: 115000, R: 75000, A: 40000 });
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: app1 } })).toEqual(before); expect(await db.reservationApplication.findMany({ where: { submissionId: foreignId } })).toEqual(foreign);
  });
  it("two admins cannot reject/cancel the same child twice or modify a sibling", async () => {
    await recordApplicationDeposit(submissionId, deposit(100000)); const sibling = await db.reservationApplication.findUniqueOrThrow({ where: { id: app1 } });
    const results = await Promise.all([resolveApplicationWorkflow(app2, "REJECTED", reason()), resolveApplicationWorkflow(app2, "CANCELLED", reason())]);
    expect(results.filter((row) => row.status === "success")).toHaveLength(1); expect(results.filter((row) => row.status === "failure")).toHaveLength(1);
    expect(await db.returnObligation.count({ where: { applicationId: app2 } })).toBe(1); expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: app1 } })).toEqual(sibling); await ledger();
  });
  it("stale two-admin returns cannot both spend the same observation; exact replay remains valid", async () => {
    const obligation = await fundedRejection(); const key = crypto.randomUUID();
    const results = await Promise.all([recordApplicationReturn(obligation.id, transfer(20000, 0, key)), recordApplicationReturn(obligation.id, transfer(20000))]);
    expect(results.filter((row) => row.status === "success")).toHaveLength(1); expect(results.filter((row) => row.status === "failure")).toHaveLength(1);
    expect(await db.applicationReturn.count({ where: { returnObligationId: obligation.id } })).toBe(1);
    const stored = await db.applicationReturn.findFirstOrThrow({ where: { returnObligationId: obligation.id } });
    expect((await recordApplicationReturn(obligation.id, transfer(20000, 0, stored.idempotencyKey!))).status).toBe("success"); expect(await ledger()).toMatchObject({ T: 20000, R: 40000, A: 40000 });
  });
  it("blocks over-return/completed reprocessing; allows a second explicitly observed partial return", async () => {
    const obligation = await fundedRejection(); expect((await recordApplicationReturn(obligation.id, transfer(60001))).status).toBe("failure");
    await recordApplicationReturn(obligation.id, transfer(20000)); expect((await recordApplicationReturn(obligation.id, transfer(40000, 20000))).status).toBe("success");
    expect((await recordApplicationReturn(obligation.id, transfer(1, 60000))).status).toBe("failure"); expect(await ledger()).toMatchObject({ D: 100000, R: 0, T: 60000, A: 40000 }); await noConfirmedMoney();
  });
  it.each(["deposit", "resolution", "return"] as const)("rolls back all %s writes if a later transaction write fails", async (kind) => {
    let obligationId = "";
    if (kind === "deposit") await resolveApplicationWorkflow(app2, "REJECTED", reason());
    if (kind === "resolution") await recordApplicationDeposit(submissionId, deposit(100000));
    if (kind === "return") obligationId = (await fundedRejection()).id;
    const before = await getApplicationWorkflowDetail(submissionId);
    failWrite(kind === "return" ? "returnObligation" : "fundAllocation", kind === "return" ? "update" : "create");
    const result = kind === "deposit" ? await recordApplicationDeposit(submissionId, deposit(100000)) : kind === "resolution" ? await resolveApplicationWorkflow(app2, "REJECTED", reason()) : await recordApplicationReturn(obligationId, transfer(20000));
    expect(result.status).toBe("result-unknown"); context.db = db;
    expect(await getApplicationWorkflowDetail(submissionId)).toEqual(before); await ledger(); await noConfirmedMoney();
  });
});
