import type { PrismaClient } from "@prisma/client";
import { hasActivePhase20PreviewLease, type SignedPreviewRun } from "./phase20-lease";
import { PURGED_PERSONAL_DATA_LABEL } from "@/lib/reservation-applications/constants";

/**
 * Deletes only rows rooted at a Phase 20 synthetic group.  This is separate
 * from the historical marker cleanup because Phase 20 adds RESTRICT foreign
 * keys (ledger, invitation and device provenance) that must be removed first.
 */
type Phase20CleanupClient = Pick<PrismaClient,
  "$transaction" | "reservationApplicationGroup" | "reservationApplicationGroupClass" |
  "reservationApplicationLink" | "reservationApplicationSubmission" | "reservationApplication" |
  "companionInvite" | "companionGroup" | "companionGroupMember" | "applicationDeposit" |
  "fundAllocation" | "returnObligation" | "applicationReturn" | "reservationApplicationPaymentMapping" |
  "paymentItem" | "payment" | "refund" | "deviceSubmission" | "deviceChild" | "applicationDevice" |
  "childConsent" | "childSafetyInfo" | "relationship" | "reservation" | "child" | "previewE2eRunLease" | "$queryRaw"
>;

export type Phase20CleanupReport = { groups: number; submissions: number; applications: number; devices: number; residualGroups: number };

/** A 30-character run ID yields a 39-character marker prefix, leaving 11
 * characters for a public 50-character synthetic child suffix. */
export function phase20SyntheticMarker(runId: string): string {
  if (!/^preview-[A-Za-z0-9_-]{22}$/.test(runId)) throw new Error("Invalid Phase 20 synthetic run ID");
  return `E2E_P11_${runId}_`;
}

function proofIds(value: unknown): string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string")
    ? [...new Set(value)].sort()
    : [];
}

/**
 * Persist a narrow, marker-proven child ownership set before a scoped purge
 * removes names. This is deliberately callable only with the same signed,
 * active Preview lease and advisory-lock proof that opens synthetic intake.
 */
