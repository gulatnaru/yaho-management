import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient, actor: "", role: "ADMIN" }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: async () => { if (context.role !== "ADMIN") throw new Error("FORBIDDEN"); return { role: "ADMIN", userId: context.actor }; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("UNEXPECTED_REDIRECT"); } }));
import { confirmApplicationSubmission, recordApplicationDeposit, recordApplicationReturn, resolveApplicationWorkflow } from "@/app/(admin)/reservation-applications/actions";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { confirmApplicationSubmissionCore, type ConfirmChoice } from "@/server/reservation-applications/finance";
import { confirmReservationApplicationCore } from "@/server/reservation-applications/confirm";
import { purgeExpiredPersonalDataCore } from "@/server/reservation-applications/retention";
import { createPaymentCore, createRefundCore } from "@/lib/payments/core";
import { buildPaymentFactsQuery, buildRefundFactsQuery } from "@/server/revenue/queries";
import { mergeRevenueFacts } from "@/server/revenue/aggregate";
import type { PaymentFact, RefundFact } from "@/server/revenue/types";

// Existing integration workflow glob discovers this suite. Remote, Preview and Production fail closed.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient(); context.db = db;
const run = `ux6-${crypto.randomUUID()}`; const admin = `${run}-admin`; const admin2 = `${run}-admin2`; const extraChildIds: string[] = []; let sequence = 0;
const owned: string[] = []; const classes: string[] = []; const date = new Date("2026-01-01T00:00:00Z");
const consent = { programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version };
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
type Fixture = { id: string; apps: string[]; classes: string[]; guardianName: string };
async function fixture(classIds?: string[]): Promise<Fixture> {
  context.db = db; context.actor = admin; context.role = "ADMIN";
  const id = `${run}-s${++sequence}`; owned.push(id);
  const targets = classIds ?? [0, 1].map((i) => `${id}-c${i}`);
  if (!classIds) { classes.push(...targets); await db.classSchedule.createMany({ data: targets.map((classId, i) => ({ id: classId, programId: run, startsAt: new Date("2040-01-01T00:00:00Z"), endsAt: new Date("2040-01-01T01:00:00Z"), location: "합성 장소", capacity: 8, applicationPrice: i === 0 ? 40000 : 60000 })) }); }
  const guardianName = `${id}-보호자`;
  await db.reservationApplicationSubmission.create({ data: { id, guardianName, guardianPhone: "01000000000", guardianRelationship: "MOTHER", declaredPayerName: "합성 신고 입금자" } });
  const apps = targets.map((_, i) => `${id}-a${i}`);
  await db.reservationApplication.createMany({ data: targets.map((classScheduleId, i) => ({ ...consent, id: apps[i]!, submissionId: id, classScheduleId, quotedAmount: i === 0 ? 40000 : 60000, childName: `${id}-아이${i}`, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", requestNote: "ORIGINAL_SENSITIVE_REQUEST_DO_NOT_COPY" })) });
  return { id, apps, classes: targets, guardianName };
}
async function fund(f: Fixture, amount = 100000) { expect((await recordApplicationDeposit(f.id, form({ amount: String(amount), payerName: "합성 은행 입금자", depositedAt: "2026-01-01T09:30", idempotencyKey: crypto.randomUUID() }))).status).toBe("success"); }
function confirm(f: Fixture, choices: ConfirmChoice[] = f.apps.map((applicationId) => ({ applicationId, newChild: true }))) { return confirmApplicationSubmission(form({ payload: JSON.stringify({ submissionId: f.id, choices }) })); }
async function child(f: Fixture, index = 0, fields: Partial<Prisma.ChildUncheckedCreateInput> = {}) {
  const app = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[index]! } });
  const row = await db.child.create({ data: { name: app.childName!, birthDate: app.childBirthDate, gender: app.childGender!, guardianName: f.guardianName, guardianPhone: "01000000000", ...fields } }); extraChildIds.push(row.id); return row;
}
async function ledger(f: Fixture) { const detail = (await getApplicationWorkflowDetail(f.id))!; expect(detail.ledger.state).toBe("available"); if (detail.ledger.state !== "available") throw new Error("LEDGER_INVALID"); expect(detail.ledger.D).toBe(detail.ledger.A + detail.ledger.P + detail.ledger.R + detail.ledger.T); return detail.ledger; }
async function counts(f: Fixture) { return Promise.all([db.reservation.count({ where: { classScheduleId: { in: f.classes } } }), db.paymentItem.count({ where: { reservation: { classScheduleId: { in: f.classes } } } }), db.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: f.id } } })]); }
beforeAll(async () => { context.actor = admin; await db.user.createMany({ data: [admin, admin2].map((id) => ({ id, name: "합성 관리자", email: `${id}@example.test`, role: "ADMIN" })) }); await db.program.create({ data: { id: run, name: run, defaultPrice: 999999 } }); }, 30000);
afterAll(async () => {
  context.db = db;
  const ownedChildIds = [...extraChildIds, ...(await db.reservation.findMany({ where: { classScheduleId: { in: classes } }, select: { childId: true } })).map((row) => row.childId)];
  const paymentIds = (await db.paymentItem.findMany({ where: { reservation: { classScheduleId: { in: classes } } }, select: { paymentId: true } })).map((row) => row.paymentId);
  await db.fundAllocation.deleteMany({ where: { deposit: { submissionId: { in: owned } } } });
  await db.applicationReturn.deleteMany({ where: { returnObligation: { submissionId: { in: owned } } } }); await db.returnObligation.deleteMany({ where: { submissionId: { in: owned } } }); await db.applicationDeposit.deleteMany({ where: { submissionId: { in: owned } } });
  await db.reservationApplicationPaymentMapping.deleteMany({ where: { application: { submissionId: { in: owned } } } });
  await db.childConsent.deleteMany({ where: { OR: [{ childId: { in: ownedChildIds } }, { child: { guardianName: { startsWith: run } } }] } });
  await db.reservationApplication.deleteMany({ where: { OR: [{ submissionId: { in: owned } }, { id: { startsWith: run } }] } });
  await db.refund.deleteMany({ where: { paymentItem: { paymentId: { in: paymentIds } } } }); await db.paymentItem.deleteMany({ where: { paymentId: { in: paymentIds } } }); await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await db.reservation.deleteMany({ where: { classScheduleId: { in: classes } } }); await db.reservationApplicationSubmission.deleteMany({ where: { id: { in: owned } } });
  await db.child.deleteMany({ where: { OR: [{ id: { in: ownedChildIds } }, { guardianName: { startsWith: run } }, { name: { startsWith: run } }] } });
  await db.classSchedule.deleteMany({ where: { id: { in: classes } } }); await db.program.delete({ where: { id: run } }); await db.user.deleteMany({ where: { id: { in: [admin, admin2] } } }); await db.$disconnect();
}, 30000);
describe.sequential("Phase 6 actual PostgreSQL atomic confirmation", () => {
  it("Scenario A confirms ONLY 40000 after rejected 60000 and returned 20000: D100000 P40000 R40000 T20000 A0", async () => {
    const f = await fixture(); await fund(f);
    expect((await resolveApplicationWorkflow(f.apps[1]!, "REJECTED", form({ resolutionNote: "합성 둘째 반려" }))).status).toBe("success");
    const obligation = await db.returnObligation.findFirstOrThrow({ where: { applicationId: f.apps[1]! } });
    expect((await recordApplicationReturn(obligation.id, form({ amount: "20000", reason: "합성 부분 반환", returnedAt: "2026-01-01T09:30", idempotencyKey: crypto.randomUUID(), observedAmount: "60000", observedReturnedAmount: "0" }))).status).toBe("success");
    expect(await ledger(f)).toMatchObject({ Q: 100000, D: 100000, P: 0, R: 40000, T: 20000, A: 40000 });
    const rejected = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[1]! } });
    const result = await confirm(f, [{ applicationId: f.apps[0]!, newChild: true, memo: "첫째 운영 메모" }]); expect(result.status).toBe("success");
    expect(await ledger(f)).toEqual({ state: "available", Q: 100000, D: 100000, P: 40000, R: 40000, T: 20000, A: 0 });
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[1]! } })).toEqual(rejected);
    expect(await counts(f)).toEqual([1, 1, 1]);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: result.paymentId! }, include: { items: { include: { reservation: true, reservationApplicationMapping: true } } } });
    expect(payment.totalAmount).toBe(40000); expect(payment.items).toHaveLength(1); expect(payment.items[0]).toMatchObject({ amount: 40000, paidAmount: 40000, reservation: { memo: "첫째 운영 메모" }, reservationApplicationMapping: { applicationId: f.apps[0] } });
    expect(payment.items[0]!.reservation.id).toBe(result.reservationIds![0]); expect(await db.refund.count({ where: { paymentItem: { paymentId: payment.id } } })).toBe(0);
  });
  it("empty or unresolved Child choices save nothing; a subset preserves sibling and its original request", async () => {
    const f = await fixture(); await fund(f); const before = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[1]! } });
    expect((await confirm(f, [])).status).toBe("failure"); expect((await confirm(f, [{ applicationId: f.apps[0]! }])).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]);
    expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }])).status).toBe("success"); expect(await counts(f)).toEqual([1, 1, 1]);
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[1]! } })).toEqual(before); expect(await ledger(f)).toMatchObject({ P: 40000, A: 60000 });
  });
  it("full explicit existing/new choices keep fixed amounts, original Child personal data and blank memo", async () => {
    const f = await fixture(); await fund(f); const existing = await child(f); const result = await confirm(f, [{ applicationId: f.apps[0]!, childId: existing.id }, { applicationId: f.apps[1]!, newChild: true, memo: "둘째만" }]);
    expect(result.status).toBe("success"); expect(await counts(f)).toEqual([2, 2, 2]); expect(await db.child.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing);
    const first = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[0]! }, include: { reservation: true } }); expect(first.reservation!.memo).toBeNull(); expect(first.requestNote).toBe("ORIGINAL_SENSITIVE_REQUEST_DO_NOT_COPY");
    expect(await db.payment.findUniqueOrThrow({ where: { id: result.paymentId! } })).toMatchObject({ totalAmount: 100000 }); expect(await ledger(f)).toMatchObject({ P: 100000, A: 0 });
  });
  it("sufficient D cannot spend funds held for a rejected sibling, and insufficient A rolls back", async () => {
    const f = await fixture(); await fund(f, 70000); await resolveApplicationWorkflow(f.apps[1]!, "REJECTED", form({ resolutionNote: "합성 반려" }));
    expect(await ledger(f)).toMatchObject({ D: 70000, R: 60000, A: 10000 }); expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }])).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]);
  });
  it.each(["inactive", "purged", "wrong-owner"] as const)("server rejects %s Child without changing another selected child", async (kind) => {
    const f = await fixture(); await fund(f); const existing = await child(f, 1, kind === "inactive" ? { isActive: false } : kind === "purged" ? { name: "(파기됨)", birthDate: null, guardianName: null, guardianPhone: null, isActive: false, personalDataPurgedAt: date, personalDataPurgedById: admin } : { guardianPhone: "01099999999" });
    expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }, { applicationId: f.apps[1]!, childId: existing.id }])).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]); expect(await ledger(f)).toMatchObject({ P: 0, A: 100000 });
  });
  it.each(["programTermsAcknowledged", "privacyConsentAgreed", "legalGuardianConfirmed", "refundTermsAcknowledged"] as const)("PostgreSQL rejects missing required %s without mutating pending applications", async (field) => {
    const f = await fixture(); await fund(f); const before = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[0]! } });
    await expect(db.reservationApplication.update({ where: { id: f.apps[0]! }, data: { [field]: false } })).rejects.toBeDefined();
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[0]! } })).toEqual(before); expect(await counts(f)).toEqual([0, 0, 0]);
  });
  it("foreign-family application IDs and duplicate selection cannot confirm any target", async () => {
    const f = await fixture(); const other = await fixture(); await fund(f);
    expect((await confirm(f, [{ applicationId: other.apps[0]!, newChild: true }])).status).toBe("failure"); expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }, { applicationId: f.apps[0]!, newChild: true }])).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]); expect(await counts(other)).toEqual([0, 0, 0]);
  });
  it("one later Child failure rolls back an earlier actual reservation/Child/consent write", async () => {
    const f = await fixture(); await fund(f); const invalid = await child(f, 1, { isActive: false }); let reservationWrites = 0;
    context.db = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => db.$transaction((tx) => callback({ ...tx, reservation: { ...tx.reservation, create: async (args: Prisma.ReservationCreateArgs) => { const row = await tx.reservation.create(args); reservationWrites++; return row; } } } as unknown as Prisma.TransactionClient), options) } as unknown as PrismaClient;
    try { expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }, { applicationId: f.apps[1]!, childId: invalid.id }])).status).toBe("failure"); } finally { context.db = db; }
    expect(reservationWrites).toBe(1); expect(await counts(f)).toEqual([0, 0, 0]); expect(await db.child.count({ where: { name: `${f.id}-아이0` } })).toBe(0); expect(await db.childConsent.count({ where: { reservationApplicationId: { in: f.apps } } })).toBe(0); expect(await ledger(f)).toMatchObject({ P: 0, A: 100000 });
  });
  it("failure after PaymentItem/Mapping writes rolls back all reservations, payments, allocations and statuses", async () => {
    const f = await fixture(); await fund(f); const beforePayments = await db.payment.count(); let mappings = 0;
    context.db = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => db.$transaction((tx) => callback({ ...tx, reservationApplicationPaymentMapping: { ...tx.reservationApplicationPaymentMapping, create: async (args: Prisma.ReservationApplicationPaymentMappingCreateArgs) => { const row = await tx.reservationApplicationPaymentMapping.create(args); if (++mappings === 2) throw new Error("SYNTHETIC_MID_BATCH_FAILURE"); return row; } } } as unknown as Prisma.TransactionClient), options) } as unknown as PrismaClient;
    try { expect((await confirm(f)).status).toBe("result-unknown"); } finally { context.db = db; }
    expect(mappings).toBe(2); expect(await db.payment.count()).toBe(beforePayments); expect(await counts(f)).toEqual([0, 0, 0]); expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: f.classes } } } } } })).toBe(0); expect(await ledger(f)).toMatchObject({ P: 0, A: 100000 });
  });
  it("two admins simultaneously confirming one selection create exactly one Payment and one Mapping per child", async () => {
    const f = await fixture(); await fund(f); const [a, b] = [new PrismaClient(), new PrismaClient()];
    try { const input = { submissionId: f.id, choices: f.apps.map((applicationId) => ({ applicationId, newChild: true })), actorUserId: admin, now: new Date() }; const results = await Promise.allSettled([confirmApplicationSubmissionCore(a, input), confirmApplicationSubmissionCore(b, { ...input, actorUserId: admin2 })]); expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1); expect(await counts(f)).toEqual([2, 2, 2]); expect(await ledger(f)).toMatchObject({ P: 100000, A: 0 }); } finally { await Promise.all([a.$disconnect(), b.$disconnect()]); }
  });
  it("duplicate existing Child/class and paid reservation cannot create another Payment", async () => {
    const f = await fixture(); await fund(f); const existing = await child(f); const reservation = await db.reservation.create({ data: { classScheduleId: f.classes[0]!, childId: existing.id } });
    const paid = await createPaymentCore(db, { reservationId: reservation.id, amount: 40000, discountAmount: 0, method: "TRANSFER" });
    const result = await confirm(f, [{ applicationId: f.apps[0]!, childId: existing.id }]); expect(result.status).toBe("failure"); expect(result.error).toContain("이미 연결된 결제");
    expect(await db.paymentItem.count({ where: { reservationId: reservation.id } })).toBe(1); expect(await db.payment.findUniqueOrThrow({ where: { id: paid.paymentId } })).toMatchObject({ totalAmount: 40000 }); expect(await ledger(f)).toMatchObject({ P: 0, A: 100000 });
  });
  it("NEW never creates/merges a duplicate identity and same-name wrong-owner Child remains untouched", async () => {
    const f = await fixture(); await fund(f); const existing = await child(f); const foreign = await child(f, 0, { guardianName: `${run}-foreign-owner` });
    expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }])).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]);
    expect(await db.child.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing); expect(await db.child.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
    expect((await confirm(f, [{ applicationId: f.apps[0]!, childId: existing.id }])).status).toBe("success"); expect(await db.child.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
  });
  it("FIFO allocations preserve the first and second deposit while each child keeps its quote", async () => {
    const f = await fixture(); await fund(f, 30000); await fund(f, 70000); const deposits = await db.applicationDeposit.findMany({ where: { submissionId: f.id }, orderBy: [{ confirmedAt: "asc" }, { id: "asc" }] });
    expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }])).status).toBe("success");
    const allocations = await db.fundAllocation.findMany({ where: { paymentMapping: { applicationId: f.apps[0]! } } });
    expect(allocations.reduce((total, row) => total + row.amount, 0)).toBe(40000); expect(allocations.find((row) => row.depositId === deposits[0]!.id)?.amount).toBe(Math.min(40000, deposits[0]!.amount)); expect(await ledger(f)).toMatchObject({ P: 40000, A: 60000 });
  });
  it("cancelled class and broken ledger fail closed without reservations", async () => {
    const f = await fixture(); await fund(f); await db.classSchedule.update({ where: { id: f.classes[0]! }, data: { status: "CANCELLED" } }); expect((await confirm(f)).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]);
    await db.classSchedule.update({ where: { id: f.classes[0]! }, data: { status: "SCHEDULED" } });
    const obligation = await db.returnObligation.create({ data: { submissionId: f.id, kind: "EXCESS", amount: 1 } });
    // Deliberately inconsistent synthetic ledger: obligation has no allocation backing it.
    expect((await confirm(f)).status).toBe("failure"); expect(await counts(f)).toEqual([0, 0, 0]); await db.returnObligation.delete({ where: { id: obligation.id } });
  });
  it("competing last seat is serialized; loser needs explicit overbooking, never silently creates overflow", async () => {
    const first = await fixture(); const second = await fixture([first.classes[0]!]); await db.classSchedule.update({ where: { id: first.classes[0]! }, data: { capacity: 1 } }); await fund(first); await fund(second, 40000);
    const results = await Promise.all([confirm(first, [{ applicationId: first.apps[0]!, newChild: true }]), confirm(second)]); expect(results.filter((row) => row.status === "success")).toHaveLength(1); expect(results.filter((row) => row.overbookingConfirmation)).toHaveLength(1); expect(await db.reservation.count({ where: { classScheduleId: first.classes[0]!, status: "RESERVED" } })).toBe(1);
  });
  it("overbooking approval is invalidated by selection, Child choice, capacity and current count changes", async () => {
    const f = await fixture(); await fund(f); await db.classSchedule.update({ where: { id: f.classes[0]! }, data: { capacity: 1 } }); const occupant = await child(f, 1); await db.reservation.create({ data: { classScheduleId: f.classes[0]!, childId: occupant.id } });
    const initial = await confirm(f, [{ applicationId: f.apps[0]!, newChild: true }]); expect(initial.overbookingConfirmation).toBeDefined(); const binding = initial.overbookingConfirmation!;
    expect((await confirm(f, [{ applicationId: f.apps[0]!, newChild: true, confirmOverbooking: true, overbookingConfirmation: binding }, { applicationId: f.apps[1]!, newChild: true }])).overbookingConfirmation).toBeDefined();
    const existing = await child(f); expect((await confirm(f, [{ applicationId: f.apps[0]!, childId: existing.id, confirmOverbooking: true, overbookingConfirmation: binding }])).overbookingConfirmation).toBeDefined();
    await db.classSchedule.update({ where: { id: f.classes[0]! }, data: { capacity: 2 } }); const other = await db.child.create({ data: { name: `${f.id}-추가아이`, guardianName: f.guardianName } }); await db.reservation.create({ data: { classScheduleId: f.classes[0]!, childId: other.id } });
    const updated = await confirm(f, [{ applicationId: f.apps[0]!, childId: existing.id, confirmOverbooking: true, overbookingConfirmation: { ...binding, childChoice: existing.id, selectionFingerprint: JSON.stringify([[f.apps[0], existing.id]]) } }]); expect(updated.overbookingConfirmation).toMatchObject({ capacity: 2, reservedCount: 2 });
    expect((await confirm(f, [{ applicationId: f.apps[0]!, childId: existing.id, confirmOverbooking: true, overbookingConfirmation: updated.overbookingConfirmation! }])).status).toBe("success");
  });
  it("confirmation vs recorded sibling return never spends return funds twice", async () => {
    const f = await fixture(); await fund(f); await resolveApplicationWorkflow(f.apps[1]!, "REJECTED", form({ resolutionNote: "합성 반려" })); const obligation = await db.returnObligation.findFirstOrThrow({ where: { applicationId: f.apps[1]! } });
    const results = await Promise.all([confirm(f, [{ applicationId: f.apps[0]!, newChild: true }]), recordApplicationReturn(obligation.id, form({ amount: "20000", reason: "합성 반환", returnedAt: "2026-01-01T09:30", idempotencyKey: crypto.randomUUID(), observedAmount: "60000", observedReturnedAmount: "0" }))]); expect(results.map((row) => row.status)).toEqual(["success", "success"]); expect(await ledger(f)).toMatchObject({ P: 40000, A: 0, R: 40000, T: 20000 });
  });
  it("response-loss read is authoritative; repeated writes cannot duplicate committed mappings", async () => {
    const f = await fixture(); await fund(f); await confirm(f); // Deliberately discard the transport result.
    const recovered = (await getApplicationWorkflowDetail(f.id))!; expect(recovered.applications.every((row) => row.status === "CONFIRMED" && row.reservation && row.paymentMapping)).toBe(true); const before = await counts(f); expect((await confirm(f)).status).toBe("failure"); expect(await counts(f)).toEqual(before);
  });
  it("post-confirmation partial/full Refund changes existing Revenue only; A/P and pre-confirmation returns are unchanged", async () => {
    const f = await fixture(); await fund(f, 120000); const result = await confirm(f); expect(result.status).toBe("success"); const before = await ledger(f);
    const item = await db.paymentItem.findFirstOrThrow({ where: { paymentId: result.paymentId, amount: 40000 } }); await createRefundCore(db, { paymentItemId: item.id, amount: 10000, reason: "PERSONAL", processedById: admin }); expect(await ledger(f)).toEqual(before);
    const filters = { dateFrom: "2000-01-01", dateTo: "2099-12-31", startUtc: new Date("2000-01-01"), endExclusiveUtc: new Date("2100-01-01"), programId: run, classScheduleId: f.classes[0] };
    const report = mergeRevenueFacts({ operations: [], payments: await db.$queryRaw<PaymentFact[]>(buildPaymentFactsQuery(filters)), refunds: await db.$queryRaw<RefundFact[]>(buildRefundFactsQuery(filters)) }); expect(report.summary).toMatchObject({ paidAmount: 40000, refundedAmount: 10000, netRevenue: 30000 });
    await createRefundCore(db, { paymentItemId: item.id, amount: 30000, reason: "PERSONAL", processedById: admin }); await expect(createRefundCore(db, { paymentItemId: item.id, amount: 1, reason: "PERSONAL", processedById: admin })).rejects.toBeDefined(); expect(await ledger(f)).toEqual(before);
  });
  it("legacy keeps deposit timestamp confirmation with NO automatic Payment, followed by explicit manual payment", async () => {
    const f = await fixture(); const id = `${f.id}-legacy`; await db.reservationApplication.create({ data: { ...consent, id, classScheduleId: f.classes[0]!, childName: `${f.id}-legacy아이`, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", guardianName: f.guardianName, guardianPhone: "01000000000", depositConfirmedAt: date, depositConfirmedById: admin } });
    const result = await confirmReservationApplicationCore(db, { applicationId: id, childChoice: { type: "NEW" }, confirmOverbooking: false, actorUserId: admin, now: new Date() }); expect(await db.paymentItem.findUnique({ where: { reservationId: result.reservationId } })).toBeNull(); expect((await db.reservationApplication.findUniqueOrThrow({ where: { id } })).quotedAmount).toBeNull();
    await createPaymentCore(db, { reservationId: result.reservationId, amount: 12345, discountAmount: 0, method: "TRANSFER" }); await expect(createPaymentCore(db, { reservationId: result.reservationId, amount: 12345, discountAmount: 0, method: "TRANSFER" })).rejects.toBeDefined(); expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: id } })).toBe(0);
  });
  it("scoped purge and confirmation serialize against requested Child without resurrecting purged data", async () => {
    const old = await fixture(); await fund(old); const converted = await confirm(old, [{ applicationId: old.apps[0]!, newChild: true }]); const app = await db.reservationApplication.findUniqueOrThrow({ where: { id: old.apps[0]! } });
    await db.classSchedule.update({ where: { id: old.classes[0]! }, data: { startsAt: new Date("2010-01-01"), endsAt: new Date("2010-01-01T01:00:00Z") } }); await db.reservation.update({ where: { id: converted.reservationIds![0]! }, data: { status: "COMPLETED" } });
    const f = await fixture(); await db.reservationApplicationSubmission.update({ where: { id: f.id }, data: { guardianName: old.guardianName } }); await db.reservationApplication.update({ where: { id: f.apps[0]! }, data: { childName: app.childName, requestedChildId: app.childId } }); await fund(f);
    const results = await Promise.allSettled([purgeExpiredPersonalDataCore(db, { actorUserId: admin, now: new Date(), scope: { childIds: [app.childId!], applicationIds: [] } }), confirm(f, [{ applicationId: f.apps[0]!, childId: app.childId! }])]); expect(results[0]!.status).toBe("fulfilled");
    const latest = await db.child.findUniqueOrThrow({ where: { id: app.childId! } }); const pending = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.apps[0]! } });
    if (latest.personalDataPurgedAt) { expect(latest.isActive).toBe(false); expect(pending.status).toBe("SUBMITTED"); expect(pending.requestedChildPurgedAt).not.toBeNull(); expect(await counts(f)).toEqual([0, 0, 0]); } else { expect(pending.status).toBe("CONFIRMED"); expect(await counts(f)).toEqual([1, 1, 1]); } await ledger(f);
  });
});
