import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { APPLICATION_CONSENT_CONTENT } from "../../../lib/reservation-applications/consent-content";
import { closeApplicationWithReturnCore, recordApplicationDepositCore, recordApplicationReturnCore, type ConfirmChoice } from "../../../server/reservation-applications/finance";
import { requireFact, type Cell } from "./contract";

export type RunRoots = { id: string; actors: [string, string]; program: string; now: Date; created: boolean };
export function runRoots(): RunRoots {
  const id = `obs01-${randomUUID()}`;
  return { id, actors: [`${id}-admin-a`, `${id}-admin-b`], program: `${id}-program`, now: new Date(), created: false };
}
export async function createRoots(db: PrismaClient, roots: RunRoots): Promise<void> {
  await db.user.createMany({ data: roots.actors.map((id) => ({ id, email: `${id}@example.test`, name: "Synthetic administrator", role: "ADMIN" as const })) });
  await db.program.create({ data: { id: roots.program, name: "Synthetic program", defaultPrice: 999999 } });
  roots.created = true;
}
export async function cleanupRoots(db: PrismaClient, roots: RunRoots): Promise<void> {
  await db.program.deleteMany({ where: { id: roots.program } });
  await db.user.deleteMany({ where: { id: { in: roots.actors } } });
  requireFact(await db.program.count({ where: { id: roots.program } }) === 0 && await db.user.count({ where: { id: { in: roots.actors } } }) === 0, "CLEANUP");
  roots.created = false;
}
export type Fixture = {
  id: string; cell: Cell; roots: RunRoots; classes: string[]; apps: string[]; childIds: string[]; childNames: string[];
  deviceIds: string[]; paymentIds: string[]; guardianName: string; guardianPhone: string; quotes: number[]; choices: ConfirmChoice[]; now: Date;
};
export function manifest(roots: RunRoots, cell: Cell, sequence: number): Fixture {
  const id = `${roots.id}-f${String(sequence).padStart(5, "0")}`;
  const apps = Array.from({ length: cell.n }, (_, i) => `${id}-a${String(i).padStart(2, "0")}`);
  return { id, cell, roots, apps, classes: apps.map((_, i) => `${id}-c${String(i).padStart(2, "0")}`), childIds: cell.mode === "EXISTING" ? apps.map((_, i) => `${id}-child${String(i).padStart(2, "0")}`) : [], childNames: apps.map((_, i) => `${id}-synthetic-child-${i}`), guardianName: `${id}-synthetic-guardian`, guardianPhone: "01000000000", deviceIds: cell.device === "ONE" ? [`${id}-device`] : [], paymentIds: [], quotes: apps.map((_, i) => i % 2 === 0 ? 40000 : 60000), choices: [], now: new Date(roots.now.getTime() + sequence * 10) };
}
export async function prepareFixture(db: PrismaClient, f: Fixture): Promise<void> {
  const submitted = new Date(f.roots.now.getTime() - 60_000);
  await db.classSchedule.createMany({ data: f.classes.map((id, i) => ({ id, programId: f.roots.program, startsAt: new Date(f.roots.now.getTime() + 86_400_000), endsAt: new Date(f.roots.now.getTime() + 90_000_000), location: "Synthetic location", status: "SCHEDULED", capacity: 8, applicationPrice: f.quotes[i]! })) });
  await db.reservationApplicationSubmission.create({ data: { id: f.id, guardianName: f.guardianName, guardianPhone: f.guardianPhone, guardianRelationship: "MOTHER", declaredPayerName: "Synthetic payer", submittedAt: submitted } });
  if (f.cell.mode === "EXISTING") {
    await db.child.createMany({ data: f.childIds.map((id, i) => ({ id, name: f.childNames[i]!, birthDate: new Date("2020-01-01T00:00:00Z"), gender: "UNSPECIFIED", guardianName: f.guardianName, guardianPhone: f.guardianPhone, memo: "Synthetic preserved note", isActive: true })) });
    await db.childConsent.createMany({ data: f.childIds.flatMap((childId, i) => (["PHOTO_SHARE", "PHOTO_MARKETING"] as const).map((consentType) => ({ id: `${f.id}-prior-${i}-${consentType}`, childId, consentType, action: "AGREED" as const, recordedAt: new Date(submitted.getTime() - 60_000), recordedById: f.roots.actors[0], consentVersion: APPLICATION_CONSENT_CONTENT.version }))) });
  }
  await db.reservationApplication.createMany({ data: f.apps.map((id, i) => ({ id, submissionId: f.id, classScheduleId: f.classes[i]!, quotedAmount: f.quotes[i]!, requestedChildId: f.childIds[i] ?? null, childName: f.childNames[i]!, childBirthDate: new Date("2020-01-01T00:00:00Z"), childGender: "UNSPECIFIED", requestNote: "Synthetic unchanged request", programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version, submittedAt: submitted })) });
  for (const deviceId of f.deviceIds) {
    await db.applicationDevice.create({ data: { id: deviceId, tokenHash: randomUUID(), expiresAt: new Date(f.now.getTime() + 86_400_000) } });
    await db.deviceSubmission.create({ data: { id: `${f.id}-device-submission`, deviceId, submissionId: f.id } });
  }
  const total = f.quotes.reduce((a, b) => a + b, 0);
  const amounts = f.cell.scenario === "FRAGMENTED" ? [30000, total - 30000] : [total - (f.cell.scenario.includes("INSUFFICIENT") ? 1 : 0)];
  for (let i = 0; i < amounts.length; i++) {
    const now = new Date(f.roots.now.getTime() - 30_000 + i * 1000);
    const deposited = await recordApplicationDepositCore(db, { submissionId: f.id, amount: amounts[i]!, payerName: "Synthetic bank payer", depositedAt: new Date(now.getTime() - 1000), idempotencyKey: randomUUID(), actorUserId: f.roots.actors[0], now });
    await db.applicationDeposit.update({ where: { id: deposited.depositId }, data: { id: `${f.id}-deposit-${String(i).padStart(2, "0")}` } });
  }
  if (f.cell.hold !== "NONE") {
    await closeApplicationWithReturnCore(db, { applicationId: f.apps.at(-1)!, status: "REJECTED", resolutionNote: "Synthetic resolution", actorUserId: f.roots.actors[0], now: f.now });
    if (f.cell.hold === "PARTIAL_RETURN") {
      const obligation = await db.returnObligation.findFirstOrThrow({ where: { submissionId: f.id, applicationId: f.apps.at(-1)! } });
      await recordApplicationReturnCore(db, { obligationId: obligation.id, amount: 20000, reason: "Synthetic partial return", returnedAt: new Date(f.now.getTime() - 1000), idempotencyKey: randomUUID(), actorUserId: f.roots.actors[0], now: f.now });
    }
  }
  if (f.cell.scenario.startsWith("DUPLICATE")) {
    const reservation = await db.reservation.create({ data: { id: `${f.id}-prior-reservation`, childId: f.childIds.at(-1)!, classScheduleId: f.classes.at(-1)! } });
    if (f.cell.scenario === "DUPLICATE PAID") {
      const paymentId = `${f.id}-prior-payment`; f.paymentIds.push(paymentId);
      await db.payment.create({ data: { id: paymentId, method: "TRANSFER", status: "PAID", totalAmount: f.quotes.at(-1)! } });
      await db.paymentItem.create({ data: { id: `${f.id}-prior-item`, paymentId, reservationId: reservation.id, amount: f.quotes.at(-1)!, paidAmount: f.quotes.at(-1)! } });
    }
  }
  for (let i = 0; i < f.classes.length; i++) await db.classSchedule.update({ where: { id: f.classes[i]! }, data: { applicationPrice: f.quotes[i]! + 1000 } });
  f.choices = f.apps.slice(0, f.cell.selected).map((applicationId, i) => f.cell.mode === "NEW" ? { applicationId, newChild: true } : { applicationId, childId: f.childIds[i]! });
}

