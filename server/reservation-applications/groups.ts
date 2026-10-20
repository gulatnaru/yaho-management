import { createHash } from "node:crypto";
import { z } from "zod";
import { isConsentContentReady } from "@/lib/reservation-applications/consent-content";
import { isReservationApplicationSettingsReady } from "./settings";
import { Prisma, type PrismaClient } from "@prisma/client";
import { canIssueApplicationLink } from "@/lib/reservation-applications/availability";
import { ApplicationClosedError, ApplicationLinkClassClosedError, ApplicationLinkNotFoundError } from "@/lib/reservation-applications/errors";
import { hashApplicationCapabilityToken, generateApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { reservationApplicationSettingsSchema, type groupSubmissionSchema } from "@/lib/reservation-applications/phase20-validation";

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

type GroupSubmission = z.infer<typeof groupSubmissionSchema>;

type GroupClient = Pick<PrismaClient, "classSchedule" | "reservationApplicationGroup" | "reservationApplicationLink" | "$transaction">;

async function lockGroup(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ReservationApplicationGroup" WHERE "id" = ${groupId} FOR UPDATE
  `;
  if (!rows[0]) throw new ApplicationLinkNotFoundError();
}

async function lockClassSchedules(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) throw new ApplicationLinkNotFoundError();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ClassSchedule" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE
  `;
  if (rows.length !== ids.length) throw new ApplicationLinkNotFoundError();
}

/** Companion issuance shares the finance/retention parent -> application lock order. */
async function lockSubmission(tx: Prisma.TransactionClient, submissionId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ReservationApplicationSubmission" WHERE "id" = ${submissionId} FOR UPDATE
  `;
  if (!rows[0]) throw new ApplicationClosedError();
}

async function lockSubmissionApplications(tx: Prisma.TransactionClient, submissionId: string): Promise<void> {
  await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ReservationApplication"
    WHERE "submissionId" = ${submissionId}
    ORDER BY "id" FOR UPDATE
  `;
}

/** Create an arbitrary collection of existing schedules. Price is deliberately read from schedules, never Program. */
export async function createApplicationGroupCore(
  client: GroupClient,
  input: { classScheduleIds: string[]; actorUserId: string; now: Date; syntheticRunId?: string; syntheticSettings?: unknown },
): Promise<{ groupId: string }> {
  const ids = [...new Set(input.classScheduleIds)].sort();
  if (ids.length === 0 || ids.length !== input.classScheduleIds.length) throw new ApplicationLinkNotFoundError();
  const syntheticSettings = input.syntheticSettings === undefined ? undefined : reservationApplicationSettingsSchema.parse(input.syntheticSettings);
  if (syntheticSettings && !input.syntheticRunId) throw new ApplicationLinkNotFoundError();
  return client.$transaction(async (tx) => {
    await lockClassSchedules(tx, ids);
    const schedules = await tx.classSchedule.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, startsAt: true, applicationPrice: true },
    });
    if (schedules.length !== ids.length) throw new ApplicationLinkNotFoundError();
    for (const schedule of schedules) {
      if (!canIssueApplicationLink(schedule, input.now) || !schedule.applicationPrice || schedule.applicationPrice <= 0) {
        throw new ApplicationLinkClassClosedError();
      }
    }
    const group = await tx.reservationApplicationGroup.create({
      data: {
        createdById: input.actorUserId,
        syntheticRunId: input.syntheticRunId ?? null,
        syntheticSettings: syntheticSettings ?? undefined,
        classes: { create: ids.map((classScheduleId) => ({ classScheduleId })) },
      },
      select: { id: true },
    });
    return { groupId: group.id };
  }, TX_OPTIONS);
}