export async function registerPhase20OwnedChildren(
  client: Phase20CleanupClient,
  input: { runId: string; childIds: readonly string[]; signed: Omit<SignedPreviewRun, "signature"> | null; now: Date; environment?: NodeJS.ProcessEnv },
): Promise<string[]> {
  const marker = phase20SyntheticMarker(input.runId);
  const ids = [...new Set(input.childIds)].sort();
  if (ids.length === 0) return [];
  if (!await hasActivePhase20PreviewLease(client, { signed: input.signed, syntheticRunId: input.runId, now: input.now, environment: input.environment })) {
    throw new Error("Phase20 ownership registration requires an active approved lease");
  }
  return client.$transaction(async (tx) => {
    const lease = await tx.previewE2eRunLease.findUnique({ where: { runId: input.runId }, select: { id: true, ownedChildIds: true } });
    if (!lease) throw new Error("Phase20 ownership registration has no run lease");
    await tx.$queryRaw`SELECT "id" FROM "PreviewE2eRunLease" WHERE "id" = ${lease.id} FOR UPDATE`;
    const prior = proofIds(lease.ownedChildIds);
    const children = await tx.child.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true, personalDataPurgedAt: true } });
    if (children.length !== ids.length || children.some((child) => {
      const markerOwned = child.name.includes(marker);
      const recoveredOwned = prior.includes(child.id) && child.personalDataPurgedAt !== null && child.name === PURGED_PERSONAL_DATA_LABEL && !child.isActive;
      return !markerOwned && !recoveredOwned;
    })) throw new Error("Phase20 ownership registration found an unowned child");
    const merged = [...new Set([...prior, ...ids])].sort();
    await tx.previewE2eRunLease.update({ where: { runId: input.runId }, data: { ownedChildIds: merged } });
    return merged;
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function cleanupPhase20PreviewRun(client: Phase20CleanupClient, runId: string): Promise<Phase20CleanupReport> {
  // Reject malformed input before opening the transaction.  This is also the
  // original marker proof used below; cleanup never accepts a broad selector.
  const marker = phase20SyntheticMarker(runId);
  // Record the narrow child ownership proof in its own committed transaction.
  // The destructive cleanup transaction may roll back; its recovery proof
  // must survive that rollback while the lease itself remains guarded by the
  // runner's advisory lock.
  await client.$transaction(async (tx) => {
    const lease = await tx.previewE2eRunLease.findUnique({ where: { runId }, select: { id: true, ownedChildIds: true } });
    if (!lease) throw new Error("Phase20 cleanup has no run lease");
    await tx.$queryRaw`SELECT "id" FROM "PreviewE2eRunLease" WHERE "id" = ${lease.id} FOR UPDATE`;
    const groups = await tx.reservationApplicationGroup.findMany({ where: { syntheticRunId: runId }, select: { id: true } });
    const submissions = groups.length ? await tx.reservationApplicationSubmission.findMany({ where: { groupId: { in: groups.map((row) => row.id) } }, select: { id: true } }) : [];
    const applications = submissions.length ? await tx.reservationApplication.findMany({ where: { submissionId: { in: submissions.map((row) => row.id) } }, select: { reservationId: true, childId: true, requestedChildId: true } }) : [];
    const reservationIds = applications.flatMap((row) => row.reservationId ? [row.reservationId] : []);
    const children = reservationIds.length ? await tx.reservation.findMany({ where: { id: { in: reservationIds } }, select: { childId: true } }) : [];
    const childIds = [...new Set([...children.map((row) => row.childId), ...applications.flatMap((row) => row.childId ? [row.childId] : []), ...applications.flatMap((row) => row.requestedChildId ? [row.requestedChildId] : [])])].sort();
    const prior = proofIds(lease.ownedChildIds);
    if (childIds.length) {
      const childRows = await tx.child.findMany({ where: { id: { in: childIds } }, select: { id: true, name: true, isActive: true, personalDataPurgedAt: true } });
      if (childRows.length !== childIds.length || childRows.some((child) => {
        const markerOwned = child.name.includes(marker);
        const recoveredOwned = prior.includes(child.id) && child.personalDataPurgedAt !== null && child.name === PURGED_PERSONAL_DATA_LABEL && !child.isActive;
        return !markerOwned && !recoveredOwned;
      })) throw new Error("Phase20 cleanup found an unowned child reference");
    }
    await tx.previewE2eRunLease.update({ where: { runId }, data: { ownedChildIds: [...new Set([...prior, ...childIds])].sort() } });
  }, { maxWait: 10_000, timeout: 60_000 });
  return client.$transaction(async (tx) => {
    const leases = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PreviewE2eRunLease"
      WHERE "runId" = ${runId}
      FOR UPDATE
    `;
    if (leases.length !== 1) throw new Error("Phase20 cleanup has no active run lease");
    await tx.$queryRaw`
      SELECT "id" FROM "ReservationApplicationGroup"
      WHERE "syntheticRunId" = ${runId}
      ORDER BY "id" FOR UPDATE
    `;
    const lease = await tx.previewE2eRunLease.findUnique({ where: { runId }, select: { ownedChildIds: true } });
    const registeredChildIds = proofIds(lease?.ownedChildIds);
    const groups = await tx.reservationApplicationGroup.findMany({ where: { syntheticRunId: runId }, select: { id: true } });
    const groupIds = groups.map((row) => row.id);
    if (groupIds.length === 0) {
      // A scoped retention purge can remove the marker before a later cleanup
      // retry. Only the committed same-run proof may remove that anonymous
      // leaf, and any surviving dependency makes recovery fail closed.
      if (registeredChildIds.length) {
        const children = await tx.child.findMany({ where: { id: { in: registeredChildIds } }, select: { id: true, name: true, isActive: true, personalDataPurgedAt: true } });
        if (children.some((child) => child.name !== PURGED_PERSONAL_DATA_LABEL || child.isActive || child.personalDataPurgedAt === null)) throw new Error("Phase20 cleanup recovery found a non-purged child");
        const [reservations, consents, devices, relationships, requestedApplications, safetyInfo] = await Promise.all([
          tx.reservation.count({ where: { childId: { in: registeredChildIds } } }),
          tx.childConsent.count({ where: { childId: { in: registeredChildIds } } }),
          tx.deviceChild.count({ where: { childId: { in: registeredChildIds } } }),
          tx.relationship.count({ where: { OR: [{ childAId: { in: registeredChildIds } }, { childBId: { in: registeredChildIds } }] } }),
          tx.reservationApplication.count({ where: { OR: [{ childId: { in: registeredChildIds } }, { requestedChildId: { in: registeredChildIds } }] } }),
          tx.childSafetyInfo.count({ where: { childId: { in: registeredChildIds } } }),
        ]);
        if (reservations || consents || devices || relationships || requestedApplications || safetyInfo) throw new Error("Phase20 cleanup recovery found a foreign child dependency");
        await tx.child.deleteMany({ where: { id: { in: registeredChildIds }, name: PURGED_PERSONAL_DATA_LABEL, isActive: false, personalDataPurgedAt: { not: null } } });
      }
      return { groups: 0, submissions: 0, applications: 0, devices: 0, residualGroups: 0 };
    }
    const submissions = await tx.reservationApplicationSubmission.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } });
    const submissionIds = submissions.map((row) => row.id);
    const applications = await tx.reservationApplication.findMany({ where: { submissionId: { in: submissionIds } }, select: { id: true, reservationId: true, childId: true, requestedChildId: true } });
    const applicationIds = applications.map((row) => row.id);
    const reservationIds = applications.flatMap((row) => row.reservationId ? [row.reservationId] : []);
    const [deposits, obligations, mappings, deviceSubmissions, companionGroups] = await Promise.all([
      tx.applicationDeposit.findMany({ where: { submissionId: { in: submissionIds } }, select: { id: true } }),
      tx.returnObligation.findMany({ where: { submissionId: { in: submissionIds } }, select: { id: true } }),
      tx.reservationApplicationPaymentMapping.findMany({ where: { applicationId: { in: applicationIds } }, select: { id: true, paymentItemId: true } }),
      tx.deviceSubmission.findMany({ where: { submissionId: { in: submissionIds } }, select: { deviceId: true } }),
      tx.companionGroup.findMany({ where: { OR: [{ groupId: { in: groupIds } }, { issuerSubmissionId: { in: submissionIds } }] }, select: { id: true } }),
    ]);
    const depositIds = deposits.map((row) => row.id);
    const obligationIds = obligations.map((row) => row.id);
    const mappingIds = mappings.map((row) => row.id);
    const itemIds = mappings.map((row) => row.paymentItemId);
    const mappedItems = itemIds.length ? await tx.paymentItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, paymentId: true } }) : [];
    const paymentIds = mappedItems.map((row) => row.paymentId);
    // A synthetic Phase 20 payment must contain only its mapped items.  Abort
    // cleanup rather than ever deleting an operator's unrelated payment.
    if (paymentIds.length) {
      const allPaymentItems = await tx.paymentItem.findMany({ where: { paymentId: { in: paymentIds } }, select: { id: true } });
      if (allPaymentItems.some((row) => !itemIds.includes(row.id))) throw new Error("Phase20 cleanup found an unowned payment item");
    }
    if (itemIds.length && await tx.refund.count({ where: { paymentItemId: { in: itemIds } } }) > 0) {
      throw new Error("Phase20 cleanup found a refund on a synthetic payment item");
    }
    const candidateDeviceIds = [...new Set(deviceSubmissions.map((row) => row.deviceId))];
    const devices = candidateDeviceIds.length ? await tx.applicationDevice.findMany({
      where: { id: { in: candidateDeviceIds }, submissions: { every: { submissionId: { in: submissionIds } } } },
      select: { id: true },
    }) : [];
    const deviceIds = devices.map((row) => row.id);

    const childIds = [...new Set([
      ...(reservationIds.length ? (await tx.reservation.findMany({ where: { id: { in: reservationIds } }, select: { childId: true } })).map((row) => row.childId) : []),
      ...applications.flatMap((row) => row.childId ? [row.childId] : []),
      ...applications.flatMap((row) => row.requestedChildId ? [row.requestedChildId] : []),
      ...registeredChildIds,
    ])].sort();
    const ownedChildren = childIds.length
      ? await tx.child.findMany({ where: { id: { in: childIds } }, select: { id: true, name: true, isActive: true, personalDataPurgedAt: true } })
      : [];
    if (ownedChildren.length !== childIds.length || ownedChildren.some((child) => {
      const markerOwned = child.name.includes(marker);
      const recoveredOwned = registeredChildIds.includes(child.id) && child.personalDataPurgedAt !== null && child.name === PURGED_PERSONAL_DATA_LABEL && !child.isActive;
      return !markerOwned && !recoveredOwned;
    })) throw new Error("Phase20 cleanup found an unowned child reference");
    if (reservationIds.length) {
      const ownedReservations = await tx.reservation.findMany({ where: { id: { in: reservationIds }, childId: { in: childIds } }, select: { id: true } });
      if (ownedReservations.length !== reservationIds.length) throw new Error("Phase20 cleanup found an unowned reservation reference");
      const foreignApplications = await tx.reservationApplication.count({ where: { reservationId: { in: reservationIds }, id: { notIn: applicationIds } } });
      if (foreignApplications > 0) throw new Error("Phase20 cleanup found a foreign reservation application");
    }
    if (childIds.length) {
      const foreignReservations = await tx.reservation.count({ where: { childId: { in: childIds }, id: { notIn: reservationIds } } });
      const foreignConsents = await tx.childConsent.count({ where: { childId: { in: childIds }, OR: [{ reservationApplicationId: null }, { reservationApplicationId: { notIn: applicationIds } }] } });
      const foreignDeviceChildren = await tx.deviceChild.count({ where: { childId: { in: childIds }, deviceId: { notIn: deviceIds } } });
      const foreignRequestedApplications = await tx.reservationApplication.count({ where: { requestedChildId: { in: childIds }, id: { notIn: applicationIds } } });
      const foreignSafetyInfo = await tx.childSafetyInfo.count({ where: { childId: { in: childIds } } });
      const foreignRelationships = await tx.relationship.count({ where: { OR: [{ childAId: { in: childIds } }, { childBId: { in: childIds } }] } });
      if (foreignReservations > 0 || foreignConsents > 0 || foreignDeviceChildren > 0 || foreignRequestedApplications > 0 || foreignSafetyInfo > 0 || foreignRelationships > 0) throw new Error("Phase20 cleanup found a foreign child dependency");
    }
    if (deviceIds.length && await tx.deviceChild.count({ where: { deviceId: { in: deviceIds }, childId: { notIn: childIds } } }) > 0) throw new Error("Phase20 cleanup found a foreign device child");
    const companionGroupIds = companionGroups.map((row) => row.id);
    if (companionGroupIds.length && await tx.companionGroupMember.count({ where: { companionGroupId: { in: companionGroupIds }, submissionId: { notIn: submissionIds } } }) > 0) throw new Error("Phase20 cleanup found a foreign companion member");
    // Persist only IDs whose original Child marker has just been proven under
    // the lease/group locks.  A retry after interruption can recover this
    // narrow proof without retaining raw tokens or PII.

    await tx.applicationReturn.deleteMany({ where: { returnObligationId: { in: obligationIds } } });
    await tx.fundAllocation.deleteMany({ where: { OR: [{ depositId: { in: depositIds } }, { paymentMappingId: { in: mappingIds } }, { returnObligationId: { in: obligationIds } }] } });
    await tx.reservationApplicationPaymentMapping.deleteMany({ where: { id: { in: mappingIds } } });
    await tx.paymentItem.deleteMany({ where: { id: { in: itemIds } } });
    await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await tx.childConsent.deleteMany({ where: { reservationApplicationId: { in: applicationIds } } });
    await tx.deviceChild.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await tx.deviceSubmission.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await tx.applicationDevice.deleteMany({ where: { id: { in: deviceIds } } });
    await tx.applicationDeposit.deleteMany({ where: { id: { in: depositIds } } });
    await tx.companionInvite.deleteMany({ where: { OR: [{ groupId: { in: groupIds } }, { issuerSubmissionId: { in: submissionIds } }] } });
    await tx.companionGroupMember.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await tx.companionGroup.deleteMany({ where: { OR: [{ groupId: { in: groupIds } }, { issuerSubmissionId: { in: submissionIds } }] } });
    await tx.returnObligation.deleteMany({ where: { id: { in: obligationIds } } });
    // ReservationApplication.reservationId is RESTRICT. Remove dependent
    // consents and finance records first, then applications, then reservations.
    await tx.reservationApplication.deleteMany({ where: { id: { in: applicationIds } } });
    if (reservationIds.length) await tx.reservation.deleteMany({ where: { id: { in: reservationIds }, childId: { in: childIds } } });
    await tx.reservationApplicationSubmission.deleteMany({ where: { id: { in: submissionIds } } });
    await tx.reservationApplicationLink.deleteMany({ where: { groupId: { in: groupIds } } });
    await tx.reservationApplicationGroupClass.deleteMany({ where: { groupId: { in: groupIds } } });
    await tx.reservationApplicationGroup.deleteMany({ where: { id: { in: groupIds } } });
    // Retention may have removed the marker from a run-owned child before the
    // group cleanup. Once every child dependency has been checked and removed,
    // delete only the committed lease-proof tombstone; marker-named children
    // remain for the historical marker cleanup path.
    const recoveredChildIds = ownedChildren
      .filter((child) => registeredChildIds.includes(child.id) && child.name === PURGED_PERSONAL_DATA_LABEL && !child.isActive && child.personalDataPurgedAt !== null)
      .map((child) => child.id);
    if (recoveredChildIds.length) {
      await tx.child.deleteMany({ where: { id: { in: recoveredChildIds }, name: PURGED_PERSONAL_DATA_LABEL, isActive: false, personalDataPurgedAt: { not: null } } });
    }
    const residualGroups = await tx.reservationApplicationGroup.count({ where: { syntheticRunId: runId } });
    return { groups: groupIds.length, submissions: submissionIds.length, applications: applicationIds.length, devices: deviceIds.length, residualGroups };
  }, { maxWait: 10_000, timeout: 60_000 });
}
