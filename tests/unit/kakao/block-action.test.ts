import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), stop: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock("@/server/kakao/dispatch-repository", () => ({ PrismaDispatchRepository: class {} }));
vi.mock("@/server/kakao/runtime-settings", () => ({ PrismaRuntimeRepository: class {} }));
vi.mock("@/server/kakao/block-action-service", () => ({ stopNewSends: mocks.stop }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { blockAction } from "@/app/(admin)/reservation-applications/notifications/actions";
import { blockMessage } from "@/app/(admin)/reservation-applications/notifications/block-message";

describe("block server action", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["anonymous", "inactive", "manager", "teacher", "password change"]) ("rejects %s before reading or issuing a command", async () => {
    mocks.auth.mockRejectedValue(new Error("denied"));
    await expect(blockAction(null, new FormData())).rejects.toThrow("denied");
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("uses the current principal and preserves failure for display", async () => {
    mocks.auth.mockResolvedValue({ userId: "synthetic-admin" }); mocks.stop.mockResolvedValue("failed");
    const form = new FormData(); form.set("reason", "operator_stop");
    expect(await blockAction(null, form)).toBe("failed");
    expect(mocks.stop.mock.calls[0][0]).toEqual({ actorId: "synthetic-admin", reason: "operator_stop" });
    expect(blockMessage("failed")).toContain("실패");
    expect(blockMessage("failed")).not.toContain("차단했습니다");
    expect(blockMessage("conflict_blocked")).toContain("경합");
  });
});
