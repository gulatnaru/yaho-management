import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { deliverIssuedInvitation } from "@/server/accounts/invitation-delivery";
import { acceptInvitationCore, issueInvitationCore, reissueInvitationCore } from "@/server/accounts/invitations";

assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
if (process.env.VERCEL_ENV || process.env.NODE_ENV === "production") throw new Error("P4_LOCAL_ONLY");
process.env.YAHO_ADMIN_CUTOVER_MODE = "SUPER_ADMIN";
process.env.YAHO_INVITATION_DELIVERY = "fake";
process.env.YAHO_P4_ISOLATED_HARNESS = "1";
const db = new PrismaClient();
const suffix = crypto.randomUUID();
const actorId = `p4-${suffix}`;
const email = `p4-${suffix}@example.test`;
const principal = { userId: actorId, role: "SUPER_ADMIN", name: "Synthetic", email: `a-${email}`, teacherId: null } as never;
let issued: Awaited<ReturnType<typeof issueInvitationCore>>;
let reissued: Awaited<ReturnType<typeof issueInvitationCore>>;
const targetUserIds = new Set<string>();

beforeAll(async () => {
  await db.user.create({ data: { id: actorId, email: `a-${email}`, name: "Synthetic", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false } });
});
afterAll(async () => {
  await db.invitationDeliveryAttempt.deleteMany({ where: { invitation: { issuedById: actorId } } });
  await db.adminInvitation.deleteMany({ where: { issuedById: actorId } });
  const userIds = [actorId, ...targetUserIds];
  await db.userAccountChange.deleteMany({ where: { OR: [{ targetUserId: { in: userIds } }, { actorAdminId: { in: userIds } }] } });
  await db.user.deleteMany({ where: { OR: [{ id: actorId }, { email }] } });
  await db.$disconnect();
});
describe.sequential("isolated P4 delivery", () => {
  it("creates one attempt under duplicate concurrent calls and preserves inactive account", async () => {
    issued = await issueInvitationCore(principal, { name: "Synthetic", email, role: "STAFF", teacherId: null });
    targetUserIds.add(issued.targetUserId);
    const adapter = { sendInvitation: vi.fn(async () => ({ status: "FAILED" as const, errorCategory: "LIMIT" })) };
    await Promise.all([deliverIssuedInvitation(issued, adapter), deliverIssuedInvitation(issued, adapter)]);
    expect(adapter.sendInvitation).toHaveBeenCalledTimes(1);
    const attempt = await db.invitationDeliveryAttempt.findUniqueOrThrow({ where: { invitationId: issued.invitationId } });
    expect(attempt.status).toBe("FAILED");
    expect(JSON.stringify(attempt)).not.toContain(issued.token);
    const account = await db.user.findUniqueOrThrow({ where: { id: issued.targetUserId } });
    expect(account.isActive).toBe(false); expect(account.password).toBeNull();
  });
  it("reissues a new token, revokes the old and separates status from audit", async () => {
    reissued = await reissueInvitationCore(principal, issued.invitationId);
    targetUserIds.add(reissued.targetUserId);
    expect(reissued.token).not.toBe(issued.token);
    expect((await db.adminInvitation.findUniqueOrThrow({ where: { id: issued.invitationId } })).revokedAt).not.toBeNull();
    expect(await deliverIssuedInvitation(reissued, { sendInvitation: async () => ({ status: "UNKNOWN", errorCategory: "NETWORK" }) })).toBe("UNKNOWN");
    await expect(acceptInvitationCore({ token: issued.token, passwordHash: "synthetic-hash" })).rejects.toThrow();
    const audit = await db.userAccountChange.findMany({ where: { targetUserId: issued.targetUserId } });
    expect(JSON.stringify(audit)).not.toContain(reissued.token);
    expect(await db.invitationDeliveryAttempt.count({ where: { invitationId: { in: [issued.invitationId, reissued.invitationId] } } })).toBe(2);
  });
  it("preserves single acceptance", async () => {
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => acceptInvitationCore({ token: reissued.token, passwordHash: "synthetic-hash" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
});
