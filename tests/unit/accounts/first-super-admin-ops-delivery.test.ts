import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AdminPrincipal } from "@/lib/auth/principal";

const transport = vi.hoisted(() => ({ config: { kind: "off" } as object, send: vi.fn() }));
const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    bootstrapCompletion: { findUnique: vi.fn() },
    bootstrapApproval: { findUnique: vi.fn() },
    bootstrapAcceptance: { updateMany: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    bootstrapDeliveryAttempt: { create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return tx;
});
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/invitations/config", () => ({ deliveryConfig: () => transport.config }));
vi.mock("@/server/accounts/first-super-admin-ops-template", () => ({ BOOTSTRAP_TEMPLATE_APPROVED: true, bootstrapEmail: () => ({ text: "draft", html: "draft" }) }));
vi.mock("@/lib/invitations/resend", () => ({ resendDelivery: () => ({ sendInvitation: transport.send }) }));
import { issueAndDeliverOps } from "@/server/accounts/first-super-admin-ops";
import { takeOpsFake } from "@/server/accounts/first-super-admin-ops-fake";
const principal = { userId: "admin", role: "ADMIN", authVersion: 1, mustChangePassword: false } as AdminPrincipal;

beforeEach(() => {
  vi.clearAllMocks();
  transport.config = { kind: "off" };
  vi.stubEnv("YAHO_P7_OPS_ENABLED", "1"); vi.stubEnv("YAHO_P7_OPS_APPROVER_USER_ID", "admin");
  vi.stubEnv("YAHO_ADMIN_CUTOVER_MODE", "LEGACY_ADMIN");
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("DATABASE_URL", "postgresql://yaho_e2e:synthetic@127.0.0.1:55432/yaho_e2e");
  vi.stubEnv("DIRECT_URL", "postgresql://yaho_e2e:synthetic@127.0.0.1:55432/yaho_e2e");
  db.$transaction.mockImplementation(async fn => fn(db));
  db.user.findFirst.mockResolvedValue(null); db.bootstrapCompletion.findUnique.mockResolvedValue(null);
  db.user.findUnique.mockImplementation(async ({ where }) => where.id === "admin" ? { id: "admin", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 } : { id: "target", email: "target@example.test", role: "STAFF", isActive: false, authVersion: 1, password: null });
  db.bootstrapApproval.findUnique.mockResolvedValue({ id: "approval", approverUserId: "admin", targetUserId: "target", targetEmail: "target@example.test", revokedAt: null, consumedAt: null, expiresAt: new Date(Date.now() + 100000), approvedAt: new Date(), identityAt: new Date(0), identityMethod: "FACE_TO_FACE" });
  let count = 0;
  db.bootstrapAcceptance.create.mockImplementation(async () => ({ id: `acceptance-${++count}` }));
  db.bootstrapAcceptance.findUniqueOrThrow.mockImplementation(async () => ({ id: `acceptance-${count}`, targetEmail: "target@example.test", expiresAt: new Date(Date.now() + 100000) }));
  db.bootstrapDeliveryAttempt.findUniqueOrThrow.mockImplementation(async () => ({ id: `attempt-${count}` }));
  db.bootstrapDeliveryAttempt.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("ops delivery", () => {
  it("reissues new tokens and attempts, returns status only and stores no raw token or URL", async () => {
    const log = vi.spyOn(console, "log"); const error = vi.spyOn(console, "error");
    const first = await issueAndDeliverOps(principal, "approval"); const token1 = takeOpsFake();
    const second = await issueAndDeliverOps(principal, "approval"); const token2 = takeOpsFake();
    expect(first).toBe("ACCEPTED"); expect(second).toBe("ACCEPTED");
    expect(Boolean(token1)).toBe(true); expect(Boolean(token2)).toBe(true); expect(token1 === token2).toBe(false);
    const calls = db.bootstrapAcceptance.create.mock.calls;
    expect(calls[0][0].data.tokenHash).toBe(createHash("sha256").update(token1!).digest("hex"));
    expect(calls[1][0].data.tokenHash).toBe(createHash("sha256").update(token2!).digest("hex"));
    expect(db.bootstrapAcceptance.updateMany).toHaveBeenCalledTimes(2);
    expect(db.bootstrapDeliveryAttempt.create.mock.calls.map(c => c[0].data.acceptanceId)).toEqual(["acceptance-1", "acceptance-2"]);
    const recorded = JSON.stringify([db.bootstrapAcceptance.create.mock.calls, db.bootstrapDeliveryAttempt.create.mock.calls, db.bootstrapDeliveryAttempt.updateMany.mock.calls, log.mock.calls, error.mock.calls, first, second]);
    expect(recorded.includes(token1!)).toBe(false); expect(recorded.includes(token2!)).toBe(false); expect(recorded.includes("/first-super-admin-ops/")).toBe(false);
  });
});

describe("isolated fake transport boundary", () => {
  it("rejects Vercel, production, and a non-isolated direct database", async () => {
    const { opsFakeEnabled } = await import("@/server/accounts/first-super-admin-ops-fake");
    expect(opsFakeEnabled()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview"); expect(opsFakeEnabled()).toBe(false);
    vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("NODE_ENV", "production"); expect(opsFakeEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DIRECT_URL", "postgresql://synthetic@example.test:55432/yaho_e2e"); expect(opsFakeEnabled()).toBe(false);
  });
});


describe("provider result policy (mocked adapter)", () => {
  it.each([
    [{ status: "ACCEPTED", providerMessageId: "provider-id" }, "ACCEPTED"],
    [{ status: "FAILED", errorCategory: "PROVIDER" }, "FAILED"],
    [{ status: "UNKNOWN", errorCategory: "NETWORK" }, "UNKNOWN"],
  ])("records %s as %s without automatic retry", async (result, expected) => {
    vi.stubEnv("NODE_ENV", "production");
    transport.config = { kind: "resend", apiKey: "synthetic", sender: "synthetic@example.test", origin: "https://example.test" };
    transport.send.mockResolvedValue(result);
    expect(await issueAndDeliverOps(principal, "approval")).toBe(expected);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(db.bootstrapDeliveryAttempt.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: expected }) }));
  });
});
