import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { GROUP_REVISION_SELECT, issueClassLinkOperationCore, linkRevision, readClassLinkRevision, LinkOperationConflictError, LinkRevisionConflictError, updateApplicationGroupCore, type ClassLinkOperation } from "@/server/reservation-applications/groups";
import { isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";

// Defense in depth in addition to vitest.integration.config.ts. No remote fixture/cleanup is possible.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const otherAdminDb = new PrismaClient();
const run = `ux2-${crypto.randomUUID()}`;
const now = new Date();
const startsAt = new Date(now.getTime() + 86400000 * 100);
const classIds = [0, 1, 2].map((n) => `${run}-class-${n}`);
const actorIds = [0, 1].map((n) => `${run}-admin-${n}`);
let ownedSettings = false;

async function createIntent(ids = [classIds[0]!], kind: "single" | "compose" = "single"): Promise<ClassLinkOperation> {
  return { operationId: crypto.randomUUID(), kind, classScheduleIds: ids, revisions: Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await readClassLinkRevision(db, id)]))) };
}
async function groupIntent(groupId: string, kind: "replace" | "stop" | "resume"): Promise<ClassLinkOperation> {
  const group = await db.reservationApplicationGroup.findUniqueOrThrow({ where: { id: groupId }, select: GROUP_REVISION_SELECT });
  return { ...(await createIntent(group.classes.map((row) => row.classScheduleId), "compose")), groupId, kind, groupRevision: linkRevision(group) };
}
function issue(intent: ClassLinkOperation, client = db, actorUserId = actorIds[0]!) { return issueClassLinkOperationCore(client, { ...intent, actorUserId, now }); }

