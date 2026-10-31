// Dedicated disposable local DB only. Never point this suite at a shared database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../e2e/support/db-safety";
import { acceptFirstSuperAdmin, executeFirstSuperAdmin, issueFirstSuperAdminToken, prepareFirstSuperAdmin } from "@/server/accounts/first-super-admin";
import type { AdminPrincipal } from "@/lib/auth/principal";
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.YAHO_P7_ISOLATED_HARNESS !== "1") throw new Error("P7_ISOLATED_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
process.env.YAHO_ADMIN_CUTOVER_MODE = "LEGACY_ADMIN";
const db = new PrismaClient();
const id = `p7-${crypto.randomUUID()}`;
process.env.YAHO_P7_APPROVER_USER_ID = id;
const principal = { userId: id, name: "Synthetic Admin", email: `${id}@example.test`, role: "ADMIN", teacherId: null, authVersion: 1, mustChangePassword: false } as AdminPrincipal;
let approvalId = "", acceptanceId = "", targetId = "";
beforeAll(async () => {
  if (await db.bootstrapCompletion.findFirst() || await db.user.findFirst({ where: { role: "SUPER_ADMIN" } })) throw new Error("P7_REQUIRES_EMPTY_SINGLETON");
  await db.user.create({ data: { id, name: principal.name, email: principal.email, role: "ADMIN" } });
});
afterAll(async () => {
  // Cleanup is restricted to the disposable database verified above; product has no reset API.
  await db.bootstrapCompletion.deleteMany({ where: { approvalId } });
  await db.bootstrapAcceptance.deleteMany({ where: { approvalId } });
  await db.bootstrapApproval.deleteMany({ where: { id: approvalId } });
  await db.userAccountChange.deleteMany({ where: { actorAdminId: id } });
  await db.user.deleteMany({ where: { id: { in: [id, targetId] } } });
  await db.$disconnect();
});
describe.sequential("P7 isolated transactions", () => {
  it("commits separate approval and acceptance while target remains inactive", async () => {
    const result = await prepareFirstSuperAdmin(principal, { name: "Synthetic Target", email: `${id}-target@example.test`, identityAt: new Date() }, db);
    approvalId = result.approvalId; targetId = result.targetUserId;
    const token = await issueFirstSuperAdminToken(principal, approvalId, db);
    await acceptFirstSuperAdmin(token, "Synthetic-password-123", db);
    const a = await db.bootstrapApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const b = await db.bootstrapAcceptance.findFirstOrThrow({ where: { approvalId } }); acceptanceId = b.id;
    expect(a).toMatchObject({ approverUserId: id, targetUserId: targetId, targetEmail: `${id}-target@example.test`, identityMethod: "FACE_TO_FACE", consumedAt: null });
    expect(b).toMatchObject({ approvalId, acceptedForUserId: targetId, targetEmail: a.targetEmail, consumedAt: null });
    expect(a.identityAt.getTime()).toBeLessThanOrEqual(a.approvedAt.getTime());
    expect(b.acceptedAt).not.toBeNull();
    expect(a.approverUserId).not.toBe(b.acceptedForUserId);
    expect(b.tokenVerified).toBe(true);
    expect(b.authenticationMethod).toBe("TOKEN_POSSESSION");
    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ role: "STAFF", isActive: false, mustChangePassword: true });
    await expect(acceptFirstSuperAdmin(token, "Synthetic-password-123", db)).rejects.toThrow();
  });
  it("rejects a changed target and preserves prior evidence", async () => {
    await db.user.update({ where: { id: targetId }, data: { isActive: true } });
    await expect(executeFirstSuperAdmin(principal, approvalId, acceptanceId, db)).rejects.toThrow();
    expect((await db.bootstrapApproval.findUniqueOrThrow({ where: { id: approvalId } })).consumedAt).toBeNull();
    expect((await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } })).consumedAt).toBeNull();
    await db.user.update({ where: { id: targetId }, data: { isActive: false } });
  });
  it("rolls back only C if audit creation fails", async () => {
    const broken = {
      $transaction: <T>(callback: (tx: unknown) => Promise<T>) => db.$transaction(async tx => {
        const audit = new Proxy(tx.userAccountChange, { get(target, key, receiver) {
          if (key === "create") return async () => { throw new Error("synthetic audit failure"); };
          return Reflect.get(target, key, receiver);
        } });
        return callback(new Proxy(tx, { get(target, key, receiver) {
          return key === "userAccountChange" ? audit : Reflect.get(target, key, receiver);
        } }));
      }),
    } as unknown as Parameters<typeof executeFirstSuperAdmin>[3];
    await expect(executeFirstSuperAdmin(principal, approvalId, acceptanceId, broken)).rejects.toThrow();
    expect(await db.bootstrapCompletion.count()).toBe(0);
    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ role: "STAFF", isActive: false });
    expect(await db.userAccountChange.count({ where: { targetUserId: targetId } })).toBe(0);
    expect((await db.bootstrapApproval.findUniqueOrThrow({ where: { id: approvalId } })).consumedAt).toBeNull();
    expect(await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } })).toMatchObject({ consumedAt: null, executionId: null, tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION" });
    expect((await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } })).acceptedAt).not.toBeNull();
  });
  it("rejects a pre-existing SUPER_ADMIN", async () => {
    const extra = `${id}-existing`;
    await db.user.create({ data: { id: extra, name: "Synthetic Existing", email: `${extra}@example.test`, role: "SUPER_ADMIN" } });
    try { await expect(executeFirstSuperAdmin(principal, approvalId, acceptanceId, db)).rejects.toThrow(); }
    finally { await db.user.delete({ where: { id: extra } }); }
  });
  it("serializes competing executions and atomically records role, audit, evidence and singleton", async () => {
    const outcomes = await Promise.allSettled([executeFirstSuperAdmin(principal, approvalId, acceptanceId, db), executeFirstSuperAdmin(principal, approvalId, acceptanceId, db)]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    const target = await db.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(target).toMatchObject({ role: "SUPER_ADMIN", isActive: true, mustChangePassword: true, authVersion: 2 });
    const audits = await db.userAccountChange.findMany({ where: { targetUserId: targetId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorAdminId: id, type: "CREATED", previousRole: "STAFF", nextRole: "SUPER_ADMIN", previousIsActive: false, nextIsActive: true, nextEmail: target.email });
    const approval = await db.bootstrapApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const acceptance = await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
    const completion = await db.bootstrapCompletion.findUniqueOrThrow({ where: { id: "FIRST_SUPER_ADMIN" } });
    expect(approval).toMatchObject({ targetUserId: targetId, executionId: completion.id });
    expect(acceptance).toMatchObject({ approvalId, acceptedForUserId: targetId, executionId: completion.id });
    expect(completion).toMatchObject({ approvalId, acceptanceId });
    expect(approval.consumedAt?.getTime()).toBe(completion.completedAt.getTime());
    expect(acceptance.consumedAt?.getTime()).toBe(completion.completedAt.getTime());
    await db.user.update({ where: { id: targetId }, data: { role: "STAFF", isActive: false } });
    await expect(executeFirstSuperAdmin(principal, approvalId, acceptanceId, db)).rejects.toThrow();
  });
});
