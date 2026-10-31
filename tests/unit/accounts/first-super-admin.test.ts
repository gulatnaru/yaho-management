import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptFirstSuperAdmin, executeFirstSuperAdmin, issueFirstSuperAdminToken, prepareFirstSuperAdmin } from "@/server/accounts/first-super-admin";
import type { AdminPrincipal } from "@/lib/auth/principal";

const principal = { userId: "admin", role: "ADMIN", authVersion: 1 } as AdminPrincipal;
const now = Date.now();
function fixture() {
  const admin = { id: "admin", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 };
  const target = { id: "target", email: "person@example.test", role: "STAFF", isActive: false, password: null as string | null, mustChangePassword: false, teacherId: null, authVersion: 1 };
  const a = { id: "approval", approverUserId: "admin", targetUserId: "target", targetEmail: target.email, approvedAt: new Date(now), identityAt: new Date(now), identityMethod: "FACE_TO_FACE", expiresAt: new Date(now + 100000), revokedAt: null, consumedAt: null };
  const b = { id: "acceptance", approvalId: a.id, acceptedForUserId: target.id, targetEmail: target.email, expiresAt: new Date(now + 100000), acceptedAt: new Date(now), tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION", revokedAt: null, consumedAt: null };
  const tx = {
    $queryRaw: vi.fn(),
    user: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id === "admin" ? admin : where.id === "target" ? target : null)), create: vi.fn().mockResolvedValue(target), update: vi.fn().mockResolvedValue(target) },
    bootstrapCompletion: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    bootstrapApproval: { findUnique: vi.fn().mockResolvedValue(a), create: vi.fn().mockResolvedValue(a), update: vi.fn() },
    bootstrapAcceptance: { findUnique: vi.fn().mockResolvedValue(b), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    userAccountChange: { create: vi.fn() },
  };
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as Parameters<typeof executeFirstSuperAdmin>[3];
  return { tx, client, a, b, target, admin };
}
beforeEach(() => { vi.stubEnv("YAHO_P7_ISOLATED_HARNESS", "1"); vi.stubEnv("YAHO_P7_APPROVER_USER_ID", "admin"); vi.stubEnv("YAHO_ADMIN_CUTOVER_MODE", "LEGACY_ADMIN"); });
afterEach(() => vi.unstubAllEnvs());
describe("first SUPER_ADMIN evidence", () => {
  it("rejects execution without approval or acceptance", async () => {
    const f = fixture(); f.tx.bootstrapApproval.findUnique.mockResolvedValueOnce(null);
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
    f.tx.bootstrapAcceptance.findUnique.mockResolvedValueOnce(null);
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
  });
  it("rejects same approver and target, and changed email", async () => {
    const f = fixture(); f.a.approverUserId = "target";
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
    f.a.approverUserId = "admin"; f.b.targetEmail = "other@example.test";
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
    f.b.targetEmail = f.a.targetEmail; f.target.password = "hash"; f.target.mustChangePassword = true; f.target.authVersion = 2;
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
  });
  it("rejects existing completion or existing SUPER_ADMIN", async () => {
    const f = fixture(); f.tx.bootstrapCompletion.findUnique.mockResolvedValueOnce({ id: "FIRST_SUPER_ADMIN" });
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
    f.tx.user.findFirst.mockResolvedValueOnce({ id: "existing" });
    await expect(executeFirstSuperAdmin(principal, "approval", "acceptance", f.client)).rejects.toThrow();
  });
  it("rejects unprivileged approval and email collisions", async () => {
    const f = fixture(); f.admin.role = "STAFF";
    await expect(prepareFirstSuperAdmin(principal, { name: "Person", email: "person@example.test", identityAt: new Date() }, f.client)).rejects.toThrow();
    f.admin.role = "ADMIN"; f.tx.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(f.target);
    await expect(prepareFirstSuperAdmin(principal, { name: "Person", email: "person@example.test", identityAt: new Date() }, f.client)).rejects.toThrow();
  });
  it("rejects invalid and reused tokens, and requires independent identity evidence", async () => {
    const f = fixture();
    await expect(acceptFirstSuperAdmin("invalid", "abcdefgh", f.client)).rejects.toThrow();
    await expect(acceptFirstSuperAdmin("a".repeat(43), "abcdefgh", f.client)).rejects.toThrow();
    f.a.identityMethod = "TOKEN_POSSESSION";
    await expect(issueFirstSuperAdminToken(principal, "approval", f.client)).rejects.toThrow();
  });
  it("rejects altered, expired and used tokens", async () => {
    const f = fixture();
    f.tx.bootstrapAcceptance.findUnique.mockResolvedValueOnce(null);
    await expect(acceptFirstSuperAdmin("b".repeat(43), "abcdefgh", f.client)).rejects.toThrow();
    f.b.acceptedAt = null as unknown as Date;
    f.b.expiresAt = new Date(Date.now() - 1);
    await expect(acceptFirstSuperAdmin("a".repeat(43), "abcdefgh", f.client)).rejects.toThrow();
    f.b.expiresAt = new Date(Date.now() + 100000); f.b.acceptedAt = new Date();
    await expect(acceptFirstSuperAdmin("a".repeat(43), "abcdefgh", f.client)).rejects.toThrow();
  }, 20000);
  it("stores a cost-12 hash without activating the accepting user", async () => {
    const f = fixture(); f.b.acceptedAt = null as unknown as Date;
    await acceptFirstSuperAdmin("a".repeat(43), "synthetic-password", f.client);
    const calls = f.tx.user.update.mock.calls as unknown as Array<[{ data: { password: string; mustChangePassword: boolean; isActive?: boolean } }]>;
    const call = calls[0][0];
    expect(call.data.password).toMatch(/^\$2[aby]\$12\$/);
    expect(call.data.password).not.toContain("synthetic-password");
    expect(call.data.mustChangePassword).toBe(true);
    expect(call.data.isActive).toBeUndefined();
  }, 20000);
  it("increments authVersion and keeps password change mandatory on execution", async () => {
    const f = fixture(); f.target.password = "hash"; f.target.mustChangePassword = true;
    await executeFirstSuperAdmin(principal, "approval", "acceptance", f.client);
    expect(f.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "SUPER_ADMIN", isActive: true, authVersion: { increment: 1 }, mustChangePassword: true }) }));
    expect(f.tx.bootstrapCompletion.create).toHaveBeenCalledOnce();
  });
});
