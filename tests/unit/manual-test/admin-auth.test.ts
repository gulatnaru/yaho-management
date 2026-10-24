import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockManualTestPrisma } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, MOCK_TTL } from "@/server/manual-test/auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { ORIGIN, START, SYNTHETIC_SECRET, cookiePair, request } from "./helpers";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
const row = { id: "synthetic-admin", name: "TEST ADMIN", email: "admin@example.test", role: "ADMIN", isActive: true, teacherId: null, teacher: null, mustChangePassword: false, authVersion: 3 };
async function context(secret?: string) {
  const db = new MockManualTestPrisma();
  const manualAuth = new ManualTestAuth(db, { enabled: true, nodeEnv: "test", origin: ORIGIN, syntheticBootstrapSecret: secret }, () => START);
  const challenge = await manualAuth.issueChallenge(request("GET"));
  return { db, manualAuth, post: (secret?: string, metadata = {}) => request("POST", cookiePair(challenge.cookie), challenge.csrf, undefined, { ...(secret === undefined ? {} : { "x-manual-test-bootstrap-secret": secret }), ...metadata }) };
}
// Auth.js auth() is overloaded; the application uses its no-argument Session form.
function session(value: unknown) { vi.mocked(auth).mockResolvedValue(value as never); }

describe("manual bootstrap with live ADMIN authorization", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "admin-auth-test-server-secret-0000000000");
    session({ user: { id: row.id, authVersion: 3, role: "ADMIN" } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(row as never);
  });

  it("bootstraps ADMIN without a synthetic secret or synthetic config", async () => {
    const c = await context();
    const created = await c.manualAuth.bootstrap(c.post(), {});
    expect(created.mode).toBe("MOCK_ONLY");
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id } }));
    const run = await c.db.$transaction(created.runId, (tx) => tx.run);
    expect(JSON.stringify(run)).not.toContain(row.id);
    expect(Object.values(run.sessions)[0].scope).toBe("OPERATOR");
    const expired = new ManualTestAuth(c.db, { enabled: true, nodeEnv: "test", origin: ORIGIN }, () => START + MOCK_TTL.challenge);
    await expect(expired.bootstrap(c.post(), {})).rejects.toThrow("UNAUTHORIZED");
  });

  it.each([
    { label: "MANAGER", change: { role: "MANAGER" } },
    { label: "inactive", change: { isActive: false } },
    { label: "stale authVersion", change: { authVersion: 4 } },
    { label: "mandatory password change", change: { mustChangePassword: true } },
    { label: "TEACHER", change: { role: "TEACHER", teacherId: "teacher-1", teacher: { id: "teacher-1", isActive: true } } },
  ])("rejects $label even if JWT claims ADMIN", async ({ change }) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...row, ...change } as never);
    const c = await context();
    await expect(c.manualAuth.bootstrap(c.post(), {})).rejects.toThrow("UNAUTHORIZED");
  });

  it.each([null, { user: { id: row.id } }, { user: { id: row.id, authVersion: 0 } }])("rejects missing/invalid session identity %j", async (value) => {
    session(value);
    const c = await context();
    await expect(c.manualAuth.bootstrap(c.post(), {})).rejects.toThrow("UNAUTHORIZED");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects deleted accounts and retains challenge CSRF/origin checks", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const c = await context();
    await expect(c.manualAuth.bootstrap(c.post(), {})).rejects.toThrow("UNAUTHORIZED");
    await expect(c.manualAuth.bootstrap(request("POST", c.post().headers.get("cookie")!), {})).rejects.toThrow("CSRF_DENIED");
    const foreign = new Request(`${ORIGIN}/api/manual-test/bootstrap`, { method: "POST", headers: { origin: "https://evil.test" } });
    await expect(c.manualAuth.bootstrap(foreign, {})).rejects.toThrow("ORIGIN_DENIED");
  });

  it("synthetic fallback must be explicitly configured and never needs Auth.js", async () => {
    session(null);
    const c = await context(SYNTHETIC_SECRET);
    await expect(c.manualAuth.bootstrap(c.post(SYNTHETIC_SECRET), {})).resolves.toHaveProperty("runId");
    expect(auth).not.toHaveBeenCalled();
    const missing = await context();
    await expect(missing.manualAuth.bootstrap(missing.post(SYNTHETIC_SECRET), {})).rejects.toThrow("UNAUTHORIZED");
    const wrong = await context(SYNTHETIC_SECRET);
    await expect(wrong.manualAuth.bootstrap(wrong.post("wrong-synthetic-test-secret-0000000"), {})).rejects.toThrow("UNAUTHORIZED");
    const noCredential = await context(SYNTHETIC_SECRET);
    await expect(noCredential.manualAuth.bootstrap(noCredential.post(), {})).rejects.toThrow("UNAUTHORIZED");
  });

  it("does not bypass ADMIN checks when its lookup fails", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error("LOOKUP_FAILED"));
    const c = await context(SYNTHETIC_SECRET);
    await expect(c.manualAuth.bootstrap(c.post(), {})).rejects.toThrow("LOOKUP_FAILED");
  });
});
