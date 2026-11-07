import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { buildDedupeKey } from "@/lib/kakao/notify";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { insertApplicationReceivedOutbox } from "@/lib/kakao/outbox-tx";
import { submitApplicationGroupCore } from "@/server/reservation-applications/groups";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";

// Adapted from the kakao worktree's kakao-outbox-postgres.test.ts (cases 1-7
// only). The kakao original depends on price-review (recheck/verify/review
// scope) and the dispatch-side store/worker, which do not exist on the admin
// branch, so the fixture and the price/replay cases are rewritten against the
// admin core:
// - Case 4: the admin core has no price recheck, so the real failure is a
//   removed applicationPrice (null) -> ApplicationClosedError.
// - Case 6: the admin core has no completion-token replay contract (no
//   previousCompletionTokenHash / `replayed` return), so a second submit with
//   a fresh completion token creates a new submission with its own outbox row.
//   Per-submission dedupe is covered by case 2 and the unit tests instead.
// Cases 8-10 (dispatch-side store/worker claim, lease recovery, batch guard)
// are excluded: no dispatcher is ported in this integration.
// No URL defaults, remote fallbacks, singleton client, provider credentials or real sends.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `kakao-pg-${randomUUID()}`;
const now = new Date("2030-01-01T00:00:00.000Z");
const expiresAt = new Date(now.getTime() + 86_400_000);
const groups: string[] = [], classes: string[] = [], submissions: string[] = [], devices: string[] = [], outboxEntities: string[] = [];

function ownEntity(): string {
  const id = `phase8_${randomUUID()}`;
  outboxEntities.push(id);
  return id;
}

function outboxInput(entityId = ownEntity()) {
  return buildOutboxInput("application.received", entityId, "created", "admin", now);
}

// Admin core fixture: real group/link/classes, no price-review. The submission
// id is a server-generated cuid, so it is only known after submit returns.
async function groupFixture() {
  const id = `${run}-g-${randomUUID()}`;
  groups.push(id);
  const classIds = [0, 1].map((i) => `${id}-c${i}`);
  classes.push(...classIds);
  await db.classSchedule.createMany({ data: classIds.map((classId, i) => ({
    id: classId, programId: run, status: "SCHEDULED", capacity: 8,
    startsAt: new Date("2040-01-01T00:00:00.000Z"), endsAt: new Date("2040-01-01T01:00:00.000Z"),
    location: "합성 장소", applicationPrice: i === 0 ? 40000 : 60000,
  })) });
  const token = `${randomUUID().replaceAll("-", "")}synthetic`;
  await db.reservationApplicationGroup.create({ data: {
    id, createdById: run,
    classes: { create: classIds.map((classScheduleId) => ({ classScheduleId })) },
    links: { create: { tokenHash: hashApplicationCapabilityToken(token), issuedById: run } },
  } });
  const deviceTokenHash = hashApplicationCapabilityToken(randomUUID());
  devices.push(deviceTokenHash);
  const input: Parameters<typeof submitApplicationGroupCore>[1] = {
    token, consentVersion: "v1", now, configReady: true,
    completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: expiresAt,
    deviceTokenHash, deviceExpiresAt: expiresAt,
    data: {
      guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자",
      children: classIds.map((classScheduleId, i) => ({
        classScheduleId, childName: `합성 아이 ${i}`, childBirthDate: "2020-01-01", childGender: "UNSPECIFIED",
        programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
        photoShareConsent: false, photoMarketingConsent: false,
      })),
    },
  };
  return { groupId: id, classIds, input };
}

function trackSubmission(submissionId: string) {
  submissions.push(submissionId);
  outboxEntities.push(submissionId);
}

beforeAll(async () => {
  await db.user.create({ data: { id: run, email: `${run}@example.test`, name: "합성 관리자", role: "ADMIN" } });
  await db.program.create({ data: { id: run, name: "합성 카카오 프로그램", defaultPrice: 999999 } });
}, 30000);

afterAll(async () => {
  try {
    // Only this file's explicit synthetic identities, including failed operations.
    await db.notificationOutbox.deleteMany({ where: { entityId: { in: outboxEntities } } });
    await db.deviceSubmission.deleteMany({ where: { submissionId: { in: submissions } } });
    await db.reservationApplication.deleteMany({ where: { submissionId: { in: submissions } } });
    await db.reservationApplicationSubmission.deleteMany({ where: { id: { in: submissions } } });
    await db.applicationDevice.deleteMany({ where: { tokenHash: { in: devices } } });
    await db.reservationApplicationLink.deleteMany({ where: { groupId: { in: groups } } });
    await db.reservationApplicationGroupClass.deleteMany({ where: { groupId: { in: groups } } });
    await db.reservationApplicationGroup.deleteMany({ where: { id: { in: groups } } });
    await db.classSchedule.deleteMany({ where: { id: { in: classes } } });
    await db.program.deleteMany({ where: { id: run } });
    await db.user.deleteMany({ where: { id: run } });
  } finally {
    await db.$disconnect();
  }
}, 30000);

