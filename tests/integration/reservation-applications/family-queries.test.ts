import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: async () => ({ role: "ADMIN" }) }));
import { countPendingApplicationFamilies, familyKeysSql, listApplicationFamilies } from "@/lib/reservation-applications/family-queries";
import { parseFamilyFilters } from "@/lib/reservation-applications/navigation";
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient(); const concurrent = new PrismaClient(); context.db = db;
const run = `ux3-${crypto.randomUUID()}`;
const classIds = [0, 1, 2].map((n) => `${run}-class-${n}`);
const submissionIds = Array.from({ length: 23 }, (_, n) => `${run}-s-${String(n).padStart(2, "0")}`);
const starts = new Date("2040-01-01T01:00:00Z"); const submitted = new Date("2039-01-01T00:00:00Z");
const application = { childName: "합성 아이", childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED" as const, programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: "synthetic-v1", requestNote: "PRIVATE_SYNTHETIC_NOTE", submittedAt: submitted };
const scope = { classScheduleId: classIds[0]!, status: "all" };
beforeAll(async () => {
  await db.user.create({ data: { id: run, email: `${run}@example.test`, role: "ADMIN", name: "합성 관리자" } });
  await db.program.create({ data: { id: run, name: "합성 프로그램", defaultPrice: 999999 } });
  await db.classSchedule.createMany({ data: classIds.map((id, index) => ({ id, programId: run, startsAt: index === 2 ? new Date("2000-01-01") : starts, endsAt: new Date(starts.getTime() + 3600000), location: "합성 장소", status: index === 2 ? "CANCELLED" : "SCHEDULED", capacity: 8 })) });
  for (const [index, id] of submissionIds.entries()) {
    await db.reservationApplicationSubmission.create({ data: { id, guardianName: "동일 합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자", submittedAt: submitted, depositNotifiedAt: index === 0 ? submitted : null } });
    await db.reservationApplication.create({ data: { ...application, id: `${id}-a`, submissionId: id, classScheduleId: classIds[0]!, quotedAmount: 10000 } });
  }
  // Boundary family 20 has an extra sibling outside the active class filter.
  await db.reservationApplication.create({ data: { ...application, id: `${submissionIds[17]}-b`, submissionId: submissionIds[17]!, classScheduleId: classIds[1]!, quotedAmount: 20000 } });
  // A cross-child class/status combination must never qualify the family.
  await db.reservationApplication.create({ data: { ...application, id: `${submissionIds[0]}-b`, submissionId: submissionIds[0]!, classScheduleId: classIds[1]!, quotedAmount: 20000, status: "REJECTED", resolvedAt: submitted, resolvedById: run, resolutionNote: "합성 반려" } });
  await db.reservationApplication.create({ data: { ...application, id: `${run}-cancelled`, submissionId: submissionIds[1]!, classScheduleId: classIds[2]!, quotedAmount: 10000 } });
  await db.reservationApplication.createMany({ data: [0, 1].map((n) => ({ ...application, id: `${run}-legacy-${n}`, classScheduleId: classIds[0]!, guardianName: "동일 합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" as const })) });
  for (const n of [0, 1]) {
    const depositId = `${run}-d-${n}`; const obligationId = `${run}-o-${n}`;
    await db.applicationDeposit.create({ data: { id: depositId, submissionId: submissionIds[0]!, amount: 15000, payerName: "합성 입금자", depositedAt: submitted, confirmedAt: submitted, confirmedById: run } });
    await db.returnObligation.create({ data: { id: obligationId, submissionId: submissionIds[0]!, kind: "EXCESS", amount: 5000, returnedAmount: n === 0 ? 2000 : 0 } });
    await db.fundAllocation.create({ data: { depositId, returnObligationId: obligationId, amount: 5000 } });
    if (n === 0) await db.applicationReturn.create({ data: { returnObligationId: obligationId, amount: 2000, returnedAt: submitted, processedById: run, reason: "합성 반환" } });
  }
}, 30000);
afterAll(async () => {
  // Owned synthetic scope only; never reset or delete shared fixtures.
  await db.fundAllocation.deleteMany({ where: { deposit: { submissionId: { in: submissionIds } } } });
  await db.applicationReturn.deleteMany({ where: { returnObligation: { submissionId: { in: submissionIds } } } });
  await db.returnObligation.deleteMany({ where: { submissionId: { in: submissionIds } } });
  await db.applicationDeposit.deleteMany({ where: { submissionId: { in: submissionIds } } });
  await db.reservationApplication.deleteMany({ where: { classScheduleId: { in: classIds } } });
  await db.reservationApplicationSubmission.deleteMany({ where: { id: { in: submissionIds } } });
  await db.classSchedule.deleteMany({ where: { id: { in: classIds } } }); await db.program.deleteMany({ where: { id: run } }); await db.user.deleteMany({ where: { id: run } });
  await Promise.all([db.$disconnect(), concurrent.$disconnect()]);
}, 30000);

describe.sequential("real PostgreSQL family union/read snapshots", () => {
  it("pages 23 submissions and two separate legacy keys at 20, keeping boundary siblings together", async () => {
    const first = await listApplicationFamilies(scope); const second = await listApplicationFamilies({ ...scope, page: 2 });
    expect(first.families.filter((family) => family.kind === "submission").every((family) => family.children.some((child) => child.isPossibleDuplicate))).toBe(true);
    expect(JSON.stringify(first.families)).not.toContain("010-0000-0000");
    expect(first.totalFamilies).toBe(25); expect(first.families).toHaveLength(20); expect(second.families).toHaveLength(5);
    expect(new Set([...first.families, ...second.families].map((family) => `${family.kind}:${family.id}`)).size).toBe(25);
    const boundary = [...first.families, ...second.families].find((family) => family.id === submissionIds[17]);
    expect(first.families.at(-1)?.id).toBe(submissionIds[17]); expect(second.families.some((f) => f.id === submissionIds[17])).toBe(false);
    expect(boundary?.children).toHaveLength(2); expect(boundary?.children.map((child) => child.matchesFilter)).toEqual([true, false]);
    expect([...first.families, ...second.families].filter((family) => family.kind === "legacy")).toHaveLength(2);
    expect(first.totalChildApplications).toBe(28); expect(first.matchingChildApplications).toBe(25);
    expect((await listApplicationFamilies(scope)).families.map((f) => f.id)).toEqual(first.families.map((f) => f.id));
  });
  it("enforces same-child class/status and keeps modern none disjoint from legacy", async () => {
    const wrong = await listApplicationFamilies({ classScheduleId: classIds[1], status: "SUBMITTED", notification: "received" }); expect(wrong.totalFamilies).toBe(0);
    const modern = await listApplicationFamilies({ ...scope, notification: "none", bankRecord: "none" }); expect(modern.totalFamilies).toBe(22); expect(modern.families.every((f) => f.kind === "submission")).toBe(true);
    const legacy = await listApplicationFamilies({ ...scope, notification: "legacy", bankRecord: "legacy" }); expect(legacy.totalFamilies).toBe(2); expect(legacy.families.every((f) => f.deposit.state === "amount-unrecorded")).toBe(true);
  });
  it("aggregates deposits independently of multiple children/obligations/allocations and keeps private facts out", async () => {
    const result = await listApplicationFamilies({ ...scope, notification: "received", bankRecord: "recorded" });
    expect(result.totalFamilies).toBe(1); expect(result.totalChildApplications).toBe(2); expect(result.matchingChildApplications).toBe(1);
    expect(result.families[0]?.deposit).toEqual({ state: "available", depositedAmount: 30000, hasOutstandingReturn: true });
    expect(JSON.stringify(result.families)).not.toMatch(/010-0000|PRIVATE_SYNTHETIC_NOTE|childBirthDate|guardianPhone|payerName|allocations|paymentMapping|returnObligations/);
  });
  it("includes cancelled/past-class pending and uses exact global family identities", async () => {
    const global = await countPendingApplicationFamilies();
    const expected = await db.$queryRaw<Array<{ families: bigint; children: bigint }>>(Prisma.sql`SELECT COUNT(DISTINCT CASE WHEN "submissionId" IS NOT NULL THEN 's:' || "submissionId" ELSE 'a:' || id END)::bigint AS families, COUNT(*)::bigint AS children FROM "ReservationApplication" WHERE status = 'SUBMITTED'`);
    expect(global).toEqual({ families: Number(expected[0]!.families), childApplications: Number(expected[0]!.children) });
    expect((await listApplicationFamilies({ classScheduleId: classIds[2] })).families.map((f) => f.id)).toEqual([submissionIds[1]]);
  });
  it("clamps the last page and runs a synthetic query plan without modifying indexes", async () => {
    const result = await listApplicationFamilies({ ...scope, page: 999 }); expect(result.page).toBe(2);
    const plans = await db.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) SELECT * FROM (${familyKeysSql(parseFamilyFilters(scope))}) families ORDER BY submitted DESC, kind, id LIMIT 20`); expect(plans).toBeTruthy();
  });
  it("clamps a formerly valid second page after owned synthetic pending families shrink", async () => {
    const ids = submissionIds.slice(-6).map((id) => `${id}-a`);
    expect((await listApplicationFamilies({ classScheduleId: classIds[0], page: 2 })).page).toBe(2);
    try {
      await db.reservationApplication.updateMany({ where: { id: { in: ids } }, data: { status: "REJECTED", resolvedAt: submitted, resolvedById: run, resolutionNote: "합성 축소" } });
      const result = await listApplicationFamilies({ classScheduleId: classIds[0], page: 2 });
      expect(result.totalFamilies).toBe(19); expect(result.page).toBe(1); expect(result.totalPages).toBe(1);
    } finally {
      await db.reservationApplication.updateMany({ where: { id: { in: ids } }, data: { status: "SUBMITTED", resolvedAt: null, resolvedById: null, resolutionNote: null } });
    }
  });
  it("retains the same snapshot when another admin changes a family filter between counts and key selection", async () => {
    let intercepted = false;
    const proxy = new Proxy(db, { get(target, property) {
      if (property === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel?: Prisma.TransactionIsolationLevel }) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(client, method) {
        if (method === "$queryRaw") return async (...args: [Prisma.Sql]) => {
          const rows = await client.$queryRaw(...args);
          if (!intercepted) { intercepted = true; await concurrent.reservationApplicationSubmission.update({ where: { id: submissionIds[0]! }, data: { depositNotifiedAt: null } }); }
          return rows;
        };
        return Reflect.get(client, method);
      } })), options);
      return Reflect.get(target, property);
    } });
    context.db = proxy;
    try { const result = await listApplicationFamilies({ ...scope, notification: "received" }); expect(result.totalFamilies).toBe(1); expect(result.families[0]?.notificationReceived).toBe(true); }
    finally { context.db = db; await db.reservationApplicationSubmission.update({ where: { id: submissionIds[0]! }, data: { depositNotifiedAt: submitted } }); }
  });
});
