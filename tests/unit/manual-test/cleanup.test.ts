import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MANUAL_COOKIES, MOCK_TTL } from "@/server/manual-test/auth";
import { cleanClosedMockRun } from "@/server/manual-test/cleanup";
import { bootstrap, close, paidFixture, reservationSession, setup, START } from "./helpers";

describe("manual-test close and OPERATOR-authorized cleanup", () => {
  it("close revokes reservation sessions and consumes grants while keeping the operator session usable for cleanup", async () => {
    const context = setup();
    const { operator } = await paidFixture(context);
    const closed = await close(context, operator);
    expect(closed.cookie.startsWith(`${MANUAL_COOKIES.operator}=`)).toBe(true);
    expect(closed.status).toBe("CLOSED");
    await context.db.$transaction(operator.runId, (tx) => {
      expect(tx.run.status).toBe("CLOSED");
      const sessions = Object.values(tx.run.sessions);
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((row) => row.scope === "OPERATOR").every((row) => !row.revoked)).toBe(true);
      expect(sessions.filter((row) => row.scope === "RESERVATION").every((row) => row.revoked)).toBe(true);
      expect(Object.values(tx.run.grants).every((row) => row.consumed)).toBe(true);
    });
    // The close-returned cookie is a refreshed OPERATOR session: normal
    // operations are denied on a CLOSED run but cleanup is authorized.
    await expect(context.flow.createClass(operator.post(), { runId: operator.runId, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 100, startsAt: START + 3_600_000, endsAt: START + 7_200_000 })).rejects.toThrow("UNAUTHORIZED");
    await expect(context.cleanup.cleanup(closed.post(), { runId: operator.runId })).resolves.toMatchObject({ runId: operator.runId, status: "CLEANED" });
  });

  it("full flow: bootstrap → fixtures → close → cleanup is idempotent even after sessions are wiped", async () => {
    const context = setup();
    const fixture = await paidFixture(context);
    const other = await paidFixture(context);
    const before = await context.db.$transaction(other.operator.runId, (tx) => tx.run);
    const closed = await close(context, fixture.operator);
    await expect(context.cleanup.cleanup(closed.post(), { runId: fixture.operator.runId })).resolves.toMatchObject({ runId: fixture.operator.runId, status: "CLEANED" });
    await context.db.$transaction(fixture.operator.runId, (tx) => {
      expect(tx.run.sessions).toEqual({});
      expect(tx.run.grants).toEqual({});
      expect(tx.run.receipts).toEqual({});
      expect(Object.values(tx.run.data).every((rows) => Object.keys(rows).length === 0)).toBe(true);
    });
    // Retry with the same operator cookie + csrf after the wipe: still CLEANED.
    await expect(context.cleanup.cleanup(closed.post(), { runId: fixture.operator.runId })).resolves.toMatchObject({ runId: fixture.operator.runId, status: "CLEANED" });
    const after = await context.db.$transaction(other.operator.runId, (tx) => tx.run);
    expect(after).toEqual(before);
    expect(await context.flow.revenue(other.operator.get(), other.operator.runId)).toEqual({ gross: 100, refunds: 0, net: 100 });
    await expect(context.flow.revenue(fixture.operator.get(), fixture.operator.runId)).rejects.toThrow("UNAUTHORIZED");
  });

  it("refuses cleanup of ACTIVE runs", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    await expect(context.db.$transaction(operator.runId, (tx) => cleanClosedMockRun(tx.run))).rejects.toThrow("RUN_MUST_BE_CLOSED");
    await expect(context.cleanup.cleanup(operator.post(), { runId: operator.runId })).rejects.toThrow("UNAUTHORIZED");
  });

  it("rejects cross-run operator cookies and reservation-scoped sessions for cleanup", async () => {
    const context = setup();
    const first = await paidFixture(context);
    const second = await bootstrap(context);
    const closed = await close(context, first.operator);
    // An operator cookie cannot authorize cleanup of another run.
    await expect(context.cleanup.cleanup(closed.post(), { runId: second.runId })).rejects.toThrow("UNAUTHORIZED");
    // A reservation session cannot call cleanup.
    const { classId } = await context.flow.createClass(second.post(), { runId: second.runId, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 100, startsAt: Date.UTC(2026, 9, 18, 11), endsAt: Date.UTC(2026, 9, 18, 13) });
    const reservation = await reservationSession(context, second, classId);
    const closedSecond = await close(context, second);
    await expect(context.cleanup.cleanup(reservation.post(), { runId: second.runId })).rejects.toThrow("UNAUTHORIZED");
    await expect(context.cleanup.cleanup(closedSecond.post(), { runId: second.runId })).resolves.toMatchObject({ status: "CLEANED" });
  });

  it("rolls back failed deletion while CLOSED/revoked state remains, then permits retry", async () => {
    const context = setup();
    const { operator } = await paidFixture(context);
    const closed = await close(context, operator);
    await expect(context.db.$transaction(operator.runId, (tx) => {
      cleanClosedMockRun(tx.run);
      throw new Error("synthetic cleanup interruption");
    })).rejects.toThrow("synthetic cleanup interruption");
    await context.db.$transaction(operator.runId, (tx) => {
      expect(tx.run.status).toBe("CLOSED");
      expect(Object.keys(tx.run.data.payments)).toHaveLength(1);
    });
    await expect(context.cleanup.cleanup(closed.post(), { runId: operator.runId })).resolves.toHaveProperty("status", "CLEANED");
  });

  it("serializes close before a concurrent refund, denying the stale finance operation", async () => {
    const context = setup();
    const { operator, paymentId } = await paidFixture(context);
    const results = await Promise.allSettled([
      context.cleanup.close(operator.post(), { runId: operator.runId }),
      context.flow.refund(operator.post(), { runId: operator.runId, paymentId, amount: 1, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    await context.db.$transaction(operator.runId, (tx) => {
      expect(tx.run.data.refunds).toHaveLength(0);
    });
  });

  it("expired operator token on an already CLEANED run fails closed with UNAUTHORIZED", async () => {
    const context = setup();
    const { operator } = await paidFixture(context);
    const closed = await close(context, operator);
    await expect(context.cleanup.cleanup(closed.post(), { runId: operator.runId })).resolves.toMatchObject({ status: "CLEANED" });
    // Advance the test clock past the refreshed operator session expiry: the
    // token's signed exp no longer verifies, so the retry fails closed.
    context.clock.now += MOCK_TTL.session + 1;
    await expect(context.cleanup.cleanup(closed.post(), { runId: operator.runId })).rejects.toThrow("UNAUTHORIZED");
    // The CLEANED state stands; nothing was touched.
    await context.db.$transaction(operator.runId, (tx) => {
      expect(tx.run.status).toBe("CLEANED");
      expect(tx.run.sessions).toEqual({});
    });
  });

  it("cross-run operator token on a CLEANED run no-ops without touching the other run", async () => {
    const context = setup();
    const fixtureA = await paidFixture(context);
    const operatorB = await bootstrap(context);
    const closedA = await close(context, fixtureA.operator);
    await expect(context.cleanup.cleanup(closedA.post(), { runId: fixtureA.operator.runId })).resolves.toMatchObject({ status: "CLEANED" });
    const beforeB = await context.db.$transaction(operatorB.runId, (tx) => tx.run);
    // Run B's operator cookie presented against run A's runId: the CLEANED
    // retry path answers with a no-op and never reaches run B.
    await expect(context.cleanup.cleanup(operatorB.post(), { runId: fixtureA.operator.runId })).resolves.toMatchObject({ runId: fixtureA.operator.runId, status: "CLEANED" });
    const afterB = await context.db.$transaction(operatorB.runId, (tx) => tx.run);
    expect(afterB).toEqual(beforeB);
    expect(afterB.status).toBe("ACTIVE");
  });
});
