import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { updateAccountCore, resetAccountPasswordCore } from "@/server/accounts/mutations";
import { changeOwnPasswordCore } from "@/server/auth/change-password";
import { resolveSessionPrincipal } from "@/lib/auth/principal";
import { authenticateOperator } from "@/lib/auth/credentials";
import { acceptInvitationCore, issueInvitationCore } from "@/server/accounts/invitations";

vi.mock("@/lib/invitations/config", () => ({ invitationUseEnabled: () => true }));

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("P5_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

const db = new PrismaClient();
const run = `p5int-${crypto.randomUUID()}`;
const superId = `${run}-super`;
const ids = [superId];
const originalMode = process.env.YAHO_ADMIN_CUTOVER_MODE;
const password = "P5-synthetic-old-123!";
const nextPassword = "P5-synthetic-new-123!";
const actor = { userId: superId, name: "Synthetic super", email: `${run}-super@example.test`, role: "SUPER_ADMIN", teacherId: null, authVersion: 1, mustChangePassword: false } as const;

async function createStaff(suffix: string) {
  const id = `${run}-${suffix}`;
  const email = `${id}@example.test`;
  await db.user.create({ data: { id, email, name: suffix, role: "STAFF", isActive: true, password: await hash(password, 12), mustChangePassword: false } });
  ids.push(id);
  return { id, email, name: suffix };
}

function updateInput(user: { email: string; name: string }, role: "STAFF" | "MANAGER", isActive: boolean) {
  return { name: user.name, email: user.email, role, isActive, teacherId: null };
}

beforeAll(async () => {
  process.env.YAHO_ADMIN_CUTOVER_MODE = "SUPER_ADMIN";
  await db.user.create({ data: { id: superId, name: "Synthetic super", email: actor.email, role: "SUPER_ADMIN", isActive: true, mustChangePassword: false } });
});

afterAll(async () => {
  await db.adminInvitation.deleteMany({ where: { OR: [{ issuedById: superId }, { targetUserId: { in: ids } }] } });
  await db.userAccountChange.deleteMany({ where: { OR: [{ targetUserId: { in: ids } }, { actorAdminId: { in: ids } }] } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  if (originalMode === undefined) delete process.env.YAHO_ADMIN_CUTOVER_MODE;
  else process.env.YAHO_ADMIN_CUTOVER_MODE = originalMode;
});

describe.sequential("P5 session security (isolated PostgreSQL)", () => {
  it("commits role, one version increment and both audit rows together; no-op and profile changes do not increment", async () => {
    const user = await createStaff("role");
    await updateAccountCore(actor, user.id, updateInput(user, "MANAGER", false), db as never);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ role: "MANAGER", isActive: false, authVersion: 2 });
    const audit = await db.userAccountChange.findMany({ where: { targetUserId: user.id } });
    expect(audit.map((entry) => entry.type).sort()).toEqual(["ACTIVE_CHANGED", "ROLE_CHANGED"]);
    await updateAccountCore(actor, user.id, updateInput(user, "MANAGER", false), db as never);
    await updateAccountCore(actor, user.id, { ...updateInput(user, "MANAGER", false), name: "Edited" }, db as never);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion).toBe(2);
    expect(await db.userAccountChange.count({ where: { targetUserId: user.id } })).toBe(2);
  }, 30000);

  it("rejects old sessions after role change and deactivation and never resurrects them after reactivation", async () => {
    const user = await createStaff("lifecycle");
    const old = { userId: user.id, authVersion: 1 };
    expect(await resolveSessionPrincipal(old, db as never)).toMatchObject({ role: "STAFF" });
    await updateAccountCore(actor, user.id, updateInput(user, "MANAGER", true), db as never);
    expect(await resolveSessionPrincipal(old, db as never)).toBeNull();
    expect(await resolveSessionPrincipal({ ...old, authVersion: 2 }, db as never)).toMatchObject({ role: "MANAGER" });
    await updateAccountCore(actor, user.id, updateInput(user, "MANAGER", false), db as never);
    expect(await resolveSessionPrincipal({ ...old, authVersion: 2 }, db as never)).toBeNull();
    expect(await authenticateOperator({ email: user.email, password }, db as never)).toBeNull();
    await updateAccountCore(actor, user.id, updateInput(user, "MANAGER", true), db as never);
    expect(await resolveSessionPrincipal(old, db as never)).toBeNull();
    expect(await resolveSessionPrincipal({ ...old, authVersion: 2 }, db as never)).toBeNull();
    expect(await resolveSessionPrincipal({ ...old, authVersion: 4 }, db as never)).toMatchObject({ role: "MANAGER" });
  }, 30000);

  it("invalidates the old password session and accepts a new login after self change", async () => {
    const user = await createStaff("password");
    const principal = await resolveSessionPrincipal({ userId: user.id, authVersion: 1 }, db as never);
    expect(principal).not.toBeNull();
    await changeOwnPasswordCore(principal!, { currentPassword: password, newPassword: nextPassword, confirmPassword: nextPassword }, db as never);
    expect(await resolveSessionPrincipal({ userId: user.id, authVersion: 1 }, db as never)).toBeNull();
    expect(await authenticateOperator({ email: user.email, password }, db as never)).toBeNull();
    expect(await authenticateOperator({ email: user.email, password: nextPassword }, db as never)).toMatchObject({ id: user.id, authVersion: 2 });
  }, 30000);

  it("serializes concurrent distinct security changes and increments once for each", async () => {
    const user = await createStaff("concurrent");
    await Promise.all([
      updateAccountCore(actor, user.id, updateInput(user, "MANAGER", true), db),
      resetAccountPasswordCore(actor, user.id, await hash(nextPassword, 12), db),
    ]);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: "MANAGER", authVersion: 3, mustChangePassword: true });
    const audit = await db.userAccountChange.findMany({ where: { targetUserId: user.id } });
    expect(audit.map((entry) => entry.type).sort()).toEqual(["PASSWORD_RESET", "ROLE_CHANGED"]);
    expect(await resolveSessionPrincipal({ userId: user.id, authVersion: 1 }, db as never)).toBeNull();
    expect(await authenticateOperator({ email: user.email, password: nextPassword }, db as never)).toMatchObject({ authVersion: 3 });
  }, 30000);

  it("rolls back the role and version if audit insertion fails inside the transaction", async () => {
    const user = await createStaff("rollback");
    const failingClient = {
      $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async (tx) => {
        const failingTx = new Proxy(tx, { get(target, key, receiver) {
          if (key === "userAccountChange") return new Proxy(target.userAccountChange, { get(delegate, method, delegateReceiver) {
            if (method === "createMany") return async () => { throw new Error("synthetic audit failure"); };
            return Reflect.get(delegate, method, delegateReceiver);
          } });
          return Reflect.get(target, key, receiver);
        } });
        return callback(failingTx);
      }),
    };
    await expect(updateAccountCore(actor, user.id, updateInput(user, "MANAGER", true), failingClient as never)).rejects.toThrow("synthetic audit failure");
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: "STAFF", authVersion: 1 });
    expect(await db.userAccountChange.count({ where: { targetUserId: user.id } })).toBe(0);
  }, 30000);

  it("preserves P3 invite acceptance, version bump, audit and new login", async () => {
    const email = `${run}-invite@example.test`;
    const invite = await issueInvitationCore(actor, { name: "Invite", email, role: "STAFF", teacherId: null }, db as never);
    ids.push(invite.targetUserId);
    await acceptInvitationCore({ token: invite.token, passwordHash: await hash(nextPassword, 12) }, db as never);
    expect(await db.user.findUniqueOrThrow({ where: { id: invite.targetUserId } })).toMatchObject({ isActive: true, authVersion: 2 });
    expect(await db.userAccountChange.count({ where: { targetUserId: invite.targetUserId, type: "INVITATION_ACCEPTED" } })).toBe(1);
    expect(await authenticateOperator({ email, password: nextPassword }, db as never)).toMatchObject({ id: invite.targetUserId, authVersion: 2 });
  }, 30000);
});
