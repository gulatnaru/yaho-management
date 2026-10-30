import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "staff-1", authVersion: 1, role: "SUPER_ADMIN" } })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique: vi.fn().mockRejectedValue(new Error("DB unavailable")) } } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

describe("principal verification failure", () => {
  it("denies a protected request and returns no optional principal when the database fails", async () => {
    const { requireCurrentPrincipal, getOptionalOperationalPrincipal } = await import("@/lib/auth/authorization");
    await expect(requireCurrentPrincipal()).rejects.toThrow("DB unavailable");
    await expect(getOptionalOperationalPrincipal()).resolves.toBeNull();
  });

  it("denies a forged SUPER_ADMIN session role when the live account is STAFF", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "staff-1", name: "직원", email: "staff@example.test", role: "STAFF",
      isActive: true, teacherId: null, authVersion: 1, mustChangePassword: false, teacher: null,
    } as never);
    const { requireSuperAdminPrincipal } = await import("@/lib/auth/authorization");
    await expect(requireSuperAdminPrincipal()).rejects.toThrow("NOT_FOUND");
  });
});
