import { randomUUID } from "node:crypto";
import type { MockRun } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, MOCK_TTL, opaqueToken, tokenHash } from "./auth";
import { classSchema, confirmSchema, depositSchema, linkSchema, paymentSchema, refundSchema, runBodySchema, submissionSchema } from "./contracts";
import { requireManual } from "./errors";

function sumMoney(values: number[]) {
  const total = values.reduce((sum, value) => sum + BigInt(value), BigInt(0));
  requireManual(total >= 0 && total <= BigInt(Number.MAX_SAFE_INTEGER), "MONEY_OVERFLOW");
  return Number(total);
}
function deposited(run: MockRun, applicationId: string) {
  return sumMoney(run.data.deposits.filter((row) => row.applicationId === applicationId).map((row) => row.amount));
}
function once<T>(run: MockRun, operation: string, requestKey: string, input: unknown, execute: () => T): T {
  const key = `${operation}:${requestKey}`;
  const payload = JSON.stringify(input);
  const previous = run.receipts[key];
  if (previous) {
    requireManual(previous.payload === payload, "IDEMPOTENCY_CONFLICT", 409);
    return previous.result as T;
  }
  const result = execute();
  run.receipts[key] = { payload, result };
  return result;
}
function checkPaymentIntegrity(run: MockRun) {
  requireManual(run.data.refunds.every((row) => run.data.payments[row.paymentId] && row.amount > 0 && Number.isSafeInteger(row.amount)), "LEDGER_INCONSISTENT", 409);
  const seen = new Set<string>();
  for (const payment of Object.values(run.data.payments)) {
    const reservation = run.data.reservations[payment.reservationId];
    const application = reservation && run.data.applications[reservation.applicationId];
    requireManual(Number.isSafeInteger(payment.amount) && payment.amount >= 0 && !seen.has(payment.reservationId) && application && application.quotedAmount === payment.amount && deposited(run, application.id) >= payment.amount, "LEDGER_INCONSISTENT", 409);
    seen.add(payment.reservationId);
    const refunds = sumMoney(run.data.refunds.filter((row) => row.paymentId === payment.id).map((row) => row.amount));
    requireManual(refunds === payment.refundedAmount && refunds <= payment.amount, "LEDGER_INCONSISTENT", 409);
    const status = refunds === 0 ? "PAID" : refunds === payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
    requireManual(payment.status === status, "LEDGER_INCONSISTENT", 409);
  }
}

/** Synthetic single-child fixture flow. Does not call production reservation or payment services. */
export class ManualTestFlow {
  constructor(readonly auth: ManualTestAuth) {}

  async session(request: Request, runId: string, scope: "OPERATOR" | "RESERVATION") {
    runBodySchema.parse({ runId });
    return this.auth.withSession(request, runId, scope, (run, session) => {
      const csrf = opaqueToken();
      session.csrfHash = tokenHash("csrf", csrf);
      return scope === "OPERATOR"
        ? { runId, scope, csrf, expiresAt: session.expiresAt, mode: run.mode, fixtureTeacherIds: ["teacher-1", "teacher-2"], data: run.data }
        : { runId, scope, csrf, expiresAt: session.expiresAt, application: session.applicationId ? { id: session.applicationId, status: run.data.applications[session.applicationId]?.status } : null };
    });
  }

