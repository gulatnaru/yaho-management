import { isConsentContentReady } from "@/lib/reservation-applications/consent-content";
import { readClassLinkRevision, LinkRevisionConflictError } from "./groups";
import type { PrismaClient } from "@prisma/client";
import { canIssueApplicationLink } from "@/lib/reservation-applications/availability";
import {
  ApplicationLinkClassClosedError,
  ApplicationLinkNotFoundError,
} from "@/lib/reservation-applications/errors";
import { generateApplicationLinkToken } from "@/lib/reservation-applications/token";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";

type IssueClient = Pick<PrismaClient, "$transaction">;
type StopClient = Pick<PrismaClient, "reservationApplicationLink" | "$transaction">;
type UpgradeClient = Pick<PrismaClient, "$transaction">;
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Explicit existing Phase 18 reissue only (ADR-052); upgrade is a separate operation.
 * Freeze the request revision across response-loss retries: success changes the revision,
 * so a retry conflicts rather than rotating again. Reconcile current metadata before a fresh intent.
 * No new plaintext row is created, and existing applications are never updated.
 */
export async function issueApplicationLinkCore(
  client: IssueClient,
  input: { classScheduleId: string; actorUserId: string; now: Date; revision: string; generateToken?: () => string },
): Promise<{ token: string }> {
  const token = (input.generateToken ?? generateApplicationLinkToken)();
  await client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ClassSchedule" WHERE "id" = ${input.classScheduleId} FOR UPDATE`;
    if (!rows[0]) throw new ApplicationLinkNotFoundError();
    if (await readClassLinkRevision(tx, input.classScheduleId) !== input.revision) throw new LinkRevisionConflictError();
    const classSchedule = await tx.classSchedule.findUnique({ where: { id: input.classScheduleId }, select: { status: true, startsAt: true } });
    if (!classSchedule) throw new ApplicationLinkNotFoundError();
    if (!canIssueApplicationLink(classSchedule, input.now)) throw new ApplicationLinkClassClosedError();
    const upgraded = await tx.reservationApplicationGroup.findFirst({ where: { upgradedLegacyClassScheduleId: input.classScheduleId }, select: { id: true } });
    if (upgraded) throw new ApplicationLinkNotFoundError();
    const legacy = await tx.reservationApplicationLink.findUnique({ where: { classScheduleId: input.classScheduleId }, select: { id: true, token: true, groupId: true, updatedAt: true } });
    if (!legacy?.token || legacy.groupId) throw new ApplicationLinkNotFoundError();
    await tx.reservationApplicationLink.update({ where: { id: legacy.id }, data: { token, isActive: true, issuedAt: input.now, issuedById: input.actorUserId, updatedAt: new Date(Math.max(input.now.getTime(), legacy.updatedAt.getTime() + 1)) } });
  }, TX_OPTIONS);
  return { token };
}

/** Explicit one-way Phase 18 upgrade. The existing opaque raw URL is converted to its hash in place. */
export async function upgradeLegacyApplicationLinkCore(
  client: UpgradeClient,
  input: { classScheduleId: string; actorUserId: string; now: Date; configReady: boolean; revision?: string },
): Promise<{ groupId: string }> {
  return client.$transaction(async (tx) => {
    // The settings singleton is authoritative at the write point.  The action
    // may have rendered with a now-stale ready value, so it cannot authorize
    // an upgrade on its own.
    const settings = await tx.reservationApplicationSettings.findUnique({
      where: { id: 1 },
      select: { bankName: true, accountNumber: true, accountHolder: true, blogUrl: true, instagramUrl: true, kakaoChannelUrl: true },
    });
    if (!isConsentContentReady(process.env.VERCEL_ENV) || !input.configReady || !settings || !isReservationApplicationSettingsReady(settings)) throw new ApplicationLinkNotFoundError();
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ClassSchedule" WHERE "id" = ${input.classScheduleId} FOR UPDATE`;
    if (!rows[0]) throw new ApplicationLinkNotFoundError();
    if (input.revision && await readClassLinkRevision(tx, input.classScheduleId) !== input.revision) throw new LinkRevisionConflictError();
    const schedule = await tx.classSchedule.findUnique({ where: { id: input.classScheduleId }, select: { status: true, startsAt: true, applicationPrice: true } });
    if (!schedule || !canIssueApplicationLink(schedule, input.now) || !schedule.applicationPrice || schedule.applicationPrice <= 0) throw new ApplicationLinkClassClosedError();
    const legacy = await tx.reservationApplicationLink.findUnique({ where: { classScheduleId: input.classScheduleId }, select: { id: true, token: true, groupId: true } });
    if (!legacy?.token || legacy.groupId) throw new ApplicationLinkNotFoundError();
    const group = await tx.reservationApplicationGroup.create({ data: { createdById: input.actorUserId, upgradedLegacyClassScheduleId: input.classScheduleId, classes: { create: { classScheduleId: input.classScheduleId } } }, select: { id: true } });
    await tx.reservationApplicationLink.update({ where: { id: legacy.id }, data: { classScheduleId: null, token: null, groupId: group.id, tokenHash: hashApplicationCapabilityToken(legacy.token), isActive: true, issuedAt: input.now, issuedById: input.actorUserId } });
    return { groupId: group.id };
  }, TX_OPTIONS);
}

/** 링크를 중지한다. 이미 중지됐거나 링크가 없으면 ApplicationLinkNotFoundError. */
export async function stopApplicationLinkCore(
  client: StopClient,
  input: { classScheduleId: string; revision?: string },
): Promise<void> {
  const stop = async (tx: Pick<PrismaClient, "reservationApplicationLink">, updatedAt?: Date) => {
    const result = await tx.reservationApplicationLink.updateMany({ where: { classScheduleId: input.classScheduleId, isActive: true }, data: { isActive: false, ...(updatedAt ? { updatedAt } : {}) } });
    if (result.count === 0) throw new ApplicationLinkNotFoundError();
  };
  // Preserve the old internal adapter for callers without a transaction; revised UI always uses the locked path.
  if (!input.revision) return stop(client);
  await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ClassSchedule" WHERE "id" = ${input.classScheduleId} FOR UPDATE`;
    if (await readClassLinkRevision(tx, input.classScheduleId) !== input.revision) throw new LinkRevisionConflictError();
    const link = await tx.reservationApplicationLink.findUnique({ where: { classScheduleId: input.classScheduleId }, select: { updatedAt: true } });
    if (!link) throw new ApplicationLinkNotFoundError();
    await stop(tx, new Date(Math.max(Date.now(), link.updatedAt.getTime() + 1)));
  }, TX_OPTIONS);
}
