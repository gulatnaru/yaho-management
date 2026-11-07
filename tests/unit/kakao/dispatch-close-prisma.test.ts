import { describe, expect, it } from "vitest";
import { PrismaDispatchRepository, closePrismaUnconfirmed, type PrismaGuardClient, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";

const at = new Date("2026-10-28T00:00:00Z");
const unknownSince = new Date("2026-09-28T00:00:00Z");
const reviewed7dAt = new Date("2026-10-05T00:00:00Z");
const responsibilityReviewedAt = new Date("2026-10-28T00:00:00Z");
const nextReviewAt = new Date("2026-11-27T00:00:00Z");
const command = { commandId: "close1", dispatchId: "dispatch", actorId: "actor", approvalId: "approval", evidenceId: "evidence", at, nextReviewAt };

type DispatchState = { id: string; outboxId: string; reconciliationState: string; finalStatus: string | null; unknownSince: Date | null; reviewed7dAt: Date | null; responsibilityReviewedAt: Date | null; closedAt: Date | null; auditSequence: number };
type AuditState = { eventType: string; dispatchId: string; actorId: string; approvalId: string; evidenceId: string } | null;
type State = { dispatch: DispatchState; outboxStatus: string; audit: AuditState; writes: number };

function initialState(finalStatus: string | null = null, overrides: Partial<DispatchState> = {}): State {
  return {
    dispatch: { id: "dispatch", outboxId: "outbox", reconciliationState: "unknown", finalStatus, unknownSince, reviewed7dAt, responsibilityReviewedAt, closedAt: null, auditSequence: 0, ...overrides },
    outboxStatus: "sent",
    audit: null,
    writes: 0,
  };
}

function adapter(seed: State, options: { approvalActorId?: string; actorRole?: string; failAt?: number } = {}) {
  const approvalActorId = options.approvalActorId ?? "owner";
  const actorRole = options.actorRole ?? "ADMIN";
  const failAt = options.failAt;
  let state = structuredClone(seed);
  const client: PrismaGuardClient = { async $transaction(work) {
    const candidate = structuredClone(state);
    const tx: PrismaGuardTransaction = {
      async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
        void values;
        const sql = strings.join("?");
        let result: unknown[];
        if (sql.includes('FROM "NotificationRuntimeConfig"')) result = [{ ownerId: "owner", policyVersion: "v1", revision: 1 }];
        else if (sql.includes('FROM "NotificationDispatch"')) result = [candidate.dispatch];
        else if (sql.includes('FROM "NotificationOutbox"')) result = [{ status: candidate.outboxStatus }];
        else if (sql.includes('FROM "User"')) result = [{ id: "owner", role: "ADMIN", isActive: true, mustChangePassword: false }, { id: "actor", role: actorRole, isActive: true, mustChangePassword: false }];
        else if (sql.includes("closure_approved")) result = [{ actorId: approvalActorId, dispatchId: "dispatch", commandId: "close1", evidenceId: "evidence" }];
        else if (sql.includes('FROM "NotificationAudit"')) result = candidate.audit ? [candidate.audit] : [];
        else throw new Error("Unexpected query");
        return result as T;
      },
      async $executeRaw(strings) {
        const sql = strings.join("?");
        candidate.writes++;
        if (failAt !== undefined && candidate.writes === failAt) throw new Error("injected write failure");
        if (sql.includes('UPDATE "NotificationDispatch"')) {
          if (sql.includes('"finalStatus" = \'unknown\'')) candidate.dispatch.finalStatus = "unknown";
          candidate.dispatch.reconciliationState = "closed_unconfirmed";
          candidate.dispatch.closedAt = at;
          candidate.dispatch.auditSequence++;
        } else if (sql.includes('INSERT INTO "NotificationAudit"')) {
          candidate.audit = { eventType: "closed_unconfirmed", dispatchId: "dispatch", actorId: "actor", approvalId: "approval", evidenceId: "evidence" };
        } else throw new Error("Unexpected write");
        return 1;
      },
    };
    const result = await work(tx); state = candidate; return result;
  } };
  return { client, snapshot: () => structuredClone(state) };
}

describe("closePrismaUnconfirmed", () => {
  it("closes an unknown dispatch, sets finalStatus unknown, and is idempotent", async () => {
    const { client, snapshot } = adapter(initialState());
    const repo = new PrismaDispatchRepository(client);
    await closePrismaUnconfirmed(repo, command);
    expect(snapshot().dispatch).toMatchObject({ reconciliationState: "closed_unconfirmed", finalStatus: "unknown", closedAt: at, auditSequence: 1 });
    expect(snapshot().audit).toEqual({ eventType: "closed_unconfirmed", dispatchId: "dispatch", actorId: "actor", approvalId: "approval", evidenceId: "evidence" });
    expect(snapshot().writes).toBe(2);
    await closePrismaUnconfirmed(repo, command);
    expect(snapshot().dispatch.auditSequence).toBe(1);
    expect(snapshot().writes).toBe(2);
  });

  it("preserves a delivered finalStatus instead of overwriting it with unknown", async () => {
    const { client, snapshot } = adapter(initialState("delivered"));
    await closePrismaUnconfirmed(new PrismaDispatchRepository(client), command);
    expect(snapshot().dispatch).toMatchObject({ reconciliationState: "closed_unconfirmed", finalStatus: "delivered", auditSequence: 1 });
    expect(snapshot().audit).not.toBeNull();
  });

  it("rejects closure when the approval actor is not the runtime owner", async () => {
    const { client, snapshot } = adapter(initialState(), { approvalActorId: "actor" });
    await expect(closePrismaUnconfirmed(new PrismaDispatchRepository(client), command)).rejects.toThrow("Closure approval unavailable.");
    expect(snapshot().writes).toBe(0);
    expect(snapshot().dispatch.reconciliationState).toBe("unknown");
  });

  it("rejects closure when the 30-day condition is unmet", async () => {
    const { client, snapshot } = adapter(initialState(null, { unknownSince: new Date("2026-10-18T00:00:00Z") }));
    await expect(closePrismaUnconfirmed(new PrismaDispatchRepository(client), command)).rejects.toThrow("Closure conditions unavailable.");
    expect(snapshot().writes).toBe(0);
  });

  it("rejects closure when the executor is not an active ADMIN", async () => {
    const { client, snapshot } = adapter(initialState(), { actorRole: "STAFF" });
    await expect(closePrismaUnconfirmed(new PrismaDispatchRepository(client), command)).rejects.toThrow("Closure authority unavailable.");
    expect(snapshot().writes).toBe(0);
  });

  it("rolls back the whole closure when a write fails", async () => {
    const seed = initialState();
    const { client, snapshot } = adapter(seed, { failAt: 1 });
    await expect(closePrismaUnconfirmed(new PrismaDispatchRepository(client), command)).rejects.toThrow("injected write failure");
    expect(snapshot()).toEqual(seed);
  });
});
