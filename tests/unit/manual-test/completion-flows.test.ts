import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { application, bootstrap, fixtureClass, paidFixture, request, reservationSession, setup } from "./helpers";
const reason = "SYNTHETIC_OPERATOR_CANCELLATION";

describe("manual-test atomic multi-child submissions", () => {
  it("submits two distinct children once and reveals only session-owned results on refresh", async () => {
    const c = setup();
    const op = await bootstrap(c);
    const { classId } = await fixtureClass(c, op);
    const own = await reservationSession(c, op, classId);
    const other = await reservationSession(c, op, classId);
    const body = { runId: op.runId, childIds: ["child-1", "child-2"] };
    const outcomes = await Promise.allSettled([c.flow.submit(own.post(), body), c.flow.submit(own.post(), body)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const fulfilled = outcomes.find((outcome) => outcome.status === "fulfilled")!;
    if (fulfilled.status !== "fulfilled") throw new Error("missing success");
    const result = fulfilled.value;
    expect(result.applications.map((row) => row.childId)).toEqual(body.childIds);
    const refreshed = await c.flow.session(own.get(), op.runId, "RESERVATION");
    expect(refreshed).toMatchObject({ applications: result.applications, classStatus: "SCHEDULED" });
    const foreign = await c.flow.session(other.get(), op.runId, "RESERVATION");
    expect(foreign).toMatchObject({ application: null, applications: [] });
    for (const key of ["data", "quotedAmount", "capacity", "payments", "deposits", "teacherIds"]) expect(JSON.stringify(refreshed)).not.toContain(`"${key}"`);
    await c.db.$transaction(op.runId, (tx) => { expect(Object.values(tx.run.data.applications)).toHaveLength(2); });
  });

  it.each([
    { childIds: ["child-1", "child-1"] }, { childIds: ["child-1", "child-13"] },
    { childIds: [] }, { childId: "child-1", childIds: ["child-2"] }, {},
  ])("rejects invalid batch atomically: %j", async (selection) => {
    const c = setup(); const op = await bootstrap(c); const { classId } = await fixtureClass(c, op);
    const own = await reservationSession(c, op, classId);
    await expect(c.flow.submit(own.post(), { runId: op.runId, ...selection })).rejects.toThrow();
    await c.db.$transaction(op.runId, (tx) => { expect(Object.keys(tx.run.data.applications)).toHaveLength(0); });
    expect((await c.flow.submit(own.post(), { runId: op.runId, childIds: ["child-1", "child-2"] })).applications).toHaveLength(2);
  });

  it("rolls back all children when a valid fixture is missing from the run", async () => {
    const c = setup(); const op = await bootstrap(c); const { classId } = await fixtureClass(c, op);
    const own = await reservationSession(c, op, classId);
    await c.db.$transaction(op.runId, (tx) => { delete tx.run.data.children["child-2"]; });
    await expect(c.flow.submit(own.post(), { runId: op.runId, childIds: ["child-1", "child-2"] })).rejects.toThrow("SYNTHETIC_CHILD_REQUIRED");
    await c.db.$transaction(op.runId, (tx) => { expect(Object.keys(tx.run.data.applications)).toHaveLength(0); });
  });
});

describe("manual-test cancellation", () => {
  it("cancels a reservation idempotently, refreshes own status and preserves finance", async () => {
    const c = setup(); const paid = await paidFixture(c); const { operator: op, reservationId } = paid;
    const input = { runId: op.runId, kind: "RESERVATION", targetId: reservationId, reason };
    const before = await c.db.$transaction(op.runId, (tx) => tx.run.data);
    const result = await c.flow.cancel(op.post(), input);
    expect(await c.flow.cancel(op.post(), input)).toEqual(result);
    expect(await c.flow.session(paid.reservation.get(), op.runId, "RESERVATION")).toMatchObject({ applications: [{ id: paid.applicationId, childId: "child-1", status: "CANCELLED" }] });
    const after = await c.db.$transaction(op.runId, (tx) => tx.run.data);
    expect(after.reservations[reservationId]).toMatchObject({ status: "CANCELLED", cancellationReason: reason, cancelledAt: c.clock.now });
    for (const key of ["payments", "refunds", "deposits"] as const) expect(after[key]).toEqual(before[key]);
    expect(await c.flow.revenue(op.get(), op.runId)).toEqual({ gross: 100, refunds: 0, net: 100 });
    await expect(c.flow.confirm(op.post(), { runId: op.runId, applicationId: paid.applicationId })).rejects.toThrow("RESERVATION_UNAVAILABLE");
  });

  it("class cancellation preserves reservation status, blocks grants/submission/confirmation and retains ledger", async () => {
    const c = setup(); const paid = await paidFixture(c); const { operator: op, classId } = paid;
    const pending = await application(c, op, classId, "child-2");
    const unused = await reservationSession(c, op, classId);
    const before = await c.db.$transaction(op.runId, (tx) => tx.run.data);
    await c.flow.cancel(op.post(), { runId: op.runId, kind: "CLASS", targetId: classId, reason });
    const after = await c.db.$transaction(op.runId, (tx) => tx.run.data);
    expect(after.reservations).toEqual(before.reservations);
    expect(after.payments).toEqual(before.payments);
    expect(after.refunds).toEqual(before.refunds);
    expect(await c.flow.session(paid.reservation.get(), op.runId, "RESERVATION")).toMatchObject({ classStatus: "CANCELLED", applications: [{ status: "CONFIRMED" }] });
    await expect(c.flow.submit(unused.post(), { runId: op.runId, childIds: ["child-3", "child-4"] })).rejects.toThrow("SUBMISSION_UNAVAILABLE");
    for (const applicationId of [pending.applicationId, paid.applicationId]) await expect(c.flow.confirm(op.post(), { runId: op.runId, applicationId })).rejects.toThrow("CLASS_UNAVAILABLE");
    await expect(c.flow.createGrant(op.post(), { runId: op.runId, classId })).rejects.toThrow("CLASS_UNAVAILABLE");
    await expect(c.flow.cancel(op.post(), { runId: op.runId, kind: "APPLICATION", targetId: pending.applicationId, reason })).resolves.toMatchObject({ status: "CANCELLED" });
    expect(await c.flow.session(pending.reservation.get(), op.runId, "RESERVATION")).toMatchObject({ classStatus: "CANCELLED", applications: [{ status: "CANCELLED" }] });
    await expect(c.flow.cancel(op.post(), { runId: op.runId, kind: "RESERVATION", targetId: paid.reservationId, reason })).rejects.toThrow("CLASS_UNAVAILABLE");
  });

  it("cancels a pending application without deleting deposits or confirming it", async () => {
    const c = setup(); const op = await bootstrap(c); const { classId } = await fixtureClass(c, op);
    const pending = await application(c, op, classId);
    await c.flow.cancel(op.post(), { runId: op.runId, kind: "APPLICATION", targetId: pending.applicationId, reason });
    await expect(c.flow.confirm(op.post(), { runId: op.runId, applicationId: pending.applicationId })).rejects.toThrow("APPLICATION_UNAVAILABLE");
    expect(await c.flow.session(pending.reservation.get(), op.runId, "RESERVATION")).toMatchObject({ applications: [{ status: "CANCELLED" }] });
    await c.db.$transaction(op.runId, (tx) => { expect(tx.run.data.deposits).toHaveLength(1); });
  });

  it("requires operator scope, CSRF, run ownership and a synthetic reason", async () => {
    const c = setup(); const paid = await paidFixture(c); const { operator: op } = paid;
    const input = { runId: op.runId, kind: "RESERVATION", targetId: paid.reservationId, reason };
    await expect(c.flow.cancel(paid.reservation.post(), input)).rejects.toThrow("UNAUTHORIZED");
    await expect(c.flow.cancel(request("POST", op.cookie), input)).rejects.toThrow("CSRF_DENIED");
    const other = await bootstrap(c);
    await expect(c.flow.cancel(other.post(), { ...input, runId: other.runId })).rejects.toThrow("CANCELLATION_UNAVAILABLE");
    await expect(c.flow.cancel(op.post(), { ...input, runId: other.runId })).rejects.toThrow("UNAUTHORIZED");
    await expect(c.flow.cancel(op.post(), { ...input, targetId: randomUUID() })).rejects.toThrow("CANCELLATION_UNAVAILABLE");
    await expect(c.flow.cancel(op.post(), { ...input, reason: "real freeform note" })).rejects.toThrow();
    await expect(c.flow.cancel(op.post(), { ...input, guardianPhone: "forbidden" })).rejects.toThrow();
    await c.db.$transaction(op.runId, (tx) => { expect(tx.run.data.reservations[paid.reservationId].status).toBe("RESERVED"); });
  });

  it.each([-1, 0])("guards class cancellation at the end boundary (offset %s)", async (offset) => {
    const c = setup(); const op = await bootstrap(c); const { classId } = await fixtureClass(c, op);
    await c.db.$transaction(op.runId, (tx) => { tx.run.data.classes[classId].endsAt = c.clock.now + offset; });
    const before = await c.db.$transaction(op.runId, (tx) => tx.run.data);
    const operation = c.flow.cancel(op.post(), { runId: op.runId, kind: "CLASS", targetId: classId, reason });
    if (offset < 0) {
      await expect(operation).rejects.toThrow("CANCELLATION_UNAVAILABLE");
      const after = await c.db.$transaction(op.runId, (tx) => tx.run.data);
      expect(after).toEqual(before);
    } else {
      await expect(operation).resolves.toMatchObject({ status: "CANCELLED" });
    }
  });

  it("preserves existing payment recording rules after cancellation", async () => {
    const c = setup(); const op = await bootstrap(c); const { classId } = await fixtureClass(c, op);
    const pending = await application(c, op, classId);
    const { reservationId } = await c.flow.confirm(op.post(), { runId: op.runId, applicationId: pending.applicationId });
    await c.flow.cancel(op.post(), { runId: op.runId, kind: "RESERVATION", targetId: reservationId, reason });
    await c.flow.cancel(op.post(), { runId: op.runId, kind: "CLASS", targetId: classId, reason });
    const { paymentId } = await c.flow.payment(op.post(), { runId: op.runId, reservationId, amount: 100, requestKey: randomUUID() });
    expect(await c.flow.revenue(op.get(), op.runId)).toEqual({ gross: 100, refunds: 0, net: 100 });
    await c.flow.refund(op.post(), { runId: op.runId, paymentId, amount: 30, reason: "CLASS_CANCELLED", requestKey: randomUUID() });
    expect(await c.flow.revenue(op.get(), op.runId)).toEqual({ gross: 100, refunds: 30, net: 70 });
  });

  it("blocks individual cancellation once the class has ended", async () => {
    const c = setup(); const paid = await paidFixture(c); const { operator: op } = paid;
    await c.db.$transaction(op.runId, (tx) => { tx.run.data.classes[paid.classId].endsAt = c.clock.now - 1; });
    await expect(c.flow.cancel(op.post(), { runId: op.runId, kind: "RESERVATION", targetId: paid.reservationId, reason })).rejects.toThrow("CLASS_UNAVAILABLE");
  });
});
