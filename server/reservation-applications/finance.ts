import { Prisma, type PrismaClient } from "@prisma/client";
import { createReservationInTransaction } from "@/server/reservations/create";
import { allocateFifo, type LedgerAllocation, type LedgerDeposit } from "@/lib/reservation-applications/ledger";
import { ApplicationNotPendingError } from "@/lib/reservation-applications/errors";
import { OverbookingConfirmationRequiredError } from "@/lib/reservations/errors";
import { planApplicationConsentRecords } from "@/lib/reservation-applications/consent-plan";
import { MAX_POSTGRES_INTEGER } from "@/lib/reservation-applications/phase20-validation";

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

export class InsufficientApplicationDepositError extends Error {}
export class ApplicationReturnAmountExceededError extends Error {}
export class ApplicationPaymentAlreadyExistsError extends Error {}
export class ApplicationSubmissionOverbookingConfirmationError extends Error {
  constructor(
    public readonly applicationId: string,
    public readonly classScheduleId: string,
    public readonly childChoice: string,
    public readonly selectionFingerprint: string,
    public readonly capacity: number,
    public readonly reservedCount: number,
  ) {
    super("submission overbooking confirmation is required");
    this.name = "ApplicationSubmissionOverbookingConfirmationError";
  }

  get overByAfterCreate(): number { return this.reservedCount + 1 - this.capacity; }
}

function isStoredMoney(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_POSTGRES_INTEGER;
}

function checkedMoneyTotal(values: ReadonlyArray<number>): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total > MAX_POSTGRES_INTEGER) throw new ApplicationNotPendingError();
  return total;
}

function checkedAvailableDepositAmount(ledger: { deposits: LedgerDeposit[]; allocations: LedgerAllocation[] }): number {
  const deposits = checkedMoneyTotal(ledger.deposits.map((deposit) => deposit.amount));
  const allocations = checkedMoneyTotal(ledger.allocations.map((allocation) => allocation.amount));
  if (allocations > deposits) throw new ApplicationNotPendingError();
  return deposits - allocations;
}

function isActualPastDate(value: Date, now: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() <= now.getTime();
}

type FinanceClient = Pick<PrismaClient, "$transaction">;
export type OverbookingConfirmationBinding = {
  applicationId: string;
  classScheduleId: string;
  childChoice: string;
  selectionFingerprint: string;
};
export type ConfirmChoice = {
  applicationId: string;
  childId?: string;
  newChild?: boolean;
  memo?: string;
  confirmOverbooking?: boolean;
  overbookingConfirmation?: OverbookingConfirmationBinding;
};

/** Stable, non-PII binding for the exact selected set submitted to the server. */
export function submissionSelectionFingerprint(choices: ReadonlyArray<Pick<ConfirmChoice, "applicationId" | "childId" | "newChild">>): string {
  return JSON.stringify([...choices]
    .sort((left, right) => left.applicationId.localeCompare(right.applicationId))
    .map((choice) => [choice.applicationId, choice.newChild ? "NEW" : choice.childId]));
}

/** Bare `confirmOverbooking` is never authority. The server compares the binding after locks. */
export function hasBoundOverbookingConfirmation(input: {
  choice: ConfirmChoice;
  application: { id: string; classScheduleId: string };
  selectionFingerprint: string;
}): boolean {
  const binding = input.choice.overbookingConfirmation;
  const childChoice = input.choice.newChild ? "NEW" : input.choice.childId;
  return input.choice.confirmOverbooking === true
    && binding?.applicationId === input.application.id
    && binding.classScheduleId === input.application.classScheduleId
    && binding.childChoice === childChoice
    && binding.selectionFingerprint === input.selectionFingerprint;
}

/**
 * PostgreSQL text parameters reject NUL.  This is an opaque advisory-lock
 * input only: its tuple exactly mirrors the duplicate Child lookup and is
 * never logged or returned.
 */
export function newChildIdentityLockKey(input: {
  name: string;
  birthDate: Date;
  guardianName: string;
  guardianPhone: string;
}): string {
  return JSON.stringify(["phase20-new-child-v1", input.name, input.birthDate.toISOString(), input.guardianName, input.guardianPhone]);
}

