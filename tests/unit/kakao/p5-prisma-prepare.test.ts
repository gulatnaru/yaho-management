import { describe, expect, it, vi } from "vitest";
import { PrismaDispatchRepository, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";
import { preparePrismaDispatch } from "@/server/kakao/dispatch-prepare";

const at = new Date("2026-10-28T00:00:00Z");
function fake(purged: boolean) {
  const execute = vi.fn(async () => 1);
  const tx: PrismaGuardTransaction = {
    $executeRaw: execute,
    async $queryRaw<T>(strings: TemplateStringsArray): Promise<T> {
      const sql = strings.join("?");
      if (sql.includes('FROM "NotificationRuntimeConfig"')) return [{ namespace: "preview_g2", policyVersion: "g2-v1" }] as T;
      if (sql.includes('FROM "NotificationOutbox"')) return [{ id: "o1", eventKind: "application.received", audience: "admin", entityId: "submission1", dedupeKey: `application.received:${"a".repeat(64)}` }] as T;
      if (sql.includes('FROM "NotificationDispatch"')) return [] as T;
      if (sql.includes('FROM "ReservationApplicationSubmission"')) return [{ id: "submission1", submittedAt: at, personalDataPurgedAt: purged ? at : null }] as T;
      if (sql.includes('FROM "NotificationRecipientRegistration"') && sql.includes('SELECT "id", "version"')) return [{ id: "r1", version: "v1", userId: "u1" }] as T;
      if (sql.includes('FROM "NotificationRecipientRegistration"')) return [{ id: "r1" }] as T;
      if (sql.includes('FROM "User"')) return [{ role: "ADMIN", isActive: true, mustChangePassword: false }] as T;
      throw new Error("Unexpected synthetic query.");
    },
  };
  return { repository: new PrismaDispatchRepository({ $transaction: async (work) => work(tx) }), execute };
}
describe("synthetic Prisma dispatch preparation", () => {
  it("creates a fixed dispatch from minimal submission fields", async () => {
    const { repository, execute } = fake(false);
    const result = await preparePrismaDispatch(repository, { rowId: "o1", claimToken: "claim1" });
    expect(result?.context).toMatchObject({ recipientId: "r1", recipientVersion: "v1", submittedAt: at });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not create a dispatch after submission data is purged", async () => {
    const { repository, execute } = fake(true);
    expect(await preparePrismaDispatch(repository, { rowId: "o1", claimToken: "claim1" })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
