import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/e2e/phase20-lease", () => ({
  hasActivePhase20PreviewLease: vi.fn(),
}));

import { cleanupPhase20PreviewRun, registerPhase20OwnedChildren } from "@/lib/e2e/phase20-cleanup";
import { hasActivePhase20PreviewLease } from "@/lib/e2e/phase20-lease";
import { PURGED_PERSONAL_DATA_LABEL } from "@/lib/reservation-applications/constants";

const runId = "preview-abcdefghijklmnopqrstuv";
const childId = "child-1";
const marker = `E2E_P11_${runId}_`;
const activeLease = vi.mocked(hasActivePhase20PreviewLease);

type FixtureOptions = {
  groupPresent?: boolean;
  purgedChild?: boolean;
  proof?: string[];
  foreignPaymentItem?: boolean;
  foreignReservation?: boolean;
  foreignApplication?: boolean;
  refund?: boolean;
  foreignDeviceChild?: boolean;
  foreignCompanionMember?: boolean;
  foreignRelationship?: boolean;
  foreignConsent?: boolean;
  foreignSafety?: boolean;
  foreignRequestedApplication?: boolean;
};

/** A small in-memory Prisma fixture. Every delete is recorded for fail-closed assertions. */
function createFixture(options: FixtureOptions = {}) {
  const state = { groups: options.groupPresent === false ? [] : [{ id: "group-1" }], proof: options.proof ?? [], ...options };
  const applications = [{ id: "application-1", reservationId: "reservation-1", childId, requestedChildId: null }];
  const deletes: string[] = [];
  const deleteMany = (name: string) => vi.fn(async () => {
    deletes.push(name);
    return { count: 1 };
  });
  const child = {
    id: childId,
    name: state.purgedChild ? PURGED_PERSONAL_DATA_LABEL : `${marker}child`,
    isActive: !state.purgedChild,
    personalDataPurgedAt: state.purgedChild ? new Date("2026-10-01T00:00:00.000Z") : null,
  };
  const lease = {
    findUnique: vi.fn(async () => ({ id: "lease-1", ownedChildIds: state.proof })),
    update: vi.fn(async ({ data }: { data: { ownedChildIds: string[] } }) => {
      state.proof = data.ownedChildIds;
      return { id: "lease-1", ownedChildIds: state.proof };
    }),
  };
  const mappings = () => state.foreignPaymentItem || state.refund ? [{ id: "mapping-1", paymentItemId: "item-1" }] : [];
  const client = {
    $queryRaw: vi.fn(async () => [{ id: "lease-1" }]),
    previewE2eRunLease: lease,
    reservationApplicationGroup: { findMany: vi.fn(async () => state.groups), count: vi.fn(async () => 0), deleteMany: deleteMany("group") },
    reservationApplicationGroupClass: { deleteMany: deleteMany("groupClass") },
    reservationApplicationLink: { deleteMany: deleteMany("link") },
    reservationApplicationSubmission: { findMany: vi.fn(async () => state.groups.length ? [{ id: "submission-1" }] : []), deleteMany: deleteMany("submission") },
    reservationApplication: {
      findMany: vi.fn(async () => state.groups.length ? applications : []),
      count: vi.fn(async (query: { where: Record<string, unknown> }) => {
        if ("reservationId" in query.where) return state.foreignApplication ? 1 : 0;
        if ("requestedChildId" in query.where) return state.foreignRequestedApplication ? 1 : 0;
        return state.foreignRequestedApplication ? 1 : 0;
      }),
      deleteMany: deleteMany("application"),
    },
    reservation: {
      findMany: vi.fn(async () => state.groups.length ? [{ id: "reservation-1", childId }] : []),
      count: vi.fn(async () => state.foreignReservation ? 1 : 0),
      deleteMany: deleteMany("reservation"),
    },
    child: { findMany: vi.fn(async () => [child]), deleteMany: deleteMany("child") },
    applicationDeposit: { findMany: vi.fn(async () => []), deleteMany: deleteMany("deposit") },
    fundAllocation: { deleteMany: deleteMany("allocation") },
    returnObligation: { findMany: vi.fn(async () => []), deleteMany: deleteMany("obligation") },
    applicationReturn: { deleteMany: deleteMany("return") },
    reservationApplicationPaymentMapping: { findMany: vi.fn(async () => mappings()), deleteMany: deleteMany("mapping") },
    paymentItem: {
      findMany: vi.fn(async (query: { where: Record<string, unknown> }) => "paymentId" in query.where
        ? [{ id: "item-1" }, ...(state.foreignPaymentItem ? [{ id: "operator-item" }] : [])]
        : [{ id: "item-1", paymentId: "payment-1" }]),
      deleteMany: deleteMany("paymentItem"),
    },
    payment: { deleteMany: deleteMany("payment") },
    refund: { count: vi.fn(async () => state.refund ? 1 : 0) },
    deviceSubmission: { findMany: vi.fn(async () => []), deleteMany: deleteMany("deviceSubmission") },
    deviceChild: { count: vi.fn(async () => state.foreignDeviceChild ? 1 : 0), deleteMany: deleteMany("deviceChild") },
    applicationDevice: { findMany: vi.fn(async () => []), deleteMany: deleteMany("device") },
    childConsent: { count: vi.fn(async () => state.foreignConsent ? 1 : 0), deleteMany: deleteMany("consent") },
    childSafetyInfo: { count: vi.fn(async () => state.foreignSafety ? 1 : 0) },
    relationship: { count: vi.fn(async () => state.foreignRelationship ? 1 : 0) },
    companionInvite: { deleteMany: deleteMany("invite") },
    companionGroup: { findMany: vi.fn(async () => state.foreignCompanionMember ? [{ id: "companion-1" }] : []), deleteMany: deleteMany("companionGroup") },
    companionGroupMember: { count: vi.fn(async () => state.foreignCompanionMember ? 1 : 0), deleteMany: deleteMany("companionMember") },
  };
  const transaction = vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client));
  Object.assign(client, { $transaction: transaction });
  return {
    client,
    deletes,
    lease,
    state,
    transaction,
    companionGroupMember: client.companionGroupMember,
    childSafetyInfo: client.childSafetyInfo,
    reservationApplication: client.reservationApplication,
  };
}

