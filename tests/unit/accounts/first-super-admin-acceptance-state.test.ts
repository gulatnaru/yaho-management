import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findFirst: vi.fn() },
  bootstrapCompletion: { findUnique: vi.fn() },
  bootstrapApproval: { findUnique: vi.fn() },
  bootstrapAcceptance: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/cutover-mode", () => ({ resolveAccountCutoverMode: () => "LEGACY_ADMIN" }));

import { createFirstSuperAdminCore } from "@/server/accounts/first-super-admin-core";

const { getFirstSuperAdminAcceptanceState } = createFirstSuperAdminCore({ enabled: () => true, approverId: () => undefined });
const token = "a".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async fn => fn(db));
  db.bootstrapCompletion.findUnique.mockResolvedValue(null);
  db.user.findFirst.mockResolvedValue(null);
  db.bootstrapAcceptance.findUnique.mockResolvedValue({ approvalId: "approval", acceptedForUserId: "target", targetEmail: "target@example.test", acceptedAt: null, revokedAt: null, consumedAt: null, expiresAt: new Date(Date.now() + 60_000) });
  db.bootstrapApproval.findUnique.mockResolvedValue({ approverUserId: "admin", targetUserId: "target", targetEmail: "target@example.test", revokedAt: null, consumedAt: null, expiresAt: new Date(Date.now() + 60_000), identityAt: new Date(0), approvedAt: new Date(1), identityMethod: "FACE_TO_FACE" });
});

describe("first SUPER_ADMIN acceptance GET state", () => {
  it("returns true when acceptance and its approval are valid", async () => {
    await expect(getFirstSuperAdminAcceptanceState(token)).resolves.toBe(true);
    expect(db.bootstrapApproval.findUnique).toHaveBeenCalledWith({ where: { id: "approval" } });
  });

  it("returns false for an expired approval even when acceptance is valid", async () => {
    db.bootstrapApproval.findUnique.mockResolvedValueOnce({ approverUserId: "admin", targetUserId: "target", targetEmail: "target@example.test", revokedAt: null, consumedAt: null, expiresAt: new Date(Date.now() - 1), identityAt: new Date(0), approvedAt: new Date(1), identityMethod: "FACE_TO_FACE" });
    await expect(getFirstSuperAdminAcceptanceState(token)).resolves.toBe(false);
  });

  it.each([
    { revokedAt: new Date() }, { consumedAt: new Date() }, { targetUserId: "different" }, { targetEmail: "different@example.test" },
  ])("rejects invalid or mismatched approval %j", async change => {
    const approval = await db.bootstrapApproval.findUnique();
    db.bootstrapApproval.findUnique.mockResolvedValueOnce({ ...approval, ...change });
    await expect(getFirstSuperAdminAcceptanceState(token)).resolves.toBe(false);
  });

  it("returns false for an already accepted row", async () => {
    const acceptance = await db.bootstrapAcceptance.findUnique();
    db.bootstrapAcceptance.findUnique.mockResolvedValueOnce({ ...acceptance, acceptedAt: new Date() });
    await expect(getFirstSuperAdminAcceptanceState(token)).resolves.toBe(false);
    expect(db.bootstrapApproval.findUnique).not.toHaveBeenCalled();
  });
});