type SubmissionRows = {
  id: string;
  status: "SUBMITTED" | "CONFIRMED" | "REJECTED" | "CANCELLED";
  classScheduleId: string;
  quotedAmount: number | null;
  requestedChildId: string | null;
  requestedChildPurgedAt: Date | null;
  reservationId: string | null;
  childId: string | null;
  childName: string | null;
  childBirthDate: Date | null;
  childGender: "MALE" | "FEMALE" | "UNSPECIFIED" | null;
  privacyConsentAgreed: boolean;
  photoShareConsentAgreed: boolean;
  photoMarketingConsentAgreed: boolean;
  consentVersion: string;
  submittedAt: Date;
}[];

type ClosingStatus = "REJECTED" | "CANCELLED";

async function lockSubmission(tx: Prisma.TransactionClient, submissionId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ReservationApplicationSubmission" WHERE "id" = ${submissionId} FOR UPDATE
  `;
  if (!rows[0]) throw new ApplicationNotPendingError();
}

async function ledgerForSubmission(tx: Prisma.TransactionClient, submissionId: string) {
  const [deposits, allocations] = await Promise.all([
    tx.applicationDeposit.findMany({ where: { submissionId }, orderBy: [{ confirmedAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, confirmedAt: true } }),
    tx.fundAllocation.findMany({ where: { deposit: { submissionId } }, select: { depositId: true, amount: true, paymentMappingId: true, returnObligationId: true } }),
  ]);
  return { deposits: deposits satisfies LedgerDeposit[], allocations: allocations satisfies LedgerAllocation[] };
}

/**
 * Reserves only money that has actually arrived. Terminal child applications are funded first,
 * then a single excess hold protects remaining siblings from an over-deposit being charged as a
 * reservation. Every created/increased obligation receives FIFO allocations in this transaction.
 */
async function reconcileReturnObligations(tx: Prisma.TransactionClient, submissionId: string): Promise<void> {
  const applications = await tx.reservationApplication.findMany({
    where: { submissionId },
    select: { id: true, status: true, quotedAmount: true },
    orderBy: { id: "asc" },
  });
  let ledger = await ledgerForSubmission(tx, submissionId);
  const terminal = applications.filter((application) => (application.status === "REJECTED" || application.status === "CANCELLED") && application.quotedAmount);
  for (const application of terminal) {
    const kind = application.status as ClosingStatus;
    const existing = await tx.returnObligation.findUnique({
      where: { applicationId_kind: { applicationId: application.id, kind } },
      select: { id: true, amount: true },
    });
    const desired = application.quotedAmount!;
    const increase = Math.min(Math.max(0, desired - (existing?.amount ?? 0)), checkedAvailableDepositAmount(ledger));
    if (increase <= 0) continue;
    const obligation = existing
      ? await tx.returnObligation.update({ where: { id: existing.id }, data: { amount: { increment: increase }, resolvedAt: null }, select: { id: true } })
      : await tx.returnObligation.create({ data: { submissionId, applicationId: application.id, kind, amount: increase }, select: { id: true } });
    for (const allocation of allocateFifo(ledger.deposits, ledger.allocations, increase)) {
      await tx.fundAllocation.create({ data: { depositId: allocation.depositId, returnObligationId: obligation.id, amount: allocation.amount } });
    }
    ledger = await ledgerForSubmission(tx, submissionId);
  }

  const unconfirmedCharges = checkedMoneyTotal(applications
    .filter((application) => application.status === "SUBMITTED" && application.quotedAmount)
    .map((application) => application.quotedAmount!));
  const excess = Math.max(0, checkedAvailableDepositAmount(ledger) - unconfirmedCharges);
  if (excess <= 0) return;
  const existingExcess = await tx.returnObligation.findFirst({
    where: { submissionId, applicationId: null, kind: "EXCESS", resolvedAt: null },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const obligation = existingExcess
    ? await tx.returnObligation.update({ where: { id: existingExcess.id }, data: { amount: { increment: excess } }, select: { id: true } })
    : await tx.returnObligation.create({ data: { submissionId, kind: "EXCESS", amount: excess }, select: { id: true } });
  for (const allocation of allocateFifo(ledger.deposits, ledger.allocations, excess)) {
    await tx.fundAllocation.create({ data: { depositId: allocation.depositId, returnObligationId: obligation.id, amount: allocation.amount } });
  }
}

/** Record a real bank transaction. It is idempotent only for the explicit operator key and never creates Payment/Reservation. */
export async function recordApplicationDepositCore(
  client: FinanceClient,
  input: { submissionId: string; amount: number; payerName: string; depositedAt: Date; idempotencyKey?: string; actorUserId: string; now: Date },
): Promise<{ depositId: string; availableAmount: number }> {
  if (!isStoredMoney(input.amount) || !isActualPastDate(input.depositedAt, input.now)) throw new InsufficientApplicationDepositError();
  return client.$transaction(async (tx) => {
    await lockSubmission(tx, input.submissionId);
    if (input.idempotencyKey) {
      const prior = await tx.applicationDeposit.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, submissionId: true } });
      if (prior) {
        if (prior.submissionId !== input.submissionId) throw new ApplicationNotPendingError();
        const ledger = await ledgerForSubmission(tx, input.submissionId);
        return { depositId: prior.id, availableAmount: checkedAvailableDepositAmount(ledger) };
      }
    }
    const deposit = await tx.applicationDeposit.create({
      data: { submissionId: input.submissionId, amount: input.amount, payerName: input.payerName, depositedAt: input.depositedAt, confirmedAt: input.now, confirmedById: input.actorUserId, idempotencyKey: input.idempotencyKey ?? null },
      select: { id: true },
    });
    await reconcileReturnObligations(tx, input.submissionId);
    const ledger = await ledgerForSubmission(tx, input.submissionId);
    return { depositId: deposit.id, availableAmount: checkedAvailableDepositAmount(ledger) };
  }, TX_OPTIONS);
}

/** Terminal group applications are independent. Their funded portion becomes a bank-return hold. */
export async function closeApplicationWithReturnCore(
  client: FinanceClient,
  input: { applicationId: string; status: ClosingStatus; resolutionNote: string; actorUserId: string; now: Date },
): Promise<void> {
  await client.$transaction(async (tx) => {
    const application = await tx.reservationApplication.findUnique({ where: { id: input.applicationId }, select: { id: true, submissionId: true, status: true } });
    if (!application?.submissionId || application.status !== "SUBMITTED") throw new ApplicationNotPendingError();
    await lockSubmission(tx, application.submissionId);
    const updated = await tx.reservationApplication.updateMany({
      where: { id: application.id, status: "SUBMITTED" },
      data: { status: input.status, resolutionNote: input.resolutionNote, resolvedAt: input.now, resolvedById: input.actorUserId },
    });
    if (updated.count !== 1) throw new ApplicationNotPendingError();
    await reconcileReturnObligations(tx, application.submissionId);
  }, TX_OPTIONS);
}

/**
 * Confirm selected siblings atomically. Available funds are consumed FIFO and every payment item
 * is an exact snapshot quote; excess stays in the pre-reservation ledger.
 */
export async function confirmApplicationSubmissionCore(
  client: FinanceClient,
  input: { submissionId: string; choices: ConfirmChoice[]; actorUserId: string; now: Date },
): Promise<{ paymentId: string; reservationIds: string[] }> {
  const choices = [...input.choices].sort((a, b) => a.applicationId.localeCompare(b.applicationId));
  if (choices.length === 0 || new Set(choices.map((choice) => choice.applicationId)).size !== choices.length || choices.some((choice) => Boolean(choice.childId) === Boolean(choice.newChild))) throw new ApplicationNotPendingError();
  const selectionFingerprint = submissionSelectionFingerprint(choices);
  return client.$transaction(async (tx) => {
    await lockSubmission(tx, input.submissionId);
    const applicationIds = choices.map((choice) => choice.applicationId);
    // Submission serialization alone is insufficient when a retention purge or
    // another bulk operation targets an application row.  Keep the documented
    // parent -> application -> class -> child order and re-read after locking.
    await tx.$queryRaw`
      SELECT "id" FROM "ReservationApplication"
      WHERE "id" IN (${Prisma.join(applicationIds)}) AND "submissionId" = ${input.submissionId}
      ORDER BY "id" FOR UPDATE
    `;
    const applications = await tx.reservationApplication.findMany({
      where: { id: { in: applicationIds }, submissionId: input.submissionId },
      select: { id: true, status: true, classScheduleId: true, quotedAmount: true, requestedChildId: true, requestedChildPurgedAt: true, reservationId: true, childId: true, childName: true, childBirthDate: true, childGender: true, privacyConsentAgreed: true, photoShareConsentAgreed: true, photoMarketingConsentAgreed: true, consentVersion: true, submittedAt: true },
      orderBy: { id: "asc" },
    }) as SubmissionRows;
    if (applications.length !== choices.length || applications.some((app) => app.status !== "SUBMITTED" || !app.quotedAmount)) throw new ApplicationNotPendingError();
    const submission = await tx.reservationApplicationSubmission.findUnique({ where: { id: input.submissionId }, select: { guardianName: true, guardianPhone: true } });
    if (!submission?.guardianName || !submission.guardianPhone) throw new ApplicationNotPendingError();
    const guardianName = submission.guardianName;
    const guardianPhone = submission.guardianPhone;
    // Establish a single global order before reservation creation. The helper below will take
    // re-entrant locks, but it cannot invert this sibling order under concurrent bulk confirms.
    const classIds = applications.map((application) => application.classScheduleId).sort();
    await tx.$queryRaw`
      SELECT "id" FROM "ClassSchedule" WHERE "id" IN (${Prisma.join(classIds)}) ORDER BY "id" FOR UPDATE
    `;
    const existingChildIds = [...new Set([
      ...choices.flatMap((choice) => choice.childId ? [choice.childId] : []),
      ...applications.flatMap((application) => application.requestedChildId ? [application.requestedChildId] : []),
    ])].sort();
    if (existingChildIds.length > 0) {
      await tx.$queryRaw`
        SELECT "id" FROM "Child" WHERE "id" IN (${Prisma.join(existingChildIds)}) ORDER BY "id" FOR SHARE
      `;
    }

    await reconcileReturnObligations(tx, input.submissionId);
    const ledger = await ledgerForSubmission(tx, input.submissionId);
    const total = checkedMoneyTotal(applications.map((application) => application.quotedAmount!));
    if (checkedAvailableDepositAmount(ledger) < total) throw new InsufficientApplicationDepositError();

    // Existing paid/reused reservations are rejected before any reservation or payment write.
    const reservations = await tx.reservation.findMany({
      where: {
        OR: choices.filter((choice): choice is ConfirmChoice & { childId: string } => Boolean(choice.childId)).map((choice) => {
          const app = applications.find((candidate) => candidate.id === choice.applicationId)!;
          return { classScheduleId: app.classScheduleId, childId: choice.childId };
        }),
      },
      select: { id: true },
    });
    if (reservations.length > 0) {
      const existingItems = await tx.paymentItem.count({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
      if (existingItems > 0) throw new ApplicationPaymentAlreadyExistsError();
    }

    const newIdentityLocks = [...new Set(applications
      .filter((application) => choices.find((choice) => choice.applicationId === application.id)?.newChild)
      .map((application) => {
        if (!application.childName || !application.childBirthDate || !application.childGender) throw new ApplicationNotPendingError();
        return newChildIdentityLockKey({ name: application.childName, birthDate: application.childBirthDate, guardianName, guardianPhone });
      }))].sort();
    for (const identity of newIdentityLocks) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0::bigint))`;
    }

    const reservationIds: string[] = [];
    for (const application of applications) {
      const choice = choices.find((candidate) => candidate.applicationId === application.id)!;
      if (application.requestedChildPurgedAt || (application.requestedChildId && application.requestedChildId !== choice.childId)) throw new ApplicationNotPendingError();
      let childId = choice.childId;
      if (choice.newChild) {
        if (!application.childName || !application.childBirthDate || !application.childGender) throw new ApplicationNotPendingError();
        const exactCandidates = await tx.child.findMany({
          where: { name: application.childName, birthDate: application.childBirthDate, gender: application.childGender, guardianName, guardianPhone, personalDataPurgedAt: null },
          select: { id: true },
          take: 2,
        });
        // A duplicate identity is never silently turned into a second Child to evade a paid
        // reservation check. ADMIN must select the verified existing candidate instead.
        if (exactCandidates.length > 0) throw new ApplicationNotPendingError();
        const child: { id: string } = await tx.child.create({
          data: { name: application.childName, birthDate: application.childBirthDate, gender: application.childGender, guardianName, guardianPhone },
          select: { id: true },
        });
        childId = child.id;
      }
      if (!childId) throw new ApplicationNotPendingError();
      if (!choice.newChild) {
        const candidate: { name: string; birthDate: Date | null; gender: "MALE" | "FEMALE" | "UNSPECIFIED"; guardianName: string | null; guardianPhone: string | null; personalDataPurgedAt: Date | null; isActive: boolean } | null = await tx.child.findUnique({ where: { id: childId }, select: { name: true, birthDate: true, gender: true, guardianName: true, guardianPhone: true, personalDataPurgedAt: true, isActive: true } });
        if (!candidate || !candidate.birthDate || candidate.personalDataPurgedAt || !candidate.isActive || candidate.name !== application.childName || candidate.birthDate.getTime() !== application.childBirthDate?.getTime() || candidate.gender !== application.childGender || candidate.guardianName !== guardianName || candidate.guardianPhone !== guardianPhone) {
          throw new ApplicationNotPendingError();
        }
      }
      let reservation: { id: string };
      const confirmedOverbooking = hasBoundOverbookingConfirmation({ choice, application, selectionFingerprint });
      try {
        reservation = await createReservationInTransaction(tx, {
          classScheduleId: application.classScheduleId,
          childId,
          memo: choice.memo,
          confirmOverbooking: confirmedOverbooking ? "true" : undefined,
          confirmedClassScheduleId: confirmedOverbooking ? application.classScheduleId : undefined,
          confirmedChildId: confirmedOverbooking ? childId : undefined,
        });
      } catch (error) {
        if (error instanceof OverbookingConfirmationRequiredError) {
          throw new ApplicationSubmissionOverbookingConfirmationError(
            application.id,
            application.classScheduleId,
            choice.newChild ? "NEW" : childId,
            selectionFingerprint,
            error.capacity,
            error.reservedCount,
          );
        }
        throw error;
      }
      reservationIds.push(reservation.id);
      const updated = await tx.reservationApplication.updateMany({
        where: { id: application.id, status: "SUBMITTED" },
        data: { status: "CONFIRMED", childId, reservationId: reservation.id, resolvedAt: input.now, resolvedById: input.actorUserId },
      });
      if (updated.count !== 1) throw new ApplicationNotPendingError();
      const devices = await tx.deviceSubmission.findMany({ where: { submissionId: input.submissionId }, select: { deviceId: true } });
      if (devices.length > 0) {
        await tx.deviceChild.createMany({ data: devices.map((device) => ({ deviceId: device.deviceId, childId })), skipDuplicates: true });
      }
      const [latestShare, latestMarketing] = await Promise.all((['PHOTO_SHARE', 'PHOTO_MARKETING'] as const).map((consentType) => tx.childConsent.findFirst({ where: { childId, consentType }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], select: { action: true } })));
      await tx.childConsent.createMany({ data: planApplicationConsentRecords({ photoShareConsentAgreed: application.photoShareConsentAgreed, photoMarketingConsentAgreed: application.photoMarketingConsentAgreed, currentPhotoShareAction: latestShare?.action ?? null, currentPhotoMarketingAction: latestMarketing?.action ?? null }).map((record) => ({ childId, consentType: record.consentType, action: record.action, recordedAt: application.submittedAt, recordedById: input.actorUserId, reservationApplicationId: application.id, consentVersion: application.consentVersion })) });
    }

    const payment = await tx.payment.create({
      data: { payerType: "GUARDIAN", method: "TRANSFER", status: "PAID", totalAmount: total, paidAt: input.now },
      select: { id: true },
    });
    const mappings: Array<{ id: string; applicationId: string }> = [];
    for (let index = 0; index < applications.length; index += 1) {
      const application = applications[index]!;
      const item = await tx.paymentItem.create({
        data: { paymentId: payment.id, reservationId: reservationIds[index]!, amount: application.quotedAmount!, discountAmount: 0, paidAmount: application.quotedAmount!, refundedAmount: 0 },
        select: { id: true },
      });
      const mapping = await tx.reservationApplicationPaymentMapping.create({ data: { applicationId: application.id, paymentItemId: item.id }, select: { id: true } });
      mappings.push({ id: mapping.id, applicationId: application.id });
    }
    for (const mapping of mappings) {
      const application = applications.find((row) => row.id === mapping.applicationId)!;
      const currentAllocations = await tx.fundAllocation.findMany({
        where: { deposit: { submissionId: input.submissionId } },
        select: { depositId: true, amount: true, paymentMappingId: true, returnObligationId: true },
      });
      for (const allocation of allocateFifo(ledger.deposits, currentAllocations, application.quotedAmount!)) {
        await tx.fundAllocation.create({ data: { depositId: allocation.depositId, paymentMappingId: mapping.id, amount: allocation.amount } });
      }
    }
    return { paymentId: payment.id, reservationIds };
  }, TX_OPTIONS);
}

