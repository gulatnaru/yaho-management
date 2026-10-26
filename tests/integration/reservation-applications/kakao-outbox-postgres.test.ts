import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { buildDedupeKey, type NotificationProvider } from "@/lib/kakao/notify";
import { buildOutboxInput, OutboxStaleClaimError } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { insertApplicationReceivedOutbox } from "@/lib/kakao/outbox-tx";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { recheckApplicationGroupPricesCore, submitApplicationGroupCore } from "@/server/reservation-applications/groups";
import { applicationReviewScope, ApplicationPriceChangedError, verifyApplicationPriceReview } from "@/server/reservation-applications/price-review";

// Preparation only in 2C-3R: execute later through the existing ephemeral-PG workflow.
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

/**
 * Keep the REAL adapter and generated delegates. The SQL candidate SELECT is
 * scoped to this test's entities because other integration files also enqueue.
 * All claims/recovery/completions still execute the adapter's original real
 * compare-and-set updateMany against PostgreSQL; there are no fake DB methods.
 */
function isolatedStore(client: PrismaClient, entityIds: string[]): PrismaOutboxStore {
  const scoped = client.$extends({ query: { notificationOutbox: {
    findMany({ args, query }) {
      return query({ ...args, where: { AND: [args.where ?? {}, { entityId: { in: entityIds } }] } });
    },
  } } });
  return new PrismaOutboxStore(scoped);
}

// Reuse price-recheck.test.ts's real group/link, schedules, signed review and
// completion/device capability fixture pattern. Every call gets its own link
// and review operation, so phase8_${operation} never collides across tests.
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
  const review = await recheckApplicationGroupPricesCore(db, { token, classScheduleIds: classIds, now });
  const operation = verifyApplicationPriceReview(review.proof, applicationReviewScope({ token }), now).operation;
  const submissionId = `phase8_${operation}`;
  submissions.push(submissionId);
  outboxEntities.push(submissionId);
  const deviceTokenHash = hashApplicationCapabilityToken(randomUUID());
  devices.push(deviceTokenHash);
  const input: Parameters<typeof submitApplicationGroupCore>[1] = {
    token, consentVersion: APPLICATION_CONSENT_CONTENT.version, now, configReady: true,
    completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: expiresAt,
    deviceTokenHash, deviceExpiresAt: expiresAt,
    data: {
      reviewedPriceProof: review.proof, consentVersion: APPLICATION_CONSENT_CONTENT.version,
      guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자",
      children: classIds.map((classScheduleId, i) => ({
        classScheduleId, childName: `합성 아이 ${i}`, childBirthDate: "2020-01-01", childGender: "UNSPECIFIED",
        programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
        photoShareConsent: false, photoMarketingConsent: false,
      })),
    },
  };
  return { groupId: id, classIds, submissionId, input };
}

beforeAll(async () => {
  vi.stubEnv("AUTH_SECRET", "synthetic-ephemeral-pg-kakao-review-secret");
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
    vi.unstubAllEnvs();
  }
}, 30000);