/** Editing membership only affects future submissions; existing submitted quotes and classes remain immutable. */
export async function updateApplicationGroupCore(
  client: GroupClient,
  input: { groupId: string; classScheduleIds: string[]; now: Date; revision?: string },
): Promise<void> {
  const ids = [...new Set(input.classScheduleIds)].sort();
  if (ids.length === 0 || ids.length !== input.classScheduleIds.length) throw new ApplicationLinkNotFoundError();
  await client.$transaction(async (tx) => {
    await lockGroup(tx, input.groupId);
    const group = await tx.reservationApplicationGroup.findUnique({
      where: { id: input.groupId },
      select: { updatedAt: true, classes: { select: { classScheduleId: true } } },
    });
    if (!group) throw new ApplicationLinkNotFoundError();
    if (input.revision) {
      const current = await tx.reservationApplicationGroup.findUnique({ where: { id: input.groupId }, select: GROUP_REVISION_SELECT });
      if (!current || linkRevision(current) !== input.revision) throw new LinkRevisionConflictError();
    }
    const existingIds = group.classes.map((item) => item.classScheduleId);
    const existingSet = new Set(existingIds);
    const lockedIds = [...new Set([...existingIds, ...ids])].sort();
    await lockClassSchedules(tx, lockedIds);
    const schedules = await tx.classSchedule.findMany({ where: { id: { in: lockedIds } }, select: { id: true, status: true, startsAt: true, applicationPrice: true } });
    if (schedules.length !== lockedIds.length) throw new ApplicationLinkNotFoundError();
    // A selected past/cancelled or no-price member remains until the ADMIN
    // explicitly unchecks it. Only a newly added member must be eligible now.
    if (schedules.some((schedule) => ids.includes(schedule.id) && !existingSet.has(schedule.id) && (!canIssueApplicationLink(schedule, input.now) || !schedule.applicationPrice || schedule.applicationPrice <= 0))) {
      throw new ApplicationLinkClassClosedError();
    }
    await tx.reservationApplicationGroupClass.deleteMany({ where: { groupId: input.groupId } });
    await tx.reservationApplicationGroupClass.createMany({ data: ids.map((classScheduleId) => ({ groupId: input.groupId, classScheduleId })) });
    // Membership rows can return to the same set. Advance the parent revision so
    // an old confirmation cannot become valid again after remove/re-add (ABA).
    await tx.reservationApplicationGroup.update({ where: { id: input.groupId }, data: { updatedAt: new Date(Math.max(input.now.getTime(), group.updatedAt.getTime() + 1)) } });
  }, TX_OPTIONS);
}

/** Stopping a group makes every extant group URL unavailable immediately. */
export async function stopApplicationGroupCore(client: GroupClient, input: { groupId: string }): Promise<void> {
  await client.$transaction(async (tx) => {
    await lockGroup(tx, input.groupId);
    const updated = await tx.reservationApplicationGroup.updateMany({ where: { id: input.groupId, isActive: true }, data: { isActive: false } });
    if (updated.count !== 1) throw new ApplicationLinkNotFoundError();
    await tx.reservationApplicationLink.updateMany({ where: { groupId: input.groupId, isActive: true }, data: { isActive: false } });
  }, TX_OPTIONS);
}

/** A group link is hashed at rest. Returning its raw token is the sole caller-visible occurrence. */
export async function issueApplicationGroupLinkCore(
  client: GroupClient,
  input: { groupId: string; actorUserId: string; now: Date; generateToken?: () => string },
): Promise<{ token: string }> {
  const token = (input.generateToken ?? generateApplicationCapabilityToken)();
  await client.$transaction(async (tx) => {
    await lockGroup(tx, input.groupId);
    const group = await tx.reservationApplicationGroup.findUnique({
      where: { id: input.groupId },
      select: { id: true, isActive: true, classes: { select: { classSchedule: { select: { id: true, status: true, startsAt: true, applicationPrice: true } } } } },
    });
    if (!group || group.classes.length === 0) throw new ApplicationLinkNotFoundError();
    const classIds = group.classes.map(({ classSchedule }) => classSchedule.id).sort();
    await lockClassSchedules(tx, classIds);
    const schedules = await tx.classSchedule.findMany({ where: { id: { in: classIds } }, select: { id: true, status: true, startsAt: true, applicationPrice: true } });
    if (schedules.length !== classIds.length || schedules.some((schedule) => !canIssueApplicationLink(schedule, input.now) || !schedule.applicationPrice || schedule.applicationPrice <= 0)) throw new ApplicationLinkClassClosedError();
    if (!group.isActive) await tx.reservationApplicationGroup.update({ where: { id: group.id }, data: { isActive: true } });
    await tx.reservationApplicationLink.updateMany({ where: { groupId: group.id, isActive: true }, data: { isActive: false } });
    await tx.reservationApplicationLink.create({ data: { groupId: group.id, tokenHash: hashApplicationCapabilityToken(token), isActive: true, issuedAt: input.now, issuedById: input.actorUserId } });
  }, TX_OPTIONS);
  return { token };
}

type GroupSubmitClient = Pick<PrismaClient, "reservationApplicationLink" | "$transaction">;