/** Returns are limited to a fully funded obligation and accumulate without modifying Payment/Refund/Revenue. */
export async function recordApplicationReturnCore(
  client: FinanceClient,
  input: { obligationId: string; amount: number; reason: string; returnedAt: Date; idempotencyKey: string; actorUserId: string; now: Date },
): Promise<{ returnId: string; remainingAmount: number }> {
  if (!isStoredMoney(input.amount) || !isActualPastDate(input.returnedAt, input.now)) throw new ApplicationReturnAmountExceededError();
  return client.$transaction(async (tx) => {
    // The parent submission serializes deposits, return holds and actual returns.  Find the
    // parent first, then retain the documented Submission -> ReturnObligation lock order.
    const target = await tx.returnObligation.findUnique({
      where: { id: input.obligationId },
      select: { submissionId: true },
    });
    if (!target) throw new ApplicationReturnAmountExceededError();
    await lockSubmission(tx, target.submissionId);
    // A repeated successful request must be recognized before the remaining-balance
    // check.  Otherwise a completed full return looks like an over-return on retry.
    // Input amount/reason/actor changes do not create a second bank-return record.
    const prior = await tx.applicationReturn.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, returnObligationId: true } });
    const [obligation] = await tx.$queryRaw<{ id: string; amount: number; returnedAmount: number }[]>`
      SELECT "id", "amount", "returnedAmount" FROM "ReturnObligation" WHERE "id" = ${input.obligationId} FOR UPDATE
    `;
    if (!obligation) throw new ApplicationReturnAmountExceededError();
    const funding = await tx.fundAllocation.aggregate({
      where: { returnObligationId: obligation.id },
      _sum: { amount: true },
    });
    if (funding._sum.amount !== obligation.amount) throw new ApplicationReturnAmountExceededError();
    if (prior) {
      if (prior.returnObligationId !== obligation.id) throw new ApplicationReturnAmountExceededError();
      return { returnId: prior.id, remainingAmount: obligation.amount - obligation.returnedAmount };
    }
    if (obligation.returnedAmount + input.amount > obligation.amount || obligation.returnedAmount + input.amount > MAX_POSTGRES_INTEGER) throw new ApplicationReturnAmountExceededError();
    const created = await tx.applicationReturn.create({ data: { returnObligationId: obligation.id, amount: input.amount, returnedAt: input.returnedAt, processedById: input.actorUserId, reason: input.reason, idempotencyKey: input.idempotencyKey }, select: { id: true } });
    const next = obligation.returnedAmount + input.amount;
    await tx.returnObligation.update({ where: { id: obligation.id }, data: { returnedAmount: next, resolvedAt: next === obligation.amount ? input.now : null } });
    return { returnId: created.id, remainingAmount: obligation.amount - next };
  }, TX_OPTIONS);
}