export async function snapshot(db: PrismaClient, f: Fixture) {
  const apps = await db.reservationApplication.findMany({ where: { submissionId: f.id }, orderBy: { id: "asc" } });
  const children = await db.child.findMany({ where: { OR: [{ id: { in: f.childIds } }, { name: { in: f.childNames }, guardianName: f.guardianName, guardianPhone: f.guardianPhone }] }, orderBy: { id: "asc" } });
  for (const row of children) if (!f.childIds.includes(row.id)) f.childIds.push(row.id);
  const reservations = await db.reservation.findMany({ where: { classScheduleId: { in: f.classes } }, orderBy: { id: "asc" } });
  const items = await db.paymentItem.findMany({ where: { reservationId: { in: reservations.map((r) => r.id) } }, orderBy: { id: "asc" } });
  for (const item of items) if (!f.paymentIds.includes(item.paymentId)) f.paymentIds.push(item.paymentId);
  const deposits = await db.applicationDeposit.findMany({ where: { submissionId: f.id }, orderBy: [{ confirmedAt: "asc" }, { id: "asc" }] });
  const obligations = await db.returnObligation.findMany({ where: { submissionId: f.id }, orderBy: { id: "asc" } });
  return {
    apps, children, reservations, items, deposits, obligations,
    submission: await db.reservationApplicationSubmission.findUnique({ where: { id: f.id } }),
    classes: await db.classSchedule.findMany({ where: { id: { in: f.classes } }, orderBy: { id: "asc" } }),
    consents: await db.childConsent.findMany({ where: { OR: [{ childId: { in: f.childIds } }, { reservationApplicationId: { in: f.apps } }] }, orderBy: { id: "asc" } }),
    deviceChildren: await db.deviceChild.findMany({ where: { OR: [{ deviceId: { in: f.deviceIds } }, { childId: { in: f.childIds } }] }, orderBy: { id: "asc" } }),
    devices: await db.applicationDevice.findMany({ where: { id: { in: f.deviceIds } }, orderBy: { id: "asc" } }),
    deviceSubmissions: await db.deviceSubmission.findMany({ where: { submissionId: f.id }, orderBy: { id: "asc" } }),
    payments: await db.payment.findMany({ where: { id: { in: f.paymentIds } }, orderBy: { id: "asc" } }),
    mappings: await db.reservationApplicationPaymentMapping.findMany({ where: { applicationId: { in: f.apps } }, orderBy: { id: "asc" } }),
    allocations: await db.fundAllocation.findMany({ where: { depositId: { in: deposits.map((d) => d.id) } }, orderBy: { id: "asc" } }),
    returns: await db.applicationReturn.findMany({ where: { returnObligationId: { in: obligations.map((o) => o.id) } }, orderBy: { id: "asc" } }),
    refunds: await db.refund.findMany({ where: { paymentItemId: { in: items.map((i) => i.id) } }, orderBy: { id: "asc" } }),
  };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export async function cleanupFixture(db: PrismaClient, f: Fixture): Promise<void> {
  const s = await snapshot(db, f);
  await db.fundAllocation.deleteMany({ where: { id: { in: s.allocations.map((r) => r.id) } } });
  await db.applicationReturn.deleteMany({ where: { id: { in: s.returns.map((r) => r.id) } } });
  await db.returnObligation.deleteMany({ where: { id: { in: s.obligations.map((r) => r.id) } } });
  await db.applicationDeposit.deleteMany({ where: { id: { in: s.deposits.map((r) => r.id) } } });
  await db.reservationApplicationPaymentMapping.deleteMany({ where: { id: { in: s.mappings.map((r) => r.id) } } });
  await db.childConsent.deleteMany({ where: { id: { in: s.consents.map((r) => r.id) } } });
  await db.deviceChild.deleteMany({ where: { id: { in: s.deviceChildren.map((r) => r.id) } } });
  await db.deviceSubmission.deleteMany({ where: { id: { in: s.deviceSubmissions.map((r) => r.id) } } });
  await db.reservationApplication.deleteMany({ where: { id: { in: f.apps } } });
  await db.refund.deleteMany({ where: { id: { in: s.refunds.map((r) => r.id) } } });
  await db.paymentItem.deleteMany({ where: { id: { in: s.items.map((r) => r.id) } } });
  await db.payment.deleteMany({ where: { id: { in: f.paymentIds } } });
  await db.reservation.deleteMany({ where: { id: { in: s.reservations.map((r) => r.id) } } });
  await db.reservationApplicationSubmission.deleteMany({ where: { id: f.id } });
  await db.applicationDevice.deleteMany({ where: { id: { in: f.deviceIds } } });
  await db.child.deleteMany({ where: { id: { in: f.childIds } } });
  await db.classSchedule.deleteMany({ where: { id: { in: f.classes } } });
  const residue = await snapshot(db, f);
  requireFact(Object.entries(residue).every(([key, value]) => key === "submission" ? value === null : Array.isArray(value) && value.length === 0), "CLEANUP");
}