/**
 * Atomically writes one guardian submission and its independent applications. The class id is
 * verified against the group membership while the submitted quote is snapshotted from the locked schedule.
 */
export async function submitApplicationGroupCore(
  client: GroupSubmitClient,
  input: { token?: string; companionToken?: string; previousDeviceTokenHash?: string; data: GroupSubmission; consentVersion: string; now: Date; configReady: boolean; completionTokenHash: string; completionExpiresAt: Date; deviceTokenHash: string; deviceExpiresAt: Date },
): Promise<{ submissionId: string; applicationIds: string[] }> {
  if (!input.configReady) throw new ApplicationClosedError();
  if (!input.token && !input.companionToken) throw new ApplicationClosedError();
  const tokenHash = input.token ? hashApplicationCapabilityToken(input.token) : undefined;
  return client.$transaction(async (tx) => {
    const link = tokenHash ? await tx.reservationApplicationLink.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        isActive: true,
        group: {
          select: {
            id: true, isActive: true,
            classes: { select: { classSchedule: { select: { id: true, status: true, startsAt: true, applicationPrice: true } } } },
          },
        },
      },
    }) : null;
    // An invite proves only companionship in this group. It never provides a child,
    // guardian, or consent record from the issuer.
    const invite = input.companionToken
      ? await tx.companionInvite.findFirst({
          where: {
            tokenHash: hashApplicationCapabilityToken(input.companionToken),
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
          select: { id: true, companionGroupId: true, group: { select: { id: true, isActive: true, classes: { select: { classSchedule: { select: { id: true, status: true, startsAt: true, applicationPrice: true } } } } } } },
        })
      : null;
    if (input.companionToken && !invite) throw new ApplicationClosedError();
    let group = link?.group ?? invite?.group;
    if (!group?.isActive || (tokenHash && !link?.isActive) || (link && invite && link.group?.id !== invite.group.id)) throw new ApplicationClosedError();
    // All writers that affect a public submission use this lock hierarchy:
    // Group -> Link/invite -> Class -> Device -> Child. The scoped re-reads below
    // make a concurrent stop, membership edit, revocation, price edit, or purge fail closed.
    await lockGroup(tx, group.id);
    if (link) await tx.$queryRaw`SELECT "id" FROM "ReservationApplicationLink" WHERE "id" = ${link.id} FOR UPDATE`;
    if (invite) await tx.$queryRaw`SELECT "id" FROM "CompanionInvite" WHERE "id" = ${invite.id} FOR UPDATE`;
    const lockedLink = tokenHash ? await tx.reservationApplicationLink.findUnique({ where: { tokenHash }, select: { isActive: true, group: { select: { id: true, isActive: true } } } }) : null;
    const lockedInvite = input.companionToken ? await tx.companionInvite.findFirst({ where: { tokenHash: hashApplicationCapabilityToken(input.companionToken), revokedAt: null, expiresAt: { gt: input.now } }, select: { companionGroupId: true, group: { select: { id: true, isActive: true } } } }) : null;
    if ((tokenHash && !lockedLink?.isActive) || (input.companionToken && !lockedInvite) || !lockedLink?.group?.isActive && !lockedInvite?.group?.isActive || (lockedLink?.group && lockedInvite?.group && lockedLink.group.id !== lockedInvite.group.id)) throw new ApplicationClosedError();
    const groupId = lockedLink?.group?.id ?? lockedInvite?.group?.id;
    if (!groupId || groupId !== group.id) throw new ApplicationClosedError();
    const membership = await tx.reservationApplicationGroupClass.findMany({ where: { groupId }, select: { classScheduleId: true } });
    const memberIds = membership.map((row) => row.classScheduleId).sort();
    await lockClassSchedules(tx, memberIds);
    const currentSchedules = await tx.classSchedule.findMany({ where: { id: { in: memberIds } }, select: { id: true, status: true, startsAt: true, applicationPrice: true } });
    if (currentSchedules.length !== memberIds.length) throw new ApplicationClosedError();
    group = { ...group, id: groupId, isActive: true, classes: currentSchedules.map((classSchedule) => ({ classSchedule })) };
    const schedules = new Map(group.classes.map(({ classSchedule }) => [classSchedule.id, classSchedule]));
    if (input.data.children.some((child) => {
      const schedule = schedules.get(child.classScheduleId);
      return !schedule || !canIssueApplicationLink(schedule, input.now) || !schedule.applicationPrice;
    })) throw new ApplicationClosedError();

    const requestedIds = input.data.children.flatMap((child) => child.requestedChildId ? [child.requestedChildId] : []);
    let priorDevice: { id: string; children: Array<{ childId: string; child: { name: string; birthDate: Date | null; gender: string; guardianName: string | null; guardianPhone: string | null } }> } | null = null;
    let currentGrantedChildren: Array<{ id: string; name: string; birthDate: Date | null; gender: string; guardianName: string | null; guardianPhone: string | null }> = [];
    let sameGuardianDevice = false;
    if (input.previousDeviceTokenHash) {
      await tx.$queryRaw`SELECT "id" FROM "ApplicationDevice" WHERE "tokenHash" = ${input.previousDeviceTokenHash} FOR UPDATE`;
      priorDevice = await tx.applicationDevice.findFirst({
        where: { tokenHash: input.previousDeviceTokenHash, revokedAt: null, expiresAt: { gt: input.now } },
        select: {
          id: true,
          children: { where: { child: { isActive: true, personalDataPurgedAt: null } }, select: { childId: true, child: { select: { name: true, birthDate: true, gender: true, guardianName: true, guardianPhone: true } } } },
          submissions: { where: { submission: { personalDataPurgedAt: null } }, orderBy: { createdAt: "desc" }, select: { submission: { select: { guardianName: true, guardianPhone: true, guardianRelationship: true } } }, take: 1 },
        },
      });
      const owner = (priorDevice as typeof priorDevice & { submissions?: Array<{ submission: { guardianName: string | null; guardianPhone: string | null; guardianRelationship: string | null } }> } | null)?.submissions?.[0]?.submission;
      sameGuardianDevice = Boolean(owner && owner.guardianName === input.data.guardianName && owner.guardianPhone === input.data.guardianPhone && owner.guardianRelationship === input.data.guardianRelationship);
      const grantedIds = priorDevice?.children.map((row) => row.childId).sort() ?? [];
      if (grantedIds.length > 0) {
        await tx.$queryRaw`SELECT "id" FROM "Child" WHERE "id" IN (${Prisma.join(grantedIds)}) ORDER BY "id" FOR SHARE`;
        currentGrantedChildren = await tx.child.findMany({ where: { id: { in: grantedIds }, isActive: true, personalDataPurgedAt: null }, select: { id: true, name: true, birthDate: true, gender: true, guardianName: true, guardianPhone: true } });
      }
      if (requestedIds.length > 0) {
        const requested = new Map(input.data.children.filter((child) => child.requestedChildId).map((child) => [child.requestedChildId!, child]));
        const granted = currentGrantedChildren.filter((child) => requested.has(child.id));
        const exactIdentity = granted.every((row) => {
          const submitted = requested.get(row.id);
          return Boolean(submitted && row.name === submitted.childName && row.birthDate?.getTime() === new Date(submitted.childBirthDate).getTime() && row.gender === submitted.childGender && row.guardianName === owner?.guardianName && row.guardianPhone === owner?.guardianPhone);
        });
        if (!sameGuardianDevice || granted.length !== requestedIds.length || !exactIdentity) throw new ApplicationClosedError();
      }
    } else if (requestedIds.length > 0) {
      throw new ApplicationClosedError();
    }

    const submission = await tx.reservationApplicationSubmission.create({
      data: {
        groupId: group.id,
        guardianName: input.data.guardianName,
        guardianPhone: input.data.guardianPhone,
        guardianRelationship: input.data.guardianRelationship,
        declaredPayerName: input.data.declaredPayerName,
        submittedAt: input.now,
        completionTokenHash: input.completionTokenHash,
        completionExpiresAt: input.completionExpiresAt,
      },
      select: { id: true },
    });
    // Keep the same Device id for a same-guardian rotation. Existing and later
    // DeviceChild grants stay attached as sibling submissions are confirmed, while
    // the prior opaque hash fails immediately. A different guardian gets a new id.
    const device = sameGuardianDevice && priorDevice
      ? await tx.applicationDevice.update({ where: { id: priorDevice.id }, data: { tokenHash: input.deviceTokenHash, expiresAt: input.deviceExpiresAt }, select: { id: true } })
      : await tx.applicationDevice.create({ data: { tokenHash: input.deviceTokenHash, expiresAt: input.deviceExpiresAt }, select: { id: true } });
    await tx.deviceSubmission.create({ data: { deviceId: device.id, submissionId: submission.id } });
    if (invite) {
      await tx.companionGroupMember.create({ data: { companionGroupId: invite.companionGroupId, submissionId: submission.id } });
    }
    const applicationIds: string[] = [];
    for (const child of input.data.children) {
      const quote = schedules.get(child.classScheduleId)!.applicationPrice!;
      const application = await tx.reservationApplication.create({
        data: {
          submissionId: submission.id,
          classScheduleId: child.classScheduleId,
          quotedAmount: quote,
          requestedChildId: child.requestedChildId ?? null,
          childName: child.childName,
          childBirthDate: new Date(child.childBirthDate),
          childGender: child.childGender,
          guardianName: null,
          guardianPhone: null,
          guardianRelationship: null,
          requestNote: child.requestNote ?? null,
          programTermsAcknowledged: child.programTerms,
          privacyConsentAgreed: child.privacyConsent,
          legalGuardianConfirmed: child.legalGuardianConfirmation,
          refundTermsAcknowledged: child.refundTerms,
          photoShareConsentAgreed: child.photoShareConsent,
          photoMarketingConsentAgreed: child.photoMarketingConsent,
          consentVersion: input.consentVersion,
          submittedAt: input.now,
        },
        select: { id: true },
      });
      applicationIds.push(application.id);
    }
    return { submissionId: submission.id, applicationIds };
  }, TX_OPTIONS);
}