async function createHistoricalApplication() {
  const group = await db.reservationApplicationGroup.create({ data: { createdById: actorIds[0]!, classes: { create: { classScheduleId: classIds[0]! } } } });
  const submission = await db.reservationApplicationSubmission.create({ data: { groupId: group.id, guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자" } });
  // Existing DB CHECKs distinguish modern quoted applications from legacy rows:
  // the guardian belongs to the parent submission, never the quoted child row.
  return db.reservationApplication.create({ data: { submissionId: submission.id, classScheduleId: classIds[0]!, quotedAmount: 12000, childName: "합성 아이", childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: "synthetic-v1" } });
}

beforeAll(async () => {
  await db.user.createMany({ data: actorIds.map((id) => ({ id, name: "합성 관리자", email: `${id}@example.test`, role: "ADMIN" })) });
  const settings = await db.reservationApplicationSettings.findUnique({ where: { id: 1 } });
  if (!settings) { await db.reservationApplicationSettings.create({ data: { id: 1, bankName: "합성 은행", accountNumber: "123", accountHolder: "합성 예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/photo", kakaoChannelUrl: "https://example.test/chat", updatedById: actorIds[0]! } }); ownedSettings = true; }
  else if (!isReservationApplicationSettingsReady(settings)) throw new Error("LOCAL_TEST_SETTINGS_NOT_READY");
  await db.program.create({ data: { id: run, name: "합성 프로그램", defaultPrice: 999999 } });
  await db.classSchedule.createMany({ data: classIds.map((id) => ({ id, programId: run, startsAt, endsAt: new Date(startsAt.getTime() + 3600000), location: "합성 장소", applicationPrice: 20000, capacity: 8 })) });
}, 30000);

afterAll(async () => {
  // Only this run's synthetic records, individually scoped; no reset, migration or shared cleanup.
  const groups = await db.reservationApplicationGroup.findMany({ where: { createdById: { in: actorIds } }, select: { id: true } });
  const groupIds = groups.map((row) => row.id);
  await db.reservationApplication.deleteMany({ where: { classScheduleId: { in: classIds } } });
  await db.reservationApplicationSubmission.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.reservationApplicationLink.deleteMany({ where: { OR: [{ groupId: { in: groupIds } }, { classScheduleId: { in: classIds } }] } });
  await db.reservationApplicationGroupClass.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.reservationApplicationGroup.deleteMany({ where: { id: { in: groupIds } } });
  await db.classSchedule.deleteMany({ where: { id: { in: classIds } } });
  await db.program.deleteMany({ where: { id: run } });
  await db.payment.deleteMany({ where: { memo: run } });
  if (ownedSettings) await db.reservationApplicationSettings.deleteMany({ where: { id: 1, updatedById: actorIds[0] } });
  await db.user.deleteMany({ where: { id: { in: actorIds } } });
  await Promise.all([db.$disconnect(), otherAdminDb.$disconnect()]);
}, 30000);

describe.sequential("dedicated local PostgreSQL safe class issuance", () => {
  it("commits group + membership + hash atomically and retries one operation with metadata only", async () => {
    const intent = await createIntent(); const result = await issue(intent);
    const group = await db.reservationApplicationGroup.findUniqueOrThrow({ where: { id: result.groupId }, include: { classes: true, links: true } });
    expect(group.classes.map((row) => row.classScheduleId)).toEqual(intent.classScheduleIds);
    expect(group.links).toHaveLength(1); expect(group.links[0]?.token).toBeNull(); expect(group.links[0]?.tokenHash).toHaveLength(64);
    const retry = await issue(intent); expect(retry).toMatchObject({ groupId: result.groupId, linkId: result.linkId, replayed: true }); expect(retry.token).toBeUndefined();
    expect(await db.reservationApplicationGroup.count({ where: { id: result.groupId } })).toBe(1);
  });
  it("rolls back group and membership on a mid-transaction link insertion failure", async () => {
    const intent = await createIntent();
    const before = await db.reservationApplicationGroup.count({ where: { createdById: actorIds[0] } });
    const beforeMemberships = await db.reservationApplicationGroupClass.count({ where: { classScheduleId: { in: classIds } } });
    const beforeLinks = await db.reservationApplicationLink.count({ where: { issuedById: { in: actorIds } } });
    const faultClient = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { maxWait: number; timeout: number }) => db.$transaction((tx) => callback(new Proxy(tx, { get(target, property) {
      if (property === "reservationApplicationLink") return new Proxy(target.reservationApplicationLink, { get(model, key) { if (key === "create") return async () => { throw new Error("SYNTHETIC_MID_FAILURE"); }; return Reflect.get(model, key); } });
      return Reflect.get(target, property);
    } })), options) };
    await expect(issueClassLinkOperationCore(faultClient as never, { ...intent, actorUserId: actorIds[0]!, now })).rejects.toThrow("SYNTHETIC_MID_FAILURE");
    expect(await db.reservationApplicationGroup.count({ where: { createdById: actorIds[0] } })).toBe(before);
    expect(await db.reservationApplicationGroupClass.count({ where: { classScheduleId: { in: classIds } } })).toBe(beforeMemberships);
    expect(await db.reservationApplicationLink.count({ where: { issuedById: { in: actorIds } } })).toBe(beforeLinks);
    const success = await issue(intent); expect(success.token).toBeDefined();
  });
  it("rejects a conflicting payload with the same operation ID", async () => {
    const intent = await createIntent(); await issue(intent);
    const other = await createIntent([classIds[1]!]);
    await expect(issue({ ...other, operationId: intent.operationId })).rejects.toBeInstanceOf(LinkOperationConflictError);
  });
  it("serializes identical concurrent retries and gives raw token only to the original success", async () => {
    const intent = await createIntent();
    const results = await Promise.all([issue(intent), issue(intent, otherAdminDb)]);
    expect(new Set(results.map((row) => row.groupId)).size).toBe(1);
    expect(results.filter((row) => row.token)).toHaveLength(1);
  });
  it("rejects the stale independent admin under the class lock without duplicate scope", async () => {
    const first = await createIntent(); const second = { ...first, operationId: crypto.randomUUID() };
    const before = await db.reservationApplicationGroup.count({ where: { createdById: { in: actorIds } } });
    const results = await Promise.allSettled([issue(first), issue(second, otherAdminDb, actorIds[1]!)]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((row) => row.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(LinkRevisionConflictError);
    expect(await db.reservationApplicationGroup.count({ where: { createdById: { in: actorIds } } })).toBe(before + 1);
  });
  it("rejects stale price revision without changing existing applications or payments", async () => {
    const application = await createHistoricalApplication();
    const intent = await createIntent();
    const payment = await db.payment.create({ data: { method: "TRANSFER", totalAmount: 12000, memo: run } });
    const beforeClass = await db.classSchedule.findUniqueOrThrow({ where: { id: classIds[0]! } });
    await db.classSchedule.update({ where: { id: classIds[0]! }, data: { applicationPrice: 30000 } });
    await expect(issue(intent)).rejects.toBeInstanceOf(LinkRevisionConflictError);
    expect(await db.reservationApplication.findUnique({ where: { id: application.id } })).toEqual(application);
    expect(await db.payment.findUnique({ where: { id: payment.id } })).toEqual(payment);
    expect(await db.classSchedule.findUnique({ where: { id: classIds[0]! } })).toMatchObject({ capacity: beforeClass.capacity, status: beforeClass.status, programId: beforeClass.programId, applicationPrice: 30000 });
  });
  it("serializes replace/stop race, protects all unrelated class/group URLs and never reactivates a replay", async () => {
    const target = await issue(await createIntent([classIds[0]!, classIds[1]!], "compose"));
    const unrelated = await issue(await createIntent([classIds[1]!, classIds[2]!], "compose"));
    const before = await db.reservationApplicationLink.findUnique({ where: { id: unrelated.linkId } });
    const replace = await groupIntent(target.groupId, "replace"); const stop = { ...replace, kind: "stop" as const, operationId: crypto.randomUUID() };
    const results = await Promise.allSettled([issue(replace), issue(stop, otherAdminDb, actorIds[1]!)]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect((results.find((row) => row.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(LinkRevisionConflictError);
    expect(await db.reservationApplicationLink.findUnique({ where: { id: unrelated.linkId } })).toEqual(before);
    const latest = await groupIntent(target.groupId, "stop"); await issue(latest);
    // If replace won, its replay must remain inactive after stop. If stop won, the old replace stays stale.
    if (results[0]?.status === "fulfilled") {
      const replay = await issue(replace); expect(replay.active).toBe(false); expect(replay.token).toBeUndefined();
    } else await expect(issue(replace)).rejects.toBeInstanceOf(LinkRevisionConflictError);
  });
  it("preserves historical application quotes and all class prices through successful issue, replace, membership edit and stop", async () => {
    const historical = await createHistoricalApplication();
    const schedulesBefore = await db.classSchedule.findMany({ where: { id: { in: classIds } }, orderBy: { id: "asc" } });
    const created = await issue(await createIntent([classIds[0]!, classIds[1]!], "compose"));
    await issue(await groupIntent(created.groupId, "replace"));
    const oldGroup = await db.reservationApplicationGroup.findUniqueOrThrow({ where: { id: created.groupId }, select: GROUP_REVISION_SELECT });
    const staleIntent = await groupIntent(created.groupId, "replace");
    await updateApplicationGroupCore(db, { groupId: created.groupId, classScheduleIds: [classIds[0]!], revision: linkRevision(oldGroup), now });
    const smallerGroup = await db.reservationApplicationGroup.findUniqueOrThrow({ where: { id: created.groupId }, select: GROUP_REVISION_SELECT });
    await updateApplicationGroupCore(db, { groupId: created.groupId, classScheduleIds: [classIds[0]!, classIds[1]!], revision: linkRevision(smallerGroup), now });
    // Returning to the same class set cannot revive an earlier confirmation.
    await expect(issue(staleIntent)).rejects.toBeInstanceOf(LinkRevisionConflictError);
    await issue(await groupIntent(created.groupId, "stop"));
    expect(await db.reservationApplication.findUnique({ where: { id: historical.id } })).toEqual(historical);
    expect(await db.classSchedule.findMany({ where: { id: { in: classIds } }, orderBy: { id: "asc" } })).toEqual(schedulesBefore);
  });
});
