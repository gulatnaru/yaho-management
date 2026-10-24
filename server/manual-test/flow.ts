import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { MockRun } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, MOCK_TTL, opaqueToken, tokenHash } from "./auth";
import { cancellationSchema, classSchema, confirmSchema, depositSchema, linkSchema, paymentSchema, refundSchema, runBodySchema, submissionSchema } from "./contracts";
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
  const payload = createHash("sha256").update(JSON.stringify(input)).digest("hex");
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

/** Synthetic fixture flow. Does not call production reservation or payment services. */
export class ManualTestFlow {
  constructor(readonly auth: ManualTestAuth) {}

  async session(request: Request, runId: string, scope: "OPERATOR" | "RESERVATION") {
    runBodySchema.parse({ runId });
    return this.auth.withSession(request, runId, scope, (run, session) => {
      const issued = this.auth.refreshSession(session);
      if (scope === "OPERATOR") return { runId, scope, ...issued, expiresAt: session.expiresAt, mode: run.mode, fixtureTeacherIds: ["teacher-1", "teacher-2"], data: run.data };
      const applications = (session.applicationIds ?? (session.applicationId ? [session.applicationId] : [])).map((id) => {
        const application = run.data.applications[id];
        requireManual(application && application.classId === session.classId, "UNAUTHORIZED", 401);
        const reservation = application.reservationId && run.data.reservations[application.reservationId];
        return { id, childId: application.childId, status: reservation && reservation.status === "CANCELLED" ? "CANCELLED" as const : application.status };
      });
      // Only this session's application IDs, fixture IDs and status cross reservation scope.
      const first = applications[0];
      return { runId, scope, ...issued, expiresAt: session.expiresAt, classStatus: session.classId ? run.data.classes[session.classId]?.status : undefined,
        applications, application: first ? { id: first.id, status: first.status } : null };
    });
  }

  async createClass(request: Request, input: unknown) {
    const body = classSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => {
      requireManual(run.mode !== "DATABASE" || body.quotedAmount <= 2147483647, "MONEY_OUT_OF_RANGE");
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
      requireManual(!session.applicationId && !session.applicationIds?.length, "ALREADY_SUBMITTED", 409);
      requireManual(classRow && classRow.status === "SCHEDULED" && classRow.startsAt > this.auth.now(), "SUBMISSION_UNAVAILABLE", 409);
      const childIds = body.childIds ?? [body.childId!];
      requireManual(childIds.every((id) => run.data.children[id]), "SYNTHETIC_CHILD_REQUIRED");
      const applications = childIds.map((childId) => {
        const id = randomUUID();
        run.data.applications[id] = { id, classId: classRow.id, childId, quotedAmount: classRow.quotedAmount, status: "PENDING" };
        return { id, childId, status: "PENDING" as const };
      });
      session.applicationIds = applications.map((row) => row.id);
      session.applicationId = applications[0].id;
      // No capacity, prices, other applications or finance data crosses reservation scope.
      return { applicationId: applications[0].id, status: "PENDING" as const, applications };
    });
  }

  async deposit(request: Request, input: unknown) {
    const body = depositSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => once(run, "deposit", body.requestKey, body, () => {
      requireManual(run.mode !== "DATABASE" || body.amount <= 2147483647, "MONEY_OUT_OF_RANGE");
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
      const classRow = run.data.classes[application.classId];
      requireManual(classRow?.status === "SCHEDULED" && classRow.endsAt > this.auth.now(), "CLASS_UNAVAILABLE", 409);
      if (application.reservationId) {
        requireManual(run.data.reservations[application.reservationId]?.status === "RESERVED", "RESERVATION_UNAVAILABLE", 409);
        return { reservationId: application.reservationId };
      }
      requireManual(application.status === "PENDING", "APPLICATION_UNAVAILABLE", 409);
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

  async cancel(request: Request, input: unknown) {
    const body = cancellationSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => {
      const target = body.kind === "CLASS" ? run.data.classes[body.targetId]
        : body.kind === "RESERVATION" ? run.data.reservations[body.targetId] : run.data.applications[body.targetId];
      requireManual(target, "CANCELLATION_UNAVAILABLE", 409);
      // Verified repeats are safe, including after a class was subsequently cancelled.
      if (target.status === "CANCELLED") return { targetId: target.id, status: "CANCELLED" as const };
      if (body.kind === "CLASS") {
        const classRow = run.data.classes[body.targetId];
        requireManual(classRow.status === "SCHEDULED" && classRow.endsAt >= this.auth.now(), "CANCELLATION_UNAVAILABLE", 409);
      } else if (body.kind === "RESERVATION") {
        const classId = "classId" in target ? target.classId : undefined;
        const classRow = classId && run.data.classes[classId];
        requireManual(classRow && classRow.status === "SCHEDULED" && classRow.endsAt >= this.auth.now(), "CLASS_UNAVAILABLE", 409);
        requireManual(target.status === "RESERVED", "CANCELLATION_UNAVAILABLE", 409);
      } else {
        const classId = "classId" in target ? target.classId : undefined;
        const classRow = classId && run.data.classes[classId];
        requireManual(classRow && classRow.endsAt >= this.auth.now(), "CLASS_UNAVAILABLE", 409);
        requireManual(target.status === "PENDING", "CANCELLATION_UNAVAILABLE", 409);
      }
      target.status = "CANCELLED";
      target.cancelledAt = this.auth.now();
      target.cancellationReason = body.reason;
      // Class cancellation preserves original reservation statuses. No ledger mutations or automatic refunds.
      return { targetId: target.id, status: "CANCELLED" as const };
    });
  }

  async payment(request: Request, input: unknown) {
    const body = paymentSchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => once(run, "payment", body.requestKey, body, () => {
      requireManual(run.mode !== "DATABASE" || body.amount <= 2147483647, "MONEY_OUT_OF_RANGE");
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
      requireManual(run.mode !== "DATABASE" || body.amount <= 2147483647, "MONEY_OUT_OF_RANGE");
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
