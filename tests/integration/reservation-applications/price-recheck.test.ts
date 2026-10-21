import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";
import { recheckApplicationGroupPricesCore, stopApplicationGroupCore, submitApplicationGroupCore } from "@/server/reservation-applications/groups";
import { runPhase20PostgresRace } from "../../e2e/support/phase20-race-barrier";
import { submitReservationApplicationCore } from "@/server/reservation-applications/submit";
import { ApplicationAlreadySubmittedError, ApplicationPriceChangedError } from "@/server/reservation-applications/price-review";

// This suite is discovered by the EXISTING integration glob, and cannot run against Preview/Production.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `ux8-${randomUUID()}`, classes = [`${run}-c1`, `${run}-c2`], groups: string[] = [], devices: string[] = [], children: string[] = [], legacyApplications: string[] = [];
const now = new Date(), later = new Date(now.getTime() + 86400000);
let groupId = "", token = "";
const version = APPLICATION_CONSENT_CONTENT.version;
const child = (classScheduleId: string, suffix = "1") => ({ classScheduleId, childName: `합성 아이 ${suffix}`, childBirthDate: "2020-01-01", childGender: "UNSPECIFIED" as const, programTerms: true as const, privacyConsent: true as const, legalGuardianConfirmation: true as const, refundTerms: true as const, photoShareConsent: false, photoMarketingConsent: false });
async function review(ids = classes) { return recheckApplicationGroupPricesCore(db, { token, classScheduleIds: ids, now }); }
async function submission(proof: string, assigned = classes) {
  const deviceTokenHash = hashApplicationCapabilityToken(randomUUID()); devices.push(deviceTokenHash);
  return { token, data: { reviewedPriceProof: proof, consentVersion: version, guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" as const, declaredPayerName: "합성 입금자", children: assigned.map((id, i) => child(id, String(i))) }, consentVersion: version, now, configReady: true, completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: later, deviceTokenHash, deviceExpiresAt: later };
}
async function counts() {
  return Promise.all([db.reservationApplicationSubmission.count({ where: { groupId } }), db.reservationApplication.count({ where: { submission: { groupId } } }), db.child.count({ where: { id: { in: children } } })]);
}
async function noFinance() {
  expect(await db.applicationDeposit.count({ where: { submission: { groupId } } })).toBe(0);
  expect(await db.reservation.count({ where: { classScheduleId: { in: classes } } })).toBe(0);
  expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: classes } } } } } })).toBe(0);
  expect(await db.childConsent.count({ where: { childId: { in: children } } })).toBe(0);
  expect(await db.fundAllocation.count({ where: { deposit: { submission: { groupId } } } })).toBe(0);
  expect(await db.returnObligation.count({ where: { submission: { groupId } } })).toBe(0);
  expect(await db.applicationReturn.count({ where: { returnObligation: { submission: { groupId } } } })).toBe(0);
  expect(await db.paymentItem.count({ where: { reservation: { classScheduleId: { in: classes } } } })).toBe(0);
  expect(await db.reservationApplicationPaymentMapping.count({ where: { application: { submission: { groupId } } } })).toBe(0);
}
/** A real transaction fails after its first sibling write, proving actual PostgreSQL rollback. */
function failSecondApplication() {
  return { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => db.$transaction(async (tx) => {
    let writes = 0;
    return callback({ ...tx, reservationApplication: { ...tx.reservationApplication, create: async (args: Prisma.ReservationApplicationCreateArgs) => {
      if (++writes === 2) throw new Error("SYNTHETIC_SECOND_CHILD_FAILURE");
      return tx.reservationApplication.create(args);
    } } } as unknown as Prisma.TransactionClient);
  }, options) } as unknown as PrismaClient;
}
async function race(target: string, left: (client: PrismaClient) => Promise<unknown>, right: (client: PrismaClient) => Promise<unknown>) {
  return runPhase20PostgresRace({ observer: db, a: db as never, b: db as never, target, transactionOptions: { maxWait: 10000, timeout: 20000 }, left: (client) => left(client as unknown as PrismaClient), right: (client) => right(client as unknown as PrismaClient) });
}
async function ownedChild() {
  const existing = await db.child.create({ data: { name: "합성 아이 0", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: "합성 보호자", guardianPhone: "010-0000-0000" } }); children.push(existing.id);
  const tokenHash = hashApplicationCapabilityToken(randomUUID()); devices.push(tokenHash);
  const owner = await db.reservationApplicationSubmission.create({ data: { groupId, guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" } });
  const device = await db.applicationDevice.create({ data: { tokenHash, expiresAt: later, submissions: { create: { submissionId: owner.id } }, children: { create: { childId: existing.id } } } });
  const payload = await submission((await review()).proof);
  payload.data.children[0] = { ...payload.data.children[0]!, requestedChildId: existing.id } as typeof payload.data.children[0];
  return { existing, device, payload: { ...payload, previousDeviceTokenHash: tokenHash } };
}
beforeAll(async () => {
  vi.stubEnv("AUTH_SECRET", "synthetic-local-pg-price-review-secret");
  await db.user.create({ data: { id: run, email: `${run}@example.test`, name: "합성 관리자", role: "ADMIN" } });
  await db.program.create({ data: { id: run, name: "합성 가격 프로그램", defaultPrice: 999999 } });
  await db.classSchedule.createMany({ data: classes.map((id, i) => ({ id, programId: run, startsAt: new Date("2040-01-01T00:00:00Z"), endsAt: new Date("2040-01-01T01:00:00Z"), location: "합성 장소", capacity: 8, applicationPrice: i ? 60000 : 40000 })) });
}, 30000);
beforeEach(async () => {
  await db.classSchedule.update({ where: { id: classes[0]! }, data: { status: "SCHEDULED", applicationPrice: 40000 } });
  await db.classSchedule.update({ where: { id: classes[1]! }, data: { status: "SCHEDULED", applicationPrice: 60000 } });
  groupId = `${run}-g-${groups.length}`; groups.push(groupId); token = randomUUID().replaceAll("-", "") + "synthetic";
  await db.reservationApplicationGroup.create({ data: { id: groupId, createdById: run, classes: { create: classes.map((classScheduleId) => ({ classScheduleId })) }, links: { create: { tokenHash: hashApplicationCapabilityToken(token), issuedById: run } } } });
}, 30000);
afterAll(async () => {
  await db.companionGroupMember.deleteMany({ where: { companionGroup: { groupId: { in: groups } } } });
  await db.companionInvite.deleteMany({ where: { groupId: { in: groups } } });
  await db.companionGroup.deleteMany({ where: { groupId: { in: groups } } });
  await db.deviceSubmission.deleteMany({ where: { submission: { groupId: { in: groups } } } });
  await db.reservationApplication.deleteMany({ where: { OR: [{ submission: { groupId: { in: groups } } }, { id: { in: legacyApplications } }] } });
  await db.reservationApplicationSubmission.deleteMany({ where: { groupId: { in: groups } } });
  await db.deviceChild.deleteMany({ where: { childId: { in: children } } });
  await db.applicationDevice.deleteMany({ where: { tokenHash: { in: devices } } });
  await db.child.deleteMany({ where: { id: { in: children } } });
  await db.reservationApplicationLink.deleteMany({ where: { OR: [{ groupId: { in: groups } }, { issuedById: run, classScheduleId: { in: classes } }] } });
  await db.reservationApplicationGroupClass.deleteMany({ where: { groupId: { in: groups } } });
  await db.reservationApplicationGroup.deleteMany({ where: { id: { in: groups } } });
  await db.classSchedule.deleteMany({ where: { id: { in: classes } } });
  await db.program.delete({ where: { id: run } }); await db.user.delete({ where: { id: run } });
  await db.$disconnect(); vi.unstubAllEnvs();
}, 30000);

describe.sequential("Policy A real PostgreSQL price recheck and atomic submission", () => {
  it("price review is read-only and returns only assigned in-scope prices", async () => {
    const before = await counts();
    expect((await review([classes[0]!])).prices).toEqual([{ classScheduleId: classes[0], amount: 40000 }]);
    expect(await counts()).toEqual(before); await noFinance();
  });
  it("review/current mismatch saves zero family records and preserves all input", async () => {
    const input = await submission((await review()).proof); const original = structuredClone(input.data);
    await db.classSchedule.update({ where: { id: classes[1]! }, data: { applicationPrice: 65000 } });
    await expect(submitApplicationGroupCore(db, input)).rejects.toBeInstanceOf(ApplicationPriceChangedError);
    expect(await counts()).toEqual([0, 0, 0]); expect(input.data).toEqual(original);
    // A price-recheck response never silently replaces the guardian-reviewed proof.
    await expect(submitApplicationGroupCore(db, input)).rejects.toBeInstanceOf(ApplicationPriceChangedError);
    expect(await counts()).toEqual([0, 0, 0]); await noFinance();
  });
  it("unreviewed and tampered amounts cannot be saved", async () => {
    const valid = await submission((await review()).proof);
    await expect(submitApplicationGroupCore(db, { ...valid, data: { ...valid.data, reviewedPriceProof: "" } })).rejects.toBeDefined();
    const [body, sig] = valid.data.reviewedPriceProof.split(".");
    const data = JSON.parse(Buffer.from(body!, "base64url").toString()); data.prices[0].amount = 1;
    await expect(submitApplicationGroupCore(db, { ...valid, data: { ...valid.data, reviewedPriceProof: `${Buffer.from(JSON.stringify(data)).toString("base64url")}.${sig}` } })).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(await counts()).toEqual([0, 0, 0]);
  });
  it("explicit reconfirmation still rejects a second price change; a separate resubmit saves current snapshots", async () => {
    const first = await review(); await db.classSchedule.update({ where: { id: classes[0]! }, data: { applicationPrice: 45000 } });
    let fresh = first;
    try { await submitApplicationGroupCore(db, await submission(first.proof)); } catch (error) { expect(error).toBeInstanceOf(ApplicationPriceChangedError); fresh = (error as ApplicationPriceChangedError).priceReview; }
    await db.classSchedule.update({ where: { id: classes[0]! }, data: { applicationPrice: 50000 } });
    await expect(submitApplicationGroupCore(db, await submission(fresh.proof))).rejects.toBeInstanceOf(ApplicationPriceChangedError);
    expect(await counts()).toEqual([0, 0, 0]);
    const final = await recheckApplicationGroupPricesCore(db, { token, classScheduleIds: classes, reviewedPriceProof: fresh.proof, now });
    expect(await counts()).toEqual([0, 0, 0]);
    const result = await submitApplicationGroupCore(db, await submission(final.proof));
    const amounts = await db.reservationApplication.findMany({ where: { submissionId: result.submissionId }, orderBy: { classScheduleId: "asc" }, select: { quotedAmount: true } });
    expect(amounts.map((row) => row.quotedAmount)).toEqual([50000, 60000]); await noFinance();
  });
  it("serializes a class-price update versus save without ever saving an unreviewed amount", async () => {
    const payload = await submission((await review()).proof);
    const results = await race("ClassSchedule", (client) => client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClassSchedule" WHERE "id" = ${classes[0]!} FOR UPDATE`;
      await tx.classSchedule.update({ where: { id: classes[0]! }, data: { applicationPrice: 65000 } });
    }), (client) => submitApplicationGroupCore(client, payload));
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ApplicationPriceChangedError);
    expect((await counts()).slice(0, 2)).toEqual([0, 0]);
    await noFinance();
  });
  it("rolls back the parent, device, and first sibling if the second write fails", async () => {
    const before = await counts();
    await expect(submitApplicationGroupCore(failSecondApplication(), await submission((await review()).proof))).rejects.toBeDefined();
    expect(await counts()).toEqual(before);
    expect(await db.applicationDevice.count({ where: { tokenHash: devices.at(-1)! } })).toBe(0); await noFinance();
  });
  it("double submission and a lost-response retry cannot create a second family", async () => {
    const payload = await submission((await review()).proof);
    const result = await Promise.allSettled([submitApplicationGroupCore(db, payload), submitApplicationGroupCore(db, payload)]);
    expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect((result.find((row) => row.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ApplicationAlreadySubmittedError);
    expect(await counts()).toEqual([1, 2, 0]);
    await expect(submitApplicationGroupCore(db, { ...payload, previousCompletionTokenHash: payload.completionTokenHash })).resolves.toMatchObject({ replayed: true });
    expect(await counts()).toEqual([1, 2, 0]);
  });
  it("link stop versus submit is atomic; stopped recheck never returns prices", async () => {
    const payload = await submission((await review()).proof);
    const results = await race("ReservationApplicationGroup", (client) => stopApplicationGroupCore(client, { groupId }), (client) => submitApplicationGroupCore(client, payload));
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect((await counts())[1]).toBe(0);
    await expect(review()).rejects.toBeInstanceOf(ApplicationClosedError);
  });
  it("link revocation versus submit rejects before family writes and hides subsequent prices", async () => {
    const payload = await submission((await review()).proof);
    const result = await race("ReservationApplicationGroup", (client) => client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ReservationApplicationGroup" WHERE "id" = ${groupId} FOR UPDATE`;
      await tx.reservationApplicationLink.updateMany({ where: { groupId }, data: { isActive: false } });
    }), (client) => submitApplicationGroupCore(client, payload));
    expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
    expect((await counts()).slice(0, 2)).toEqual([0, 0]); await expect(review()).rejects.toBeInstanceOf(ApplicationClosedError); await noFinance();
  });
  it("class cancellation versus submission cannot save a partial family", async () => {
    const payload = await submission((await review()).proof);
    const results = await race("ClassSchedule", (client) => client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClassSchedule" WHERE "id" = ${classes[1]!} FOR UPDATE`;
      await tx.classSchedule.update({ where: { id: classes[1]! }, data: { status: "CANCELLED" } });
    }), (client) => submitApplicationGroupCore(client, payload));
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect((await counts())[1]).toBe(0); await noFinance();
  });
  it("existing submitted quotes remain immutable after later class/default price changes", async () => {
    const saved = await submitApplicationGroupCore(db, await submission((await review()).proof));
    const before = await db.reservationApplication.findMany({ where: { submissionId: saved.submissionId }, orderBy: { id: "asc" } });
    await db.classSchedule.updateMany({ where: { id: { in: classes } }, data: { applicationPrice: 70000 } });
    await db.program.update({ where: { id: run }, data: { defaultPrice: 123456 } });
    expect(await db.reservationApplication.findMany({ where: { submissionId: saved.submissionId }, orderBy: { id: "asc" } })).toEqual(before); await noFinance();
  });
  it("another device cannot select an existing child by matching phone", async () => {
    const existing = await db.child.create({ data: { name: "합성 아이 0", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: "합성 보호자", guardianPhone: "010-0000-0000" } }); children.push(existing.id);
    const payload = await submission((await review()).proof);
    payload.data.children[0] = { ...payload.data.children[0]!, requestedChildId: existing.id } as typeof payload.data.children[0];
    await expect(submitApplicationGroupCore(db, payload)).rejects.toBeInstanceOf(ApplicationClosedError);
    expect((await counts()).slice(0, 2)).toEqual([0, 0]);
  });
  it("latest consent version is checked independently from signed prices", async () => {
    const payload = await submission((await review()).proof);
    await expect(submitApplicationGroupCore(db, { ...payload, data: { ...payload.data, consentVersion: "stale-version" } })).rejects.toBeInstanceOf(ApplicationClosedError);
    expect((await counts()).slice(0, 2)).toEqual([0, 0]);
  });
  it("own existing-child selection snapshots the verified profile without overwriting Child", async () => {
    const { existing, payload } = await ownedChild();
    const result = await submitApplicationGroupCore(db, payload);
    expect(await db.child.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing);
    expect(await db.reservationApplication.findFirstOrThrow({ where: { submissionId: result.submissionId, requestedChildId: existing.id } })).toMatchObject({ childName: existing.name, quotedAmount: 40000 });
    await noFinance();
  });
  it("device revocation racing repeat selection rejects the whole new family", async () => {
    const { device, payload } = await ownedChild(); const before = await counts();
    const result = await race("ApplicationDevice", (client) => client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ApplicationDevice" WHERE "id" = ${device.id} FOR UPDATE`;
      await tx.applicationDevice.update({ where: { id: device.id }, data: { revokedAt: now } });
    }), (client) => submitApplicationGroupCore(client, payload));
    expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
    expect(await counts()).toEqual(before); await noFinance();
  });
  it("a purge-state transition racing repeat selection cannot save stale child data", async () => {
    const { existing, payload } = await ownedChild(); const before = await counts();
    const result = await race("Child", (client) => client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Child" WHERE "id" = ${existing.id} FOR UPDATE`;
      await tx.child.update({ where: { id: existing.id }, data: { isActive: false, personalDataPurgedAt: now, personalDataPurgedById: run, name: "(파기됨)", birthDate: null, guardianName: null, guardianPhone: null, memo: null, gender: "UNSPECIFIED" } });
    }), (client) => submitApplicationGroupCore(client, payload));
    expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
    expect(await counts()).toEqual(before); await noFinance();
  });
  it("expired devices and inactive children cannot be reselected", async () => {
    const { existing, device, payload } = await ownedChild(); const before = await counts();
    await db.applicationDevice.update({ where: { id: device.id }, data: { expiresAt: new Date(now.getTime() - 1) } });
    await expect(submitApplicationGroupCore(db, payload)).rejects.toBeInstanceOf(ApplicationClosedError);
    await db.applicationDevice.update({ where: { id: device.id }, data: { expiresAt: later } });
    await db.child.update({ where: { id: existing.id }, data: { isActive: false } });
    await expect(submitApplicationGroupCore(db, payload)).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(await counts()).toEqual(before);
  });
  it("companion scope excludes removed classes and revoked invitation prices", async () => {
    const issuer = await db.reservationApplicationSubmission.create({ data: { groupId, guardianName: "초대 가족의 비공개 보호자" } });
    const companion = await db.companionGroup.create({ data: { groupId, issuerSubmissionId: issuer.id } });
    const companionToken = randomUUID().replaceAll("-", "") + "synthetic";
    const invite = await db.companionInvite.create({ data: { groupId, issuerSubmissionId: issuer.id, companionGroupId: companion.id, tokenHash: hashApplicationCapabilityToken(companionToken), expiresAt: later } });
    const result = await recheckApplicationGroupPricesCore(db, { companionToken, classScheduleIds: [classes[0]!], now });
    expect(result.prices).toEqual([{ classScheduleId: classes[0], amount: 40000 }]);
    expect(JSON.stringify(result)).not.toContain("초대 가족");
    const removedReview = await recheckApplicationGroupPricesCore(db, { companionToken, classScheduleIds: [classes[1]!], now });
    await db.reservationApplicationGroupClass.delete({ where: { groupId_classScheduleId: { groupId, classScheduleId: classes[1]! } } });
    await expect(recheckApplicationGroupPricesCore(db, { companionToken, classScheduleIds: [classes[1]!], now })).rejects.toBeInstanceOf(ApplicationClosedError);
    const input = await submission(result.proof, [classes[0]!]);
    const removedInput = await submission(removedReview.proof, [classes[1]!]);
    await expect(submitApplicationGroupCore(db, { ...removedInput, token: undefined, companionToken })).rejects.toBeInstanceOf(ApplicationClosedError);
    await expect(submitApplicationGroupCore(db, { ...input, token: undefined, companionToken, data: { ...input.data, children: [child(classes[1]!)] } })).rejects.toBeInstanceOf(ApplicationClosedError);
    expect((await counts())[1]).toBe(0);
    await db.companionInvite.update({ where: { id: invite.id }, data: { revokedAt: now } });
    await expect(submitApplicationGroupCore(db, { ...input, token: undefined, companionToken })).rejects.toBeInstanceOf(ApplicationClosedError);
    await expect(recheckApplicationGroupPricesCore(db, { companionToken, classScheduleIds: [classes[0]!], now })).rejects.toBeInstanceOf(ApplicationClosedError);
  });
  it("separate same-name/contact applications remain separate and never merge families", async () => {
    const a = await submitApplicationGroupCore(db, await submission((await review()).proof));
    const b = await submitApplicationGroupCore(db, await submission((await review()).proof));
    expect(a.submissionId).not.toBe(b.submissionId);
    expect((await counts()).slice(0, 2)).toEqual([2, 4]); await noFinance();
  });
  it("legacy Phase 18 keeps amount-free single applications with no modern parent or ledger", async () => {
    const legacyToken = randomUUID().replaceAll("-", "") + "synthetic";
    await db.classSchedule.update({ where: { id: classes[0]! }, data: { applicationPrice: null } });
    await db.reservationApplicationLink.create({ data: { token: legacyToken, classScheduleId: classes[0]!, issuedById: run } });
    const record = await submitReservationApplicationCore(db, {
      token: legacyToken,
      data: { ...child(classes[0]!), guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" },
      consentVersion: version, context: { now, configReady: true, consentReady: true, environmentAllowed: true },
    });
    legacyApplications.push(record.id);
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: record.id } })).toMatchObject({ submissionId: null, quotedAmount: null, consentVersion: version, photoShareConsentAgreed: false });
    expect((await counts()).slice(0, 2)).toEqual([0, 0]); await noFinance();
  });
});
