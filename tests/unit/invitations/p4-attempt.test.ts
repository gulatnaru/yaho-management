import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ created: false, failUpdate: false, writes: [] as Record<string, unknown>[] }));
vi.mock("@/lib/invitations/config", () => ({ deliveryConfig: () => ({ kind: "fake", origin: "https://example.test" }) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  adminInvitation: { findUniqueOrThrow: async () => ({ email: "recipient@example.test", expiresAt: new Date() }) },
  invitationDeliveryAttempt: {
    create: async () => { if (state.created) throw { code: "P2002" }; state.created = true; return { id: "attempt" }; },
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }: { data: Record<string, unknown> }) => { if (state.failUpdate) throw new Error("database unavailable"); state.writes.push(data); },
  },
} }));
import { deliverIssuedInvitation } from "@/server/accounts/invitation-delivery";

beforeEach(() => { state.created = false; state.failUpdate = false; state.writes = []; });
it("allows only one adapter call for concurrent duplicate delivery requests", async () => {
  const sendInvitation = vi.fn(async () => ({ status: "FAILED" as const, errorCategory: "LIMIT" }));
  const issued = { invitationId: "invitation", targetUserId: "target", token: crypto.randomUUID() };
  await Promise.all([deliverIssuedInvitation(issued, { sendInvitation }), deliverIssuedInvitation(issued, { sendInvitation })]);
  expect(sendInvitation).toHaveBeenCalledTimes(1);
  expect(state.writes[0].status).toBe("FAILED");
  expect(JSON.stringify(state.writes)).not.toContain(issued.token);
});
it("classifies thrown transport errors as unknown without retry", async () => {
  const sendInvitation = vi.fn(async () => { throw new Error("timeout"); });
  const result = await deliverIssuedInvitation({ invitationId: "invitation", targetUserId: "target", token: crypto.randomUUID() }, { sendInvitation });
  expect(result).toBe("UNKNOWN"); expect(sendInvitation).toHaveBeenCalledTimes(1);
});

it("a result-record failure remains unknown and never repeats the send", async () => {
  state.failUpdate = true;
  const sendInvitation = vi.fn(async () => ({ status: "ACCEPTED" as const, providerMessageId: "message" }));
  const result = await deliverIssuedInvitation({ invitationId: "invitation", targetUserId: "target", token: crypto.randomUUID() }, { sendInvitation });
  expect(result).toBe("UNKNOWN");
  expect(sendInvitation).toHaveBeenCalledTimes(1);
});