describe.sequential("Kakao outbox actual PostgreSQL integration (execution pending approval)", () => {
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
    expect(result).toMatchObject({ submissionId: f.submissionId });
    expect(result.replayed).not.toBe(true);
    expect(await db.reservationApplicationSubmission.findUnique({ where: { id: result.submissionId } })).toMatchObject({ groupId: f.groupId });
    expect(await db.reservationApplication.count({ where: { submissionId: result.submissionId } })).toBe(2);
    const rows = await db.notificationOutbox.findMany({ where: { entityId: result.submissionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKind: "application.received", entityId: result.submissionId, audience: "admin",
      dedupeKey: buildDedupeKey("application.received", result.submissionId, "created"), status: "pending", attemptCount: 0,
      occurredAt: now, providerId: null, providerRef: null,
    });
    const transactions = await db.$queryRaw<{ submission_xid: string; outbox_xid: string }[]>`
      SELECT s.xmin::text AS submission_xid, o.xmin::text AS outbox_xid
      FROM "ReservationApplicationSubmission" s
      JOIN "NotificationOutbox" o ON o."entityId" = s."id"
      WHERE s."id" = ${result.submissionId}
    `;
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.outbox_xid).toBe(transactions[0]!.submission_xid);
  }, 30000);

  it("4. a real core price failure leaves no submission, application or outbox", async () => {
    const f = await groupFixture();
    await db.classSchedule.update({ where: { id: f.classIds[0]! }, data: { applicationPrice: 45000 } });
    await expect(submitApplicationGroupCore(db, f.input)).rejects.toBeInstanceOf(ApplicationPriceChangedError);
    expect(await db.reservationApplicationSubmission.count({ where: { id: f.submissionId } })).toBe(0);
    expect(await db.reservationApplication.count({ where: { submissionId: f.submissionId } })).toBe(0);
    expect(await db.notificationOutbox.count({ where: { entityId: f.submissionId } })).toBe(0);
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

  it("6. completion-token replay returns the same submission with zero additional outbox rows", async () => {
    const f = await groupFixture();
    const first = await submitApplicationGroupCore(db, f.input);
    expect(await db.notificationOutbox.count({ where: { entityId: first.submissionId } })).toBe(1);
    const second = await submitApplicationGroupCore(db, { ...f.input, previousCompletionTokenHash: f.input.completionTokenHash });
    expect(second).toMatchObject({ submissionId: first.submissionId, applicationIds: [], replayed: true });
    expect(await db.reservationApplicationSubmission.count({ where: { id: first.submissionId } })).toBe(1);
    expect(await db.reservationApplication.count({ where: { submissionId: first.submissionId } })).toBe(2);
    expect(await db.notificationOutbox.count({ where: { entityId: first.submissionId } })).toBe(1);
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

  it("8. two real PrismaOutboxStore workers claim an exact disjoint partition", async () => {
    const inputs = Array.from({ length: 4 }, () => outboxInput());
    await db.notificationOutbox.createMany({ data: inputs });
    const entities = inputs.map((row) => row.entityId);
    const expected = await db.notificationOutbox.findMany({ where: { entityId: { in: entities } }, select: { id: true } });
    const a = new PrismaClient(), b = new PrismaClient();
    try {
      const [left, right] = await Promise.all([isolatedStore(a, entities).claimDue(4, now), isolatedStore(b, entities).claimDue(4, now)]);
      const ids = [...left, ...right].map((row) => row.id);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      expect([...ids].sort()).toEqual(expected.map((row) => row.id).sort());
      expect(left.every((row) => !right.some((other) => other.id === row.id))).toBe(true);
      const persisted = await db.notificationOutbox.findMany({ where: { entityId: { in: entities } } });
      expect(persisted.every((row) => row.status === "processing" && row.claimToken !== null)).toBe(true);
      expect(persisted.map((row) => [row.id, row.claimToken]).sort()).toEqual([...left, ...right].map((row) => [row.id, row.claimToken]).sort());
    } finally { await Promise.all([a.$disconnect(), b.$disconnect()]); }
  }, 30000);

  it("9. recovers only an expired lease to pending and makes it claimable again", async () => {
    const expired = outboxInput(), valid = outboxInput();
    const store = isolatedStore(db, [expired.entityId, valid.entityId]);
    await store.enqueue(expired); await store.enqueue(valid);
    const claims = await store.claimDue(2, now);
    expect(claims).toHaveLength(2);
    const expiredClaim = claims.find((row) => row.entityId === expired.entityId)!;
    const validClaim = claims.find((row) => row.entityId === valid.entityId)!;
    await db.notificationOutbox.update({ where: { id: expiredClaim.id }, data: { leaseExpiresAt: new Date(now.getTime() - 1) } });
    const recovered = await store.recoverStale(2, now);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id: expiredClaim.id, status: "pending", claimToken: null, leaseExpiresAt: null, attemptCount: 0 });
    expect(await db.notificationOutbox.findUnique({ where: { id: expiredClaim.id } })).toMatchObject({ status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: now });
    expect(await db.notificationOutbox.findUnique({ where: { id: validClaim.id } })).toMatchObject({ status: "processing", claimToken: validClaim.claimToken, leaseExpiresAt: validClaim.leaseExpiresAt });
    const reclaimed = await store.claimDue(2, now);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.id).toBe(expiredClaim.id);
    expect(reclaimed[0]!.claimToken).not.toBe(expiredClaim.claimToken);
  });

  it("10. rejects a stale completion token and unconfigured batches skip with zero provider calls", async () => {
    const input = outboxInput(), fresh = outboxInput();
    const store = isolatedStore(db, [input.entityId, fresh.entityId]);
    const row = (await store.enqueue(input)).row;
    const [old] = await store.claimDue(1, now);
    expect(old!.id).toBe(row.id);
    await db.notificationOutbox.update({ where: { id: row.id }, data: { leaseExpiresAt: new Date(now.getTime() - 1) } });
    expect(await store.recoverStale(1, now)).toHaveLength(1);
    const [current] = await store.claimDue(1, now);
    expect(current!.claimToken).not.toBe(old!.claimToken);
    await expect(store.markSent(row.id, old!.claimToken!)).rejects.toBeInstanceOf(OutboxStaleClaimError);
    expect(await db.notificationOutbox.findUnique({ where: { id: row.id } })).toMatchObject({ status: "processing", claimToken: current!.claimToken, attemptCount: 0 });
    await store.markSkipped(row.id, current!.claimToken!, "provider_unconfigured");
    await store.enqueue(fresh);
    const send = vi.fn<NotificationProvider["send"]>(async () => ({ status: "sent" }));
    const result = await processOutboxBatch(store, { provider: { send }, isProviderConfigured: false, now, limit: 2 });
    expect(result.error).toBeUndefined();
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ status: "skipped", reason: "provider_unconfigured" });
    expect(send).toHaveBeenCalledTimes(0);
    const persisted = await db.notificationOutbox.findMany({ where: { entityId: { in: [input.entityId, fresh.entityId] } } });
    expect(persisted).toHaveLength(2);
    expect(persisted.every((saved) => saved.status === "skipped" && saved.lastErrorCode === "provider_unconfigured" && saved.attemptCount === 0)).toBe(true);
  });

  it("RLS catalogs show NOLOGIN anon/authenticated and no access policy or table privileges", async () => {
    // prepare-e2e-db.ts intentionally creates NOLOGIN roles. A live connection
    // as anon/authenticated is impossible by design; inspect catalogs instead.
    const roles = await db.$queryRaw<{ rolname: string; rolcanlogin: boolean }[]>`
      SELECT rolname::text, rolcanlogin FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname
    `;
    expect(roles).toEqual([{ rolname: "anon", rolcanlogin: false }, { rolname: "authenticated", rolcanlogin: false }]);
    const tables = await db.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT c.relrowsecurity FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'NotificationOutbox'
    `;
    expect(tables).toEqual([{ relrowsecurity: true }]);
    const policies = await db.$queryRaw<{ policyname: string }[]>`
      SELECT policyname::text FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'NotificationOutbox'
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    `;
    expect(policies).toEqual([]);
    const privileges = await db.$queryRaw<{ rolname: string; has_access: boolean }[]>`
      SELECT rolname::text, has_table_privilege(rolname, 'public."NotificationOutbox"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS has_access
      FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname
    `;
    expect(privileges).toEqual([{ rolname: "anon", has_access: false }, { rolname: "authenticated", has_access: false }]);
  });
});
