import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { START, application, bootstrap, fixtureClass, paidFixture, request, reservationSession, setup } from "./helpers";

describe("synthetic reservation and finance flow", () => {
  it("keeps application/deposit outside revenue; maps one payment and repeated partial refunds once", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const submitted = await application(context, operator, classId, "child-1", 150);
    expect(await context.flow.revenue(operator.get(), operator.runId)).toEqual({ gross: 0, refunds: 0, net: 0 });
    const confirmed = await context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: submitted.applicationId });
    expect(await context.flow.revenue(operator.get(), operator.runId)).toEqual({ gross: 0, refunds: 0, net: 0 });
    const paymentInput = { runId: operator.runId, ...confirmed, amount: 100, requestKey: randomUUID() };
    const paid = await context.flow.payment(operator.post(), paymentInput);
    expect(await context.flow.payment(operator.post(), paymentInput)).toEqual(paid);
    await expect(context.flow.payment(operator.post(), { ...paymentInput, requestKey: randomUUID() })).rejects.toThrow("ALREADY_PAID");
    for (const amount of [20, 30]) {
      const refundInput = { runId: operator.runId, ...paid, amount, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() };
      const refund = await context.flow.refund(operator.post(), refundInput);
      expect(await context.flow.refund(operator.post(), refundInput)).toEqual(refund);
    }
    expect(await context.flow.revenue(operator.get(), operator.runId)).toEqual({ gross: 100, refunds: 50, net: 50 });
    const last = await context.flow.refund(operator.post(), { runId: operator.runId, ...paid, amount: 50, reason: "CLASS_CANCELLED", requestKey: randomUUID() });
    expect(last.status).toBe("REFUNDED");
    expect(await context.flow.revenue(operator.get(), operator.runId)).toEqual({ gross: 100, refunds: 100, net: 0 });
  });

  it("serializes concurrent refunds and prevents repeated over-refund", async () => {
    const context = setup();
    const { operator, paymentId } = await paidFixture(context);
    const refund = () => context.flow.refund(operator.post(), { runId: operator.runId, paymentId, amount: 60, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() });
    const outcomes = await Promise.allSettled([refund(), refund()]);
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((row) => row.status === "rejected")).toHaveLength(1);
    await expect(refund()).rejects.toThrow("OVER_REFUND");
    expect(await context.flow.revenue(operator.get(), operator.runId)).toEqual({ gross: 100, refunds: 60, net: 40 });
  });

  it("deduplicates simultaneous same-key refunds and refuses changed retry payloads", async () => {
    const context = setup();
    const { operator, paymentId } = await paidFixture(context);
    const input = { runId: operator.runId, paymentId, amount: 10, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() };
    const results = await Promise.all([context.flow.refund(operator.post(), input), context.flow.refund(operator.post(), input)]);
    expect(results[0]).toEqual(results[1]);
    await expect(context.flow.refund(operator.post(), { ...input, amount: 20 })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect((await context.flow.revenue(operator.get(), operator.runId)).refunds).toBe(10);
  });

  it("enforces capacity8 at confirmation and allows explicit operator overbooking only", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    for (let index = 1; index <= 8; index++) {
      const submitted = await application(context, operator, classId, `child-${index}`);
      await context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: submitted.applicationId });
    }
    const ninth = await application(context, operator, classId, "child-9");
    const input = { runId: operator.runId, applicationId: ninth.applicationId };
    await expect(context.flow.confirm(operator.post(), input)).rejects.toThrow("OVERBOOKING_CONFIRMATION_REQUIRED");
    await expect(context.flow.confirm(ninth.reservation.post(), { ...input, confirmOverbooking: true })).rejects.toThrow("UNAUTHORIZED");
    await expect(context.flow.confirm(operator.post(), { ...input, confirmOverbooking: true })).resolves.toHaveProperty("reservationId");
  });

  it("serializes last-seat confirmation without overselling", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator, { capacity: 1 });
    const first = await application(context, operator, classId);
    const second = await application(context, operator, classId, "child-2");
    const outcomes = await Promise.allSettled([first, second].map((row) => context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: row.applicationId })));
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  });

  it("rejects inactive Child and duplicate reservations", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const inactive = await application(context, operator, classId, "child-12");
    await expect(context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: inactive.applicationId })).rejects.toThrow("CHILD_INACTIVE");
    const first = await application(context, operator, classId);
    const second = await application(context, operator, classId);
    await context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: first.applicationId });
    await expect(context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: second.applicationId })).rejects.toThrow("DUPLICATE_RESERVATION");
  });

  it.each(["CANCELLED", "ENDED"])("rechecks %s class at submit/confirm", async (state) => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const submitted = await application(context, operator, classId);
    const pendingSession = await reservationSession(context, operator, classId);
    await context.db.$transaction(operator.runId, (tx) => {
      if (state === "CANCELLED") tx.run.data.classes[classId].status = "CANCELLED";
      else { tx.run.data.classes[classId].startsAt = START - 200; tx.run.data.classes[classId].endsAt = START - 100; }
    });
    await expect(context.flow.submit(pendingSession.post(), { runId: operator.runId, childId: "child-2" })).rejects.toThrow("SUBMISSION_UNAVAILABLE");
    await expect(context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: submitted.applicationId })).rejects.toThrow("CLASS_UNAVAILABLE");
  });

  it("requires deposit sufficiency, exact fixed synthetic quote and confirmation before payment", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const submitted = await application(context, operator, classId, "child-1", 40);
    const confirmInput = { runId: operator.runId, applicationId: submitted.applicationId };
    await expect(context.flow.confirm(operator.post(), confirmInput)).rejects.toThrow("INSUFFICIENT_DEPOSIT");
    await expect(context.flow.payment(operator.post(), { runId: operator.runId, reservationId: randomUUID(), amount: 100, requestKey: randomUUID() })).rejects.toThrow("RESERVATION_UNAVAILABLE");
    await context.flow.deposit(operator.post(), { ...confirmInput, amount: 60, requestKey: randomUUID() });
    const confirmed = await context.flow.confirm(operator.post(), confirmInput);
    expect(await context.flow.confirm(operator.post(), confirmInput)).toEqual(confirmed);
    await expect(context.flow.payment(operator.post(), { runId: operator.runId, ...confirmed, amount: 101, requestKey: randomUUID() })).rejects.toThrow("PAYMENT_AMOUNT_MISMATCH");
    expect(await context.flow.revenue(operator.get(), operator.runId)).toEqual({ gross: 0, refunds: 0, net: 0 });
  });

  it.each(["NO_SHOW", "CANCELLED_ABSENT"])("requires a synthetic detail for %s refund", async (state) => {
    const context = setup();
    const { operator, reservationId, paymentId } = await paidFixture(context);
    await context.db.$transaction(operator.runId, (tx) => {
      tx.run.data.reservations[reservationId].status = state === "NO_SHOW" ? "NO_SHOW" : "CANCELLED";
      if (state !== "NO_SHOW") tx.run.data.reservations[reservationId].attendance = "ABSENT";
    });
    const input = { runId: operator.runId, paymentId, amount: 10, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() };
    await expect(context.flow.refund(operator.post(), input)).rejects.toThrow("REFUND_DETAIL_REQUIRED");
    await expect(context.flow.refund(operator.post(), { ...input, detail: "SYNTHETIC_NO_SHOW_APPROVAL" })).resolves.toHaveProperty("refundId");
  });

  it("denies finance and other submissions/runs to a reservation cookie", async () => {
    const context = setup();
    const { operator, reservation, paymentId } = await paidFixture(context);
    const other = await bootstrap(context);
    await expect(context.flow.revenue(reservation.get(), operator.runId)).rejects.toThrow("UNAUTHORIZED");
    await expect(context.flow.refund(reservation.post(), { runId: operator.runId, paymentId, amount: 10, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() })).rejects.toThrow("UNAUTHORIZED");
    await expect(context.flow.submit(reservation.post(), { runId: other.runId, childId: "child-2" })).rejects.toThrow("UNAUTHORIZED");
    await expect(context.flow.submit(reservation.post(), { runId: operator.runId, childId: "child-2" })).rejects.toThrow("ALREADY_SUBMITTED");
    const session = await context.flow.session(reservation.get(), operator.runId, "RESERVATION");
    expect(session).not.toHaveProperty("data");
    expect(JSON.stringify(session)).not.toContain(paymentId);
    expect(await context.flow.revenue(other.get(), other.runId)).toEqual({ gross: 0, refunds: 0, net: 0 });
  });

  it("cannot inject a foreign class, application or payment from another run", async () => {
    const context = setup();
    const first = await paidFixture(context);
    const second = await bootstrap(context);
    await expect(context.flow.createGrant(second.post(), { runId: second.runId, classId: first.classId })).rejects.toThrow("CLASS_UNAVAILABLE");
    await expect(context.flow.confirm(second.post(), { runId: second.runId, applicationId: first.applicationId })).rejects.toThrow("APPLICATION_UNAVAILABLE");
    await expect(context.flow.refund(second.post(), { runId: second.runId, paymentId: first.paymentId, amount: 10, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() })).rejects.toThrow("PAYMENT_UNAVAILABLE");
  });

  it.each([-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("rejects invalid refund money %s", async (amount) => {
    const context = setup();
    const { operator, paymentId } = await paidFixture(context);
    await expect(context.flow.refund(operator.post(), { runId: operator.runId, paymentId, amount, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() })).rejects.toThrow();
    expect((await context.flow.revenue(operator.get(), operator.runId)).refunds).toBe(0);
  });

  it("rejects PII/unrecognized fields and teacher duplicates; warns for one fixture teacher", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    await expect(fixtureClass(context, operator, { teacherIds: [] })).rejects.toThrow();
    await expect(fixtureClass(context, operator, { teacherIds: ["teacher-1", "teacher-1"] })).rejects.toThrow();
    expect((await fixtureClass(context, operator, { teacherIds: ["teacher-1"] })).teacherWarning).toBe(true);
    const { classId } = await fixtureClass(context, operator);
    const session = await reservationSession(context, operator, classId);
    await expect(context.flow.submit(session.post(), { runId: operator.runId, childId: "child-1", guardianPhone: "real-phone" })).rejects.toThrow();
    await expect(context.flow.submit(session.post(), { runId: operator.runId, childId: "real-name" })).rejects.toThrow();
  });

  it("detects inconsistent refund counters and orphan refund facts before returning revenue", async () => {
    const context = setup();
    const { operator, paymentId } = await paidFixture(context);
    await context.db.$transaction(operator.runId, (tx) => { tx.run.data.payments[paymentId].refundedAmount = 1; });
    await expect(context.flow.revenue(operator.get(), operator.runId)).rejects.toThrow("LEDGER_INCONSISTENT");
    await context.db.$transaction(operator.runId, (tx) => {
      tx.run.data.payments[paymentId].refundedAmount = 0;
      tx.run.data.refunds.push({ id: randomUUID(), paymentId: randomUUID(), amount: 1, reason: "OTHER" });
    });
    await expect(context.flow.revenue(operator.get(), operator.runId)).rejects.toThrow("LEDGER_INCONSISTENT");
  });

  it("rolls back overflow and idempotency-conflict deposits", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const submitted = await application(context, operator, classId, "child-1", 0);
    const input = { runId: operator.runId, applicationId: submitted.applicationId, amount: Number.MAX_SAFE_INTEGER, requestKey: randomUUID() };
    const first = await context.flow.deposit(operator.post(), input);
    expect(await context.flow.deposit(operator.post(), input)).toEqual(first);
    await expect(context.flow.deposit(operator.post(), { ...input, amount: 1 })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(context.flow.deposit(operator.post(), { ...input, amount: 1, requestKey: randomUUID() })).rejects.toThrow("MONEY_OVERFLOW");
    await context.db.$transaction(operator.runId, (tx) => {
      expect(tx.run.data.deposits).toHaveLength(1);
    });
    await expect(context.flow.deposit(request("POST"), input)).rejects.toThrow("UNAUTHORIZED");
  });
});
