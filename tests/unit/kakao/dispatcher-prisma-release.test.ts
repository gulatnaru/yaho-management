import { describe, expect, it, vi } from "vitest";
import { PrismaOutboxStore, type OutboxDbClient } from "@/lib/kakao/outbox-store";

function setup(state: string | null, slots = 0, owned = true) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const write = vi.fn(async () => 1);
  const tx = {
    notificationOutbox: { updateMany },
    $executeRaw: write,
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "NotificationRuntimeConfig"')) return [{ environment: "preview" }];
      if (sql.includes('FROM "NotificationOutbox"')) return owned ? [{ id: "row" }] : [];
      if (sql.includes('FROM "NotificationDispatch"')) return state ? [{ id: "dispatch", reconciliationState: state, auditSequence: 1 }] : [];
      if (sql.includes('FROM "NotificationCostReservation"')) return Array.from({ length: slots }, () => ({ id: "slot" }));
      throw new Error("Unexpected query");
    }),
  };
  const db = { $transaction: async (work: (value: typeof tx) => Promise<void>) => work(tx) } as unknown as OutboxDbClient;
  return { store: new PrismaOutboxStore(db), updateMany, write };
}

describe("Prisma unissued claim release with a fake transaction", () => {
  it.each([null, "ready", "rejected"])("releases only the fenced unissued claim in state %s", async (state) => {
    const { store, updateMany, write } = setup(state);
    await store.releaseUnissued("row", "claim", new Date(0));
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "row", status: "processing", claimToken: "claim" }, data: { status: "pending", claimToken: null, leaseExpiresAt: null } });
    expect(write).toHaveBeenCalledTimes(state ? 2 : 1);
  });
  it.each([["unknown", 0, true], ["ready", 1, true], ["ready", 0, false]] as const)("refuses unsafe release", async (state, slots, owned) => {
    const { store, updateMany } = setup(state, slots, owned);
    await expect(store.releaseUnissued("row", "claim", new Date(0))).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