describe("Phase 20 scoped cleanup", () => {
  it("requires the runtime and lease guard before registering child proof", async () => {
    activeLease.mockResolvedValueOnce(false);
    const fixture = createFixture();
    await expect(registerPhase20OwnedChildren(fixture.client as never, { runId, childIds: [childId], signed: null, now: new Date() })).rejects.toThrow("active approved lease");
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(fixture.lease.update).not.toHaveBeenCalled();
  });

  it("accepts a pre-purged child only when the same lease already proves ownership", async () => {
    activeLease.mockResolvedValueOnce(true);
    const fixture = createFixture({ purgedChild: true, proof: [childId] });
    await expect(registerPhase20OwnedChildren(fixture.client as never, { runId, childIds: [childId], signed: { runId, deploymentSha: "a".repeat(40), issuedAt: 0 }, now: new Date() })).resolves.toEqual([childId]);
    expect(fixture.lease.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ownedChildIds: [childId] } }));
  });

  it.each([
    ["an unrelated PaymentItem on the mapped Payment", { foreignPaymentItem: true }, "unowned payment item"],
    ["a foreign application on the owned Reservation", { foreignApplication: true }, "foreign reservation application"],
    ["a foreign Reservation for the owned Child", { foreignReservation: true }, "foreign child dependency"],
    ["a Refund on a mapped PaymentItem", { refund: true }, "refund on a synthetic payment item"],
  ] as const)("aborts before deletes when it finds %s", async (_name, options, message) => {
    const fixture = createFixture(options);
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).rejects.toThrow(message);
    expect(fixture.lease.update).toHaveBeenCalled();
    expect(fixture.deletes).toEqual([]);
  });

  it.each([
    ["a foreign device grant", { foreignDeviceChild: true }, "foreign child dependency"],
    ["a foreign companion member", { foreignCompanionMember: true }, "foreign companion member"],
  ] as const)("aborts before deletes for %s", async (_name, options, message) => {
    const fixture = createFixture(options);
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).rejects.toThrow(message);
    expect(fixture.deletes).toEqual([]);
  });

  it("aborts before deletes for relationship, consent, safety, and requested-child references", async () => {
    const fixture = createFixture({ foreignRelationship: true, foreignConsent: true, foreignSafety: true, foreignRequestedApplication: true });
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).rejects.toThrow("foreign child dependency");
    expect(fixture.deletes).toEqual([]);
    expect(fixture.childSafetyInfo.count).toHaveBeenCalled();
    expect(fixture.reservationApplication.count).toHaveBeenCalled();
  });

  it("keeps proof after a failed destructive transaction and removes the recovered tombstone on retry", async () => {
    const fixture = createFixture({ purgedChild: true, proof: [childId], foreignPaymentItem: true });
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).rejects.toThrow("unowned payment item");
    expect(fixture.state.proof).toEqual([childId]);
    expect(fixture.deletes).toEqual([]);
    fixture.state.groups = [];
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).resolves.toMatchObject({ groups: 0 });
    expect(fixture.deletes).toEqual(["child"]);
  });

  it("checks recovery-only foreign requested-child and safety references before deleting a proof tombstone", async () => {
    const fixture = createFixture({ groupPresent: false, purgedChild: true, proof: [childId], foreignRequestedApplication: true, foreignSafety: true });
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).rejects.toThrow("foreign child dependency");
    expect(fixture.deletes).toEqual([]);
    expect(fixture.reservationApplication.count).toHaveBeenCalled();
    expect(fixture.childSafetyInfo.count).toHaveBeenCalled();
  });

  it("removes applications before RESTRICT Reservations and clears a run-proven anonymous leaf", async () => {
    const fixture = createFixture({ purgedChild: true, proof: [childId] });
    await expect(cleanupPhase20PreviewRun(fixture.client as never, runId)).resolves.toMatchObject({ groups: 1, submissions: 1, applications: 1, residualGroups: 0 });
    expect(fixture.deletes.indexOf("application")).toBeLessThan(fixture.deletes.indexOf("reservation"));
    expect(fixture.deletes.at(-1)).toBe("child");
  });
});
