import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { ensureBootstrapAdmin } from "../../../server/accounts/bootstrap";
import { createAccountCore } from "../../../server/accounts/mutations";
import { APPLICATION_CONSENT_CONTENT } from "../../../lib/reservation-applications/consent-content";
import { generateApplicationLinkToken, generateApplicationCapabilityToken, hashApplicationCapabilityToken } from "../../../lib/reservation-applications/token";
import { assertSafeE2eDatabaseUrls } from "./db-safety";
import { runtimePath, uxProjectSchema, type UxManifest } from "./ux-manifest";

/** Fixture-only writes. No business action being tested is performed here. */
export async function seedUxFixtures(projectInput: string, manifestPath: string) {
  assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
  const project = uxProjectSchema.parse(projectInput);
  const output = runtimePath(manifestPath);
  const db = new PrismaClient();
  const run = randomUUID();
  const shortRun = run.slice(0, 12);
  const prefix = `ux-${run}`;
  const password = () => `Synthetic-${randomBytes(24).toString("hex")}!`;
  try {
    // Dedicated fresh service only: never wipe or reuse another run's records.
    if (await db.user.count() || await db.program.count() || await db.reservationApplicationSettings.count()) throw new Error("UX_SEED_REQUIRES_FRESH_DISPOSABLE_DATABASE");
    const accounts: UxManifest["accounts"] = (["ADMIN", "MANAGER", "TEACHER"] as const).map((role) => ({ role, email: `${role.toLowerCase()}-${run}@example.test`, password: password(), finalPassword: password() }));
    const adminAccount = accounts[0];
    if (!(await ensureBootstrapAdmin(db, adminAccount)).created) throw new Error("UX_BOOTSTRAP_NOT_CREATED");
    const admin = await db.user.findUniqueOrThrow({ where: { email: adminAccount.email } });
    const principal = { userId: admin.id, role: "ADMIN" as const, teacherId: null, name: admin.name, email: admin.email, authVersion: admin.authVersion, mustChangePassword: false };
    const teacher = await db.teacher.create({ data: { name: `UX_SYNTHETIC_${run}` } });
    for (const account of accounts.slice(1)) {
      await createAccountCore(principal, { name: `UX_SYNTHETIC_${account.role}`, email: account.email, role: account.role, teacherId: account.role === "TEACHER" ? teacher.id : null, isActive: true, passwordHash: await hash(account.password, 12) }, db);
    }
    // Admin bootstrap has no forced change. Runtime login uses its actual password.
    adminAccount.finalPassword = adminAccount.password;
    const program = await db.program.create({ data: { name: `UX_SYNTHETIC_${run}`, defaultPrice: 99000 } });
    const startsAt = new Date(Date.now() + 30 * 86400000);
    const endsAt = new Date(startsAt.getTime() + 3600000);
    async function schedule(id: string, options: { applicationPrice?: number | null; past?: boolean; cancelled?: boolean; capacity?: number; programId?: string } = {}) {
      return db.classSchedule.create({ data: { id, programId: options.programId ?? program.id, startsAt: options.past ? new Date(Date.now() - 86400000) : startsAt, endsAt: options.past ? new Date(Date.now() - 82800000) : endsAt, location: "합성 테스트 장소", applicationPrice: options.applicationPrice === undefined ? 40000 : options.applicationPrice, capacity: options.capacity ?? 8, status: options.cancelled ? "CANCELLED" : "SCHEDULED", ...(options.cancelled ? { cancelledAt: new Date(), cancelledById: admin.id, cancelReason: "OTHER" as const, cancelDetail: "합성 취소" } : {}) } });
    }
    async function group(classIds: string[], active = true) {
      const row = await db.reservationApplicationGroup.create({ data: { createdById: admin.id, syntheticRunId: prefix, isActive: active, classes: { create: classIds.map((classScheduleId) => ({ classScheduleId })) } } });
      await db.reservationApplicationLink.create({ data: { groupId: row.id, tokenHash: hashApplicationCapabilityToken(generateApplicationCapabilityToken()), isActive: active, issuedById: admin.id } });
      return row;
    }
    const classes: Record<string, string> = {};
    for (const key of ["noLink", "hash", "legacy", "groups", "stopped", "cancelled", "past", "teacherAssigned"]) {
      classes[key] = `${prefix}-${key}`;
      await schedule(classes[key], { past: key === "past", cancelled: key === "cancelled" });
    }
    await group([classes.hash]); await group([classes.groups]); await group([classes.groups, classes.hash]);
    await group([classes.stopped], false);
    await db.reservationApplicationLink.create({ data: { classScheduleId: classes.legacy, token: generateApplicationLinkToken(), issuedById: admin.id } });
    await db.classTeacher.create({ data: { classScheduleId: classes.teacherAssigned, teacherId: teacher.id } });
    const phase2Prefix = `ux2-${run}`;
    await schedule(`${phase2Prefix}-price`, { applicationPrice: null });
    await schedule(`${phase2Prefix}-additional`);
    const applicationData = (classScheduleId: string, amount: number, childName: string) => ({ classScheduleId, quotedAmount: amount, childName, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED" as const, requestNote: `UX_SYNTHETIC_REQUEST_${run}`, programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version });
    async function family(marker: string, deposited = false, full = false) {
      const ownProgram = await db.program.create({ data: { name: marker } });
      const ids = [0, 1].map((i) => `${prefix}-${randomUUID()}-${i}`);
      await schedule(ids[0], { programId: ownProgram.id, capacity: full ? 1 : 8 });
      await schedule(ids[1], { programId: ownProgram.id, applicationPrice: 60000 });
      const ownGroup = await group(ids);
      const submission = await db.reservationApplicationSubmission.create({ data: { groupId: ownGroup.id, guardianName: marker, guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금신고자", applications: { create: [applicationData(ids[0], 40000, "합성첫째"), applicationData(ids[1], 60000, "합성둘째")] } }, include: { applications: { orderBy: { quotedAmount: "asc" } } } });
      if (deposited) await db.applicationDeposit.create({ data: { submissionId: submission.id, amount: 100000, payerName: "합성 실제입금자", depositedAt: new Date(), confirmedAt: new Date(), confirmedById: admin.id } });
      if (full) {
        const child = await db.child.create({ data: { name: `UX_SYNTHETIC_OCCUPANT_${run}` } });
        await db.reservation.create({ data: { childId: child.id, classScheduleId: ids[0] } });
      }
      return { submissionId: submission.id, firstApplicationId: submission.applications[0].id, secondApplicationId: submission.applications[1].id, marker, classScheduleId: ids[0] };
    }
    const ledger: Record<string, Awaited<ReturnType<typeof family>>> = {};
    for (const key of ["360", "390", "1280", "loss", "refresh", "cancel"]) ledger[key] = await family(`UX5_SYNTHETIC_${shortRun}_${key}`);
    const confirmation: Record<string, Awaited<ReturnType<typeof family>> & { existingChildId?: string; foreignChildId?: string }> = {};
    for (const key of ["360", "390", "1280", "loss", "overbooking", "existing", "foreign"]) confirmation[key] = await family(`UX6_SYNTHETIC_${shortRun}_${key}`, true, key === "overbooking");
    const existingChild = await db.child.create({ data: { name: "합성첫째", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: confirmation.existing.marker, guardianPhone: "010-0000-0000" } });
    confirmation.existing.existingChildId = existingChild.id;
    const foreignChild = await db.child.create({ data: { name: "합성첫째", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: "UX_SYNTHETIC_FOREIGN_FAMILY", guardianPhone: "010-9999-9999" } });
    confirmation.foreign.foreignChildId = foreignChild.id;
    const detail = await family(`UX4_SYNTHETIC_${shortRun}`, true);
    // A confirmed sibling provides related-record history while the first child
    // remains unconfirmed for review/selection context assertions.
    const detailSecond = await db.reservationApplication.findUniqueOrThrow({ where: { id: detail.secondApplicationId } });
    const child = await db.child.create({ data: { name: "합성둘째", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: detail.marker, guardianPhone: "010-0000-0000" } });
    const memo = `UX_SYNTHETIC_RESERVATION_MEMO_${run}`;
    const reservation = await db.reservation.create({ data: { childId: child.id, classScheduleId: detailSecond.classScheduleId, memo } });
    const payment = await db.payment.create({ data: { method: "TRANSFER", totalAmount: 60000, items: { create: { reservationId: reservation.id, amount: 60000, paidAmount: 60000 } } }, include: { items: true } });
    const mapping = await db.reservationApplicationPaymentMapping.create({ data: { applicationId: detail.secondApplicationId, paymentItemId: payment.items[0].id } });
    const detailDeposit = await db.applicationDeposit.findFirstOrThrow({ where: { submissionId: detail.submissionId } });
    await db.fundAllocation.create({ data: { depositId: detailDeposit.id, paymentMappingId: mapping.id, amount: 60000 } });
    await db.reservationApplication.update({ where: { id: detail.secondApplicationId }, data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedById: admin.id, childId: child.id, reservationId: reservation.id } });
    await db.childConsent.create({ data: { childId: child.id, consentType: "PRIVACY", action: "AGREED", recordedById: admin.id, reservationApplicationId: detail.secondApplicationId, consentVersion: APPLICATION_CONSENT_CONTENT.version } });
    const unknown = await family(`UX4_UNKNOWN_SYNTHETIC_${shortRun}`);
    await db.reservationApplication.updateMany({ where: { submissionId: unknown.submissionId }, data: { consentVersion: "UX_SYNTHETIC_UNKNOWN_VERSION" } });
    const purged = await family(`UX4_PURGED_SYNTHETIC_${shortRun}`);
    await db.reservationApplication.updateMany({ where: { submissionId: purged.submissionId }, data: { status: "REJECTED", resolvedAt: new Date(), resolvedById: admin.id, personalDataPurgedAt: new Date(), personalDataPurgedById: admin.id, childName: null, childBirthDate: null, childGender: null, requestNote: null, resolutionNote: null } });
    await db.reservationApplicationSubmission.update({ where: { id: purged.submissionId }, data: { personalDataPurgedAt: new Date(), guardianName: null, guardianPhone: null, guardianRelationship: null, declaredPayerName: null } });
    const invalid = await family(`UX4_INVALID_SYNTHETIC_${shortRun}`, true);
    const invalidDeposit = await db.applicationDeposit.findFirstOrThrow({ where: { submissionId: invalid.submissionId } });
    const obligation = await db.returnObligation.create({ data: { submissionId: invalid.submissionId, kind: "EXCESS", amount: 100001 } });
    // Deliberately inconsistent aggregate, not a schema violation: verifies safe
    // read behavior when allocation totals exceed their actual deposit source.
    await db.fundAllocation.create({ data: { depositId: invalidDeposit.id, returnObligationId: obligation.id, amount: 100001 } });
    const pending = await db.reservationApplication.findMany({ where: { status: "SUBMITTED" }, select: { id: true, submissionId: true } });
    const pendingFamilies = new Set(pending.map((row) => row.submissionId ?? row.id)).size;
    const stateRoot = dirname(output);
    const environment: Record<string, string> = {
      UX_READ_ONLY_CLASS_FIXTURES: JSON.stringify(classes),
      UX_PHASE2_CLASS_FIXTURES: JSON.stringify({ ownerPrefix: phase2Prefix, priceClass: `${phase2Prefix}-price`, additionalClass: `${phase2Prefix}-additional` }),
      UX_FAMILY_LIST_FIXTURES: JSON.stringify({ classScheduleId: detail.classScheduleId, familyId: detail.submissionId, kind: "submission", page: 1, globalPendingFamilies: pendingFamilies, privateSentinels: [`UX_SYNTHETIC_REQUEST_${run}`, memo], emptyClassId: classes.noLink }),
      UX_FAMILY_DETAIL_FIXTURES: JSON.stringify({ submissionId: detail.submissionId, applicationId: detail.firstApplicationId, foreignApplicationId: unknown.firstApplicationId, classScheduleId: detail.classScheduleId, page: 1, originalRequestSentinel: `UX_SYNTHETIC_REQUEST_${run}`, reservationMemoSentinel: memo, actualReservationId: reservation.id, actualPaymentId: payment.id, purgedSubmissionId: purged.submissionId, unknownConsentSubmissionId: unknown.submissionId, invalidLedgerSubmissionId: invalid.submissionId }),
      UX_LEDGER_FIXTURES: JSON.stringify(ledger), UX_CONFIRMATION_FIXTURES: JSON.stringify(confirmation),
      E2E_UX_PROGRAM_ID: program.id, E2E_UX_ADMIN_ID: admin.id,
      UX_ADMIN_EMAIL: adminAccount.email, UX_ADMIN_PASSWORD: adminAccount.password,
      ...Object.fromEntries(accounts.map((account) => [`UX_${account.role}_STORAGE_STATE`, `${stateRoot}/${account.role.toLowerCase()}-storage-state.json`])),
    };
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await writeFile(output, JSON.stringify({ project, environment, accounts } satisfies UxManifest), { mode: 0o600, flag: "wx" });
    console.log("UX synthetic fixture manifest prepared (runtime only).");
  } finally { await db.$disconnect(); }
}
