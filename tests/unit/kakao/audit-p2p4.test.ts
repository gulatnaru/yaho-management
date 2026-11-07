import { describe, expect, it, vi } from "vitest";
import { appendNotificationAudit } from "@/server/kakao/audit";

describe("notification audit", () => {
  it("uses the supplied transaction and rejects extra sensitive fields", async () => {
    const create = vi.fn().mockResolvedValue({});
    const event = { eventId: "event_1", environment: "preview", eventType: "permit_issued", occurredAt: new Date(), dispatchId: "dispatch_1", slotId: "slot_1" };
    await appendNotificationAudit({ notificationAudit: { create } }, event);
    expect(create).toHaveBeenCalledOnce();
    await expect(appendNotificationAudit({ notificationAudit: { create } }, { ...event, amount: 15000 })).rejects.toThrow();
    expect(create).toHaveBeenCalledOnce();
  });
  it("propagates transaction storage failure", async () => {
    const create = vi.fn().mockRejectedValue(new Error("write failed"));
    await expect(appendNotificationAudit({ notificationAudit: { create } }, { eventId: "event_1", environment: "preview", eventType: "permit_issued", occurredAt: new Date() })).rejects.toThrow("write failed");
  });
});