  async createClass(request: Request, input: unknown) {
    const body = classSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => {
      requireManual(body.startsAt > this.auth.now(), "CLASS_TIME_INVALID");
      const id = randomUUID();
      run.data.classes[id] = {
        id, capacity: body.capacity, teacherIds: body.teacherIds, quotedAmount: body.quotedAmount,
        startsAt: body.startsAt, endsAt: body.endsAt, status: "SCHEDULED",
      };
      return { classId: id, teacherWarning: body.teacherIds.length < 2 };
    });
  }

  async createGrant(request: Request, input: unknown) {
    const body = linkSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => {
      const classRow = run.data.classes[body.classId];
      requireManual(classRow?.status === "SCHEDULED" && classRow.startsAt > this.auth.now(), "CLASS_UNAVAILABLE", 409);
      const grant = opaqueToken();
      const hash = tokenHash("grant", grant);
      const expiresAt = Math.min(run.expiresAt, this.auth.now() + MOCK_TTL.grant);
      run.grants[hash] = { hash, runId: run.id, classId: body.classId, expiresAt, consumed: false };
      return { runId: run.id, grant, expiresAt };
    });
  }

  async submit(request: Request, input: unknown) {
    const body = submissionSchema.parse(input);
    return this.auth.withSession(request, body.runId, "RESERVATION", (run, session) => {
      const classRow = session.classId && run.data.classes[session.classId];
      requireManual(!session.applicationId, "ALREADY_SUBMITTED", 409);
      requireManual(classRow && classRow.status === "SCHEDULED" && classRow.startsAt > this.auth.now(), "SUBMISSION_UNAVAILABLE", 409);
      requireManual(run.data.children[body.childId], "SYNTHETIC_CHILD_REQUIRED");
      const id = randomUUID();
      run.data.applications[id] = { id, classId: classRow.id, childId: body.childId, quotedAmount: classRow.quotedAmount, status: "PENDING" };
      session.applicationId = id;
      // No capacity, prices, other applications or finance data crosses reservation scope.
      return { applicationId: id, status: "PENDING" as const };
    });
  }

  async deposit(request: Request, input: unknown) {
    const body = depositSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => once(run, "deposit", body.requestKey, body, () => {
      const application = run.data.applications[body.applicationId];
      requireManual(application?.status === "PENDING", "APPLICATION_UNAVAILABLE", 409);
      sumMoney([deposited(run, application.id), body.amount]);
      const id = randomUUID();
      run.data.deposits.push({ id, applicationId: application.id, amount: body.amount });
      return { depositId: id };
    }));
  }

  async confirm(request: Request, input: unknown) {
    const body = confirmSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => {
      const application = run.data.applications[body.applicationId];
      requireManual(application, "APPLICATION_UNAVAILABLE", 409);
      if (application.reservationId) return { reservationId: application.reservationId };
      const classRow = run.data.classes[application.classId];
      requireManual(classRow?.status === "SCHEDULED" && classRow.endsAt > this.auth.now(), "CLASS_UNAVAILABLE", 409);
      requireManual(run.data.children[application.childId]?.active, "CHILD_INACTIVE", 409);
      const reservations = Object.values(run.data.reservations).filter((row) => row.classId === classRow.id);
      requireManual(!reservations.some((row) => row.childId === application.childId), "DUPLICATE_RESERVATION", 409);
      requireManual(reservations.filter((row) => row.status === "RESERVED").length < classRow.capacity || body.confirmOverbooking, "OVERBOOKING_CONFIRMATION_REQUIRED", 409);
      requireManual(deposited(run, application.id) >= application.quotedAmount, "INSUFFICIENT_DEPOSIT", 409);
      const id = randomUUID();
      run.data.reservations[id] = { id, applicationId: application.id, classId: classRow.id, childId: application.childId, status: "RESERVED" };
      application.status = "CONFIRMED";
      application.reservationId = id;
      return { reservationId: id };
    });
  }

  async payment(request: Request, input: unknown) {
    const body = paymentSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => once(run, "payment", body.requestKey, body, () => {
      const reservation = run.data.reservations[body.reservationId];
      const application = reservation && run.data.applications[reservation.applicationId];
      requireManual(reservation && application?.status === "CONFIRMED", "RESERVATION_UNAVAILABLE", 409);
      requireManual(!Object.values(run.data.payments).some((row) => row.reservationId === reservation.id), "ALREADY_PAID", 409);
      requireManual(body.amount === application.quotedAmount && body.amount <= deposited(run, application.id), "PAYMENT_AMOUNT_MISMATCH", 409);
      sumMoney([...Object.values(run.data.payments).map((row) => row.amount), body.amount]);
      const id = randomUUID();
      run.data.payments[id] = { id, reservationId: reservation.id, amount: body.amount, refundedAmount: 0, status: "PAID" };
      return { paymentId: id };
    }));
  }

  async refund(request: Request, input: unknown) {
    const body = refundSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => once(run, "refund", body.requestKey, body, () => {
      checkPaymentIntegrity(run);
      const payment = run.data.payments[body.paymentId];
      requireManual(payment, "PAYMENT_UNAVAILABLE", 409);
      const reservation = run.data.reservations[payment.reservationId];
      requireManual(reservation, "LEDGER_INCONSISTENT", 409);
      requireManual(!(reservation.status === "NO_SHOW" || reservation.attendance === "ABSENT" || body.reason === "OTHER") || body.detail, "REFUND_DETAIL_REQUIRED");
      requireManual(body.amount <= payment.amount - payment.refundedAmount, "OVER_REFUND", 409);
      const id = randomUUID();
      run.data.refunds.push({ id, paymentId: payment.id, amount: body.amount, reason: body.reason, detail: body.detail });
      payment.refundedAmount += body.amount;
      payment.status = payment.refundedAmount === payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
      checkPaymentIntegrity(run);
      return { refundId: id, refundedAmount: payment.refundedAmount, status: payment.status };
    }));
  }

  async revenue(request: Request, runId: string) {
    runBodySchema.parse({ runId });
    return this.auth.withSession(request, runId, "OPERATOR", (run) => {
      checkPaymentIntegrity(run);
      const gross = sumMoney(Object.values(run.data.payments).map((row) => row.amount));
      const refunds = sumMoney(run.data.refunds.map((row) => row.amount));
      return { gross, refunds, net: gross - refunds };
    });
  }
}