describe.sequential("Kakao outbox actual PostgreSQL integration (admin core)", () => {
  it("1. asserts the migrated table, enum, unique/polling/recovery indexes and RLS catalogs", async () => {
    const tables = await db.$queryRaw<{ relkind: string; relrowsecurity: boolean }[]>`
      SELECT c.relkind::text, c.relrowsecurity FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'NotificationOutbox'
    `;
    expect(tables).toEqual([{ relkind: "r", relrowsecurity: true }]);
    const labels = await db.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel::text FROM pg_catalog.pg_enum e
      JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'NotificationOutboxStatus'
      ORDER BY e.enumsortorder
    `;
    expect(labels.map((row) => row.enumlabel)).toEqual(["pending", "processing", "sent", "skipped", "failed"]);
    const indexes = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname::text, indexdef::text FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public' AND tablename = 'NotificationOutbox'
    `;
    expect(indexes.find((row) => row.indexname === "NotificationOutbox_dedupeKey_key")?.indexdef).toMatch(/CREATE UNIQUE INDEX .*\("dedupeKey"\)/);
    expect(indexes.find((row) => row.indexname === "NotificationOutbox_status_nextRetryAt_idx")?.indexdef).toContain('(status, "nextRetryAt")');
    expect(indexes.find((row) => row.indexname === "NotificationOutbox_status_leaseExpiresAt_idx")?.indexdef).toContain('(status, "leaseExpiresAt")');
  });

  it("2. uses generated-client CRUD and the real raw SELECT/INSERT helper in a transaction", async () => {
    const direct = outboxInput(), raw = outboxInput();
    await db.$transaction(async (tx) => {
      const row = await tx.notificationOutbox.create({ data: direct });
      expect(await tx.notificationOutbox.findUnique({ where: { dedupeKey: direct.dedupeKey } })).toMatchObject({ id: row.id, status: "pending" });
      expect(await tx.notificationOutbox.update({ where: { id: row.id }, data: { status: "skipped" } })).toMatchObject({ status: "skipped" });
      await tx.notificationOutbox.delete({ where: { id: row.id } });
      expect(await tx.notificationOutbox.findUnique({ where: { id: row.id } })).toBeNull();
      expect(await insertApplicationReceivedOutbox(tx, { submissionId: raw.entityId, now })).toEqual({ inserted: true });
      expect(await insertApplicationReceivedOutbox(tx, { submissionId: raw.entityId, now })).toEqual({ inserted: false });
      expect(await tx.notificationOutbox.findUnique({ where: { dedupeKey: raw.dedupeKey } })).toMatchObject({ entityId: raw.entityId, status: "pending" });
    });
    expect(await db.notificationOutbox.count({ where: { dedupeKey: raw.dedupeKey } })).toBe(1);
  });

  it("3. commits real group-submit applications and their pending outbox together", async () => {
    const f = await groupFixture();
    const result = await submitApplicationGroupCore(db, f.input);
    trackSubmission(result.submissionId);
    expect(result).toMatchObject({ submissionId: expect.any(String) });
    expect(await db.reservationApplicationSubmission.findUnique({ where: { id: result.submissionId } })).toMatchObject({ groupId: f.groupId });
    expect(await db.reservationApplication.count({ where: { submissionId: result.submissionId } })).toBe(2);
    const rows = await db.notificationOutbox.findMany({ where: { entityId: result.submissionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKind: "application.received", entityId: result.submissionId, audience: "admin",
      dedupeKey: buildDedupeKey("application.received", result.submissionId, "created"), status: "pending", attemptCount: 0,
      providerId: null, providerRef: null,
    });
    // occurredAt is stored in a timestamp-without-timezone column, so a plain
    // Prisma read round-trips through the database session timezone and the
    // Node process timezone. Compare the absolute instant instead: interpret
    // the stored wall clock in the session timezone and check it equals `now`.
    const [instant] = await db.$queryRaw<{ occurredAt: Date }[]>`
      SELECT ("occurredAt" AT TIME ZONE current_setting('TIMEZONE')) AS "occurredAt"
      FROM "NotificationOutbox" WHERE "entityId" = ${result.submissionId}
    `;
    expect(instant!.occurredAt.getTime()).toBe(now.getTime());
    const transactions = await db.$queryRaw<{ submission_xid: string; outbox_xid: string }[]>`
      SELECT s.xmin::text AS submission_xid, o.xmin::text AS outbox_xid
      FROM "ReservationApplicationSubmission" s
      JOIN "NotificationOutbox" o ON o."entityId" = s."id"
      WHERE s."id" = ${result.submissionId}
    `;
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.outbox_xid).toBe(transactions[0]!.submission_xid);
  }, 30000);

  it("4. a real core failure (removed price) leaves no submission, application or outbox", async () => {
    const f = await groupFixture();
    const outboxBefore = await db.notificationOutbox.count();
    await db.classSchedule.update({ where: { id: f.classIds[0]! }, data: { applicationPrice: null } });
    await expect(submitApplicationGroupCore(db, f.input)).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(await db.reservationApplicationSubmission.count({ where: { groupId: f.groupId } })).toBe(0);
    // The failed submit has no submission id to scope by; the outbox total
    // must be unchanged instead (earlier cases' committed rows stay).
    expect(await db.notificationOutbox.count()).toBe(outboxBefore);
  }, 30000);

  it("5. an intentionally invalid outbox INSERT rolls back the real submission transaction", async () => {
    const input = outboxInput();
    submissions.push(input.entityId);
    let submissionWasVisibleInsideTransaction = false;
    // The helper's valid SQL has no natural failure trigger. This deliberate
    // invalid enum cast proves PostgreSQL transaction coupling, not a natural
    // helper failure or a mocked core failure. The schema is never modified.
    await expect(db.$transaction(async (tx) => {
      await tx.reservationApplicationSubmission.create({ data: { id: input.entityId, guardianName: "합성 보호자" } });
      submissionWasVisibleInsideTransaction = await tx.reservationApplicationSubmission.count({ where: { id: input.entityId } }) === 1;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "NotificationOutbox" ("id", "eventKind", "entityId", "dedupeKey", "audience", "occurredAt", "status", "updatedAt")
        VALUES (${randomUUID()}, ${input.eventKind}, ${input.entityId}, ${input.dedupeKey}, ${input.audience}, ${now}, ${"synthetic_invalid_status"}::"NotificationOutboxStatus", ${now})
      `);
    })).rejects.toMatchObject({ code: "P2010", meta: { code: "22P02" } });
    expect(submissionWasVisibleInsideTransaction).toBe(true);
    expect(await db.reservationApplicationSubmission.count({ where: { id: input.entityId } })).toBe(0);
    expect(await db.notificationOutbox.count({ where: { dedupeKey: input.dedupeKey } })).toBe(0);
  });

  it("6. a second submit with a fresh completion token creates a new submission with its own outbox row", async () => {
    // The admin core has no completion-token replay contract (no
    // previousCompletionTokenHash input, no `replayed` return), so the kakao
    // replay case does not apply here. What must hold instead: every
    // submission gets exactly one outbox row, and a second submit does not
    // collide with or reuse the first submission's row.
    const f = await groupFixture();
    const first = await submitApplicationGroupCore(db, f.input);
    trackSubmission(first.submissionId);
    expect(await db.notificationOutbox.count({ where: { entityId: first.submissionId } })).toBe(1);
    const secondDeviceTokenHash = hashApplicationCapabilityToken(randomUUID());
    devices.push(secondDeviceTokenHash);
    const second = await submitApplicationGroupCore(db, {
      ...f.input,
      completionTokenHash: hashApplicationCapabilityToken(randomUUID()),
      completionExpiresAt: expiresAt,
      deviceTokenHash: secondDeviceTokenHash,
      deviceExpiresAt: expiresAt,
    });
    trackSubmission(second.submissionId);
    expect(second.submissionId).not.toBe(first.submissionId);
    expect(await db.reservationApplicationSubmission.count({ where: { groupId: f.groupId } })).toBe(2);
    expect(await db.notificationOutbox.count({ where: { entityId: first.submissionId } })).toBe(1);
    expect(await db.notificationOutbox.count({ where: { entityId: second.submissionId } })).toBe(1);
  }, 30000);

  it("7. concurrent transactions with one dedupeKey yield exactly one row and one unique violation", async () => {
    const input = outboxInput();
    const a = new PrismaClient(), b = new PrismaClient();
    let entered = 0;
    let release!: () => void;
    const bothTransactionsStarted = new Promise<void>((resolve) => { release = resolve; });
    const insert = (client: PrismaClient) => client.$transaction(async (tx) => {
      if (++entered === 2) release();
      await bothTransactionsStarted;
      return tx.notificationOutbox.create({ data: input });
    }, { maxWait: 10000, timeout: 20000 });
    try {
      const results = await Promise.allSettled([insert(a), insert(b)]);
      expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
      const failures = results.filter((row): row is PromiseRejectedResult => row.status === "rejected");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.reason).toMatchObject({ code: "P2002" });
      expect(await db.notificationOutbox.count({ where: { dedupeKey: input.dedupeKey } })).toBe(1);
    } finally { await Promise.all([a.$disconnect(), b.$disconnect()]); }
  }, 30000);
});