/** A companion invite only authorizes another independent submission in this same group. */
export async function issueCompanionInviteCore(
  client: Pick<PrismaClient, "reservationApplicationSubmission" | "companionGroup" | "companionInvite" | "$transaction">,
  input: { submissionId: string; now: Date; classEndsAt: Date; generateToken?: () => string },
): Promise<{ token: string; expiresAt: Date }> {
  return client.$transaction(async (tx) => {
    // Close, confirmation and retention all serialize parent then child rows.
    // Re-read only after those locks so a terminal or purged issuer cannot mint
    // an invite from a stale pre-lock snapshot.
    await lockSubmission(tx, input.submissionId);
    await lockSubmissionApplications(tx, input.submissionId);
    const submission = await tx.reservationApplicationSubmission.findUnique({
      where: { id: input.submissionId },
      select: { id: true, groupId: true, personalDataPurgedAt: true, applications: { select: { status: true } } },
    });
    if (!submission?.groupId || submission.personalDataPurgedAt || !submission.applications.some((application) => application.status === "SUBMITTED")) throw new ApplicationClosedError();
    await lockGroup(tx, submission.groupId);
    const group = await tx.reservationApplicationGroup.findUnique({
      where: { id: submission.groupId },
      select: { isActive: true, classes: { select: { classSchedule: { select: { id: true, status: true, startsAt: true, endsAt: true, applicationPrice: true } } } } },
    });
    if (!group?.isActive || group.classes.length === 0) throw new ApplicationClosedError();
    const classIds = group.classes.map(({ classSchedule }) => classSchedule.id).sort();
    await lockClassSchedules(tx, classIds);
    const schedules = await tx.classSchedule.findMany({ where: { id: { in: classIds } }, select: { status: true, startsAt: true, endsAt: true, applicationPrice: true } });
    if (schedules.length !== classIds.length || schedules.some((schedule) => !canIssueApplicationLink(schedule, input.now) || !schedule.applicationPrice || schedule.applicationPrice <= 0)) throw new ApplicationClosedError();
    const groupEndsAt = schedules.reduce((earliest, schedule) => schedule.endsAt < earliest ? schedule.endsAt : earliest, schedules[0]!.endsAt);
    const expiresAt = new Date(Math.min(input.now.getTime() + 14 * 24 * 60 * 60 * 1000, input.classEndsAt.getTime(), groupEndsAt.getTime()));
    if (expiresAt.getTime() <= input.now.getTime()) throw new ApplicationClosedError();
    const companionGroup = await tx.companionGroup.create({ data: { groupId: submission.groupId, issuerSubmissionId: submission.id }, select: { id: true } });
    const token = (input.generateToken ?? generateApplicationCapabilityToken)();
    await tx.companionInvite.create({
      data: { issuerSubmissionId: submission.id, groupId: submission.groupId, companionGroupId: companionGroup.id, tokenHash: hashApplicationCapabilityToken(token), expiresAt },
    });
    return { token, expiresAt };
  }, TX_OPTIONS);
}

