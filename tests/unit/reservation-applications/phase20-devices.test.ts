import { describe, expect, it, vi } from "vitest";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { listOwnedRepeatChildrenCore, revokeApplicationDeviceCore } from "@/server/reservation-applications/devices";

describe("Phase 20 repeat-device ownership", () => {
  it("returns only active, unpurged children from the opaque device capability", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      submissions: [{ submission: { guardianName: "보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER" } }],
      children: [{ child: { id: "child-1", name: "아이", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: "보호자", guardianPhone: "010-1234-5678" } }],
    });
    const result = await listOwnedRepeatChildrenCore({ applicationDevice: { findFirst } } as never, { token: "opaque-device", now: new Date("2026-10-06") });
    expect(result).toEqual({ guardian: { guardianName: "보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER" }, children: [{ id: "child-1", name: "아이", birthDate: "2020-01-01", gender: "UNSPECIFIED" }] });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tokenHash: hashApplicationCapabilityToken("opaque-device"), revokedAt: null }) }));
  });

  it("fails closed without a capability and revokes only an active matching hash", async () => {
    const findFirst = vi.fn();
    await expect(listOwnedRepeatChildrenCore({ applicationDevice: { findFirst } } as never, { token: undefined, now: new Date() })).resolves.toEqual({ guardian: null, children: [] });
    expect(findFirst).not.toHaveBeenCalled();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(revokeApplicationDeviceCore({ applicationDevice: { updateMany } } as never, { token: "opaque-device", now: new Date("2026-10-06") })).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tokenHash: hashApplicationCapabilityToken("opaque-device"), revokedAt: null }) }));
  });

  it("does not return a granted child after the child's guardian changes", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      submissions: [{ submission: { guardianName: "보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER" } }],
      children: [{ child: { id: "child-1", name: "아이", birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: "다른 보호자", guardianPhone: "010-0000-0000" } }],
    });
    await expect(listOwnedRepeatChildrenCore({ applicationDevice: { findFirst } } as never, { token: "opaque-device", now: new Date("2026-10-06") })).resolves.toEqual({ guardian: { guardianName: "보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER" }, children: [] });
  });
});