/** The issuer can revoke only its own opaque invite. No companion PII is read or returned. */
export async function revokeCompanionInviteCore(
  client: Pick<PrismaClient, "companionInvite" | "$transaction">,
  input: { inviteToken: string; issuerSubmissionId: string; now: Date },
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    const invite = await tx.companionInvite.findFirst({ where: { tokenHash: hashApplicationCapabilityToken(input.inviteToken), issuerSubmissionId: input.issuerSubmissionId, revokedAt: null }, select: { id: true, groupId: true } });
    if (!invite) return false;
    await lockGroup(tx, invite.groupId);
    await tx.$queryRaw`SELECT "id" FROM "CompanionInvite" WHERE "id" = ${invite.id} FOR UPDATE`;
    const result = await tx.companionInvite.updateMany({ where: { id: invite.id, issuerSubmissionId: input.issuerSubmissionId, revokedAt: null }, data: { revokedAt: input.now } });
    return result.count === 1;
  }, TX_OPTIONS);
}

export function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}


export class LinkOperationConflictError extends Error {}
export class LinkRevisionConflictError extends Error {}
export class LinkSettingsNotReadyError extends Error {}

export const classLinkOperationSchema = z.object({
  operationId: z.string().uuid(),
  kind: z.enum(["single", "compose", "issue", "replace", "resume", "stop"]),
  groupId: z.string().min(1).max(200).optional(),
  classScheduleIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  revisions: z.record(z.string().min(1).max(200), z.string().regex(/^[a-f0-9]{64}$/)),
  groupRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.classScheduleIds);
  if (ids.size !== value.classScheduleIds.length || Object.keys(value.revisions).length !== ids.size || [...ids].some((id) => !value.revisions[id])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "scope" });
  if ((value.kind === "single" || value.kind === "compose") ? Boolean(value.groupId) || (value.kind === "single" && ids.size !== 1) : !value.groupId || !value.groupRevision) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "intent" });
});
export type ClassLinkOperation = z.infer<typeof classLinkOperationSchema>;
export type ClassLinkReceipt = { groupId: string; linkId?: string; token?: string; replayed: boolean; active: boolean };
export function linkRevision(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export const GROUP_REVISION_SELECT = {
  id: true, isActive: true, updatedAt: true,
  classes: { select: { classScheduleId: true }, orderBy: { classScheduleId: "asc" as const } },
  links: { select: { id: true, isActive: true, updatedAt: true }, orderBy: { id: "asc" as const } },
} as const;

/** Includes class/price changes, direct links, membership and every related group URL. No capability is read. */
export async function readClassLinkRevision(tx: Pick<Prisma.TransactionClient, "classSchedule" | "reservationApplicationLink" | "reservationApplicationGroup">, classScheduleId: string): Promise<string> {
  const schedule = await tx.classSchedule.findUnique({ where: { id: classScheduleId }, select: { id: true, updatedAt: true, applicationPrice: true, status: true, startsAt: true } });
  if (!schedule) throw new ApplicationLinkNotFoundError();
  const links = await tx.reservationApplicationLink.findMany({ where: { classScheduleId }, select: { id: true, isActive: true, updatedAt: true }, orderBy: { id: "asc" } });
  const groups = await tx.reservationApplicationGroup.findMany({ where: { OR: [{ classes: { some: { classScheduleId } } }, { upgradedLegacyClassScheduleId: classScheduleId }] }, select: GROUP_REVISION_SELECT, orderBy: { id: "asc" } });
  return linkRevision({ schedule, links, groups });
}

/** Namespace encodes actor + operation; the suffix commits immutable intent even after membership edits. */
export function classLinkOperationIdentity(actorUserId: string, input: ClassLinkOperation) {
  const prefix = `ux2_${linkRevision([actorUserId, input.operationId])}_`;
  const digest = linkRevision({ kind: input.kind, groupId: input.groupId ?? null, classScheduleIds: [...input.classScheduleIds].sort(), revisions: Object.entries(input.revisions).sort(([a], [b]) => a.localeCompare(b)), groupRevision: input.groupRevision ?? null });
  return { prefix, id: `${prefix}${digest}` };
}

/** One transaction for group, membership and first hash. A replay never returns/reconstructs a token. */
export async function issueClassLinkOperationCore(client: Pick<PrismaClient, "$transaction">, input: ClassLinkOperation & { actorUserId: string; now: Date; generateToken?: () => string }): Promise<ClassLinkReceipt> {
  const intent = classLinkOperationSchema.parse({ operationId: input.operationId, kind: input.kind, groupId: input.groupId, classScheduleIds: input.classScheduleIds, revisions: input.revisions, groupRevision: input.groupRevision });
  const identity = classLinkOperationIdentity(input.actorUserId, intent);
  const ids = [...intent.classScheduleIds].sort();
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.prefix}, 0))`;
    const priorGroup = await tx.reservationApplicationGroup.findFirst({ where: { id: { startsWith: identity.prefix } }, select: { id: true } });
    const priorLink = await tx.reservationApplicationLink.findFirst({ where: { id: { startsWith: identity.prefix } }, select: { id: true, groupId: true, isActive: true } });
    if (priorGroup && priorGroup.id !== identity.id || priorLink && priorLink.id !== identity.id) throw new LinkOperationConflictError();
    const isNew = intent.kind === "single" || intent.kind === "compose";
    const groupId = isNew ? identity.id : intent.groupId!;
    if (isNew && priorGroup || !isNew && priorLink) {
      await lockGroup(tx, groupId);
      const current = await tx.reservationApplicationGroup.findUnique({ where: { id: groupId }, select: { isActive: true } });
      // The initial lookup preceded the Group lock. Replacement/stop may have
      // completed while this transaction waited, so reconcile from locked state.
      const link = await tx.reservationApplicationLink.findUnique({ where: { id: identity.id }, select: { id: true, isActive: true } });
      return { groupId, linkId: link?.id, replayed: true, active: Boolean(current?.isActive && link?.isActive) };
    }
    if (isNew) {
      // A fresh unreferenced Group is created first; no existing Group is locked after classes.
      await tx.reservationApplicationGroup.create({ data: { id: groupId, createdById: input.actorUserId }, select: { id: true } });
    } else {
      await lockGroup(tx, groupId);
      const group = await tx.reservationApplicationGroup.findUnique({ where: { id: groupId }, select: GROUP_REVISION_SELECT });
      if (!group || linkRevision(group) !== intent.groupRevision || JSON.stringify(group.classes.map((row) => row.classScheduleId).sort()) !== JSON.stringify(ids)) throw new LinkRevisionConflictError();
      const hasActive = group.isActive && group.links.some((row) => row.isActive);
      if (intent.kind === "replace" && !hasActive || intent.kind === "issue" && group.links.length > 0 || intent.kind === "resume" && hasActive) throw new LinkRevisionConflictError();
    }
    await lockClassSchedules(tx, ids);
    for (const id of ids) if (await readClassLinkRevision(tx, id) !== intent.revisions[id]) throw new LinkRevisionConflictError();
    if (intent.kind === "stop") {
      await tx.reservationApplicationGroup.update({ where: { id: groupId }, data: { isActive: false } });
      await tx.reservationApplicationLink.updateMany({ where: { groupId, isActive: true }, data: { isActive: false } });
      return { groupId, replayed: false, active: false };
    }
    const schedules = await tx.classSchedule.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, startsAt: true, applicationPrice: true } });
    if (schedules.length !== ids.length || schedules.some((row) => !canIssueApplicationLink(row, input.now) || !row.applicationPrice || row.applicationPrice <= 0)) throw new ApplicationLinkClassClosedError();
    const settings = await tx.reservationApplicationSettings.findUnique({ where: { id: 1 } });
    if (!settings || !isReservationApplicationSettingsReady(settings) || !isConsentContentReady(process.env.VERCEL_ENV)) throw new LinkSettingsNotReadyError();
    if (isNew) await tx.reservationApplicationGroupClass.createMany({ data: ids.map((classScheduleId) => ({ groupId, classScheduleId })) });
    else {
      await tx.reservationApplicationGroup.update({ where: { id: groupId }, data: { isActive: true } });
      await tx.reservationApplicationLink.updateMany({ where: { groupId, isActive: true }, data: { isActive: false } });
    }
    const token = (input.generateToken ?? generateApplicationCapabilityToken)();
    await tx.reservationApplicationLink.create({ data: { id: identity.id, groupId, tokenHash: hashApplicationCapabilityToken(token), isActive: true, issuedAt: input.now, issuedById: input.actorUserId } });
    return { groupId, linkId: identity.id, token, replayed: false, active: true };
  }, TX_OPTIONS);
}
