import { describe, expect, it } from "vitest";
import { blockNewSends, type BlockTransaction, type RuntimeRepository } from "@/server/kakao/runtime-settings";

function repository(failAudit = false): RuntimeRepository & { snapshot(): { blocked: boolean; revision: number; audits: number } } {
  let state = { blocked: false, revision: 0, audits: 0 };
  return {
    snapshot: () => ({ ...state }),
    async transaction<T>(fn: (tx: BlockTransaction) => Promise<T>): Promise<T> {
      const next = { ...state };
      const tx: BlockTransaction = {
        getRuntimeForUpdate: async () => ({ environment: "preview", blocked: next.blocked, revision: next.revision }),
        getActiveAdminForUpdate: async () => ({ role: "ADMIN", isActive: true, mustChangePassword: false }),
        getCommand: async () => null,
        updateRuntimeBlock: async () => { next.blocked = true; next.revision++; },
        notificationAudit: { create: async () => { if (failAudit) throw new Error("audit failed"); next.audits++; } },
      };
      const result = await fn(tx); state = next; return result;
    },
  };
}
describe("block command transaction contract", () => {
  const command = { commandId: "command_1", actorId: "admin_1", reason: "operator_stop", expectedRevision: 0, at: new Date() };
  it("commits block, revision and audit together", async () => {
    const store = repository(); await blockNewSends(store, command);
    expect(store.snapshot()).toEqual({ blocked: true, revision: 1, audits: 1 });
  });
  it("leaves state unchanged if audit fails", async () => {
    const store = repository(true); await expect(blockNewSends(store, command)).rejects.toThrow();
    expect(store.snapshot()).toEqual({ blocked: false, revision: 0, audits: 0 });
  });
  it("replays the identical command with no new effect", async () => {
    let revision = 0; let audits = 0;
    const store: RuntimeRepository = { async transaction<T>(fn: (tx: BlockTransaction) => Promise<T>) {
      return fn({ getRuntimeForUpdate: async () => ({ environment: "preview", blocked: revision > 0, revision }),
        getActiveAdminForUpdate: async () => ({ role: "ADMIN", isActive: true, mustChangePassword: false }),
        getCommand: async () => audits ? { eventType: "send_blocked", actorId: command.actorId, code: command.reason, revisionBefore: 0 } : null,
        updateRuntimeBlock: async () => { revision++; }, notificationAudit: { create: async () => { audits++; } } });
    } };
    await blockNewSends(store, command); await blockNewSends(store, command);
    expect({ revision, audits }).toEqual({ revision: 1, audits: 1 });
  });
  it.each([{ role: "MANAGER", isActive: true, mustChangePassword: false }, { role: "ADMIN", isActive: false, mustChangePassword: false }, { role: "ADMIN", isActive: true, mustChangePassword: true }])("rejects changed authority before mutation", async (user) => {
    let changed = false;
    const store: RuntimeRepository = { async transaction<T>(fn: (tx: BlockTransaction) => Promise<T>) {
      return fn({ getRuntimeForUpdate: async () => ({ environment: "preview", blocked: false, revision: 0 }), getActiveAdminForUpdate: async () => user,
        getCommand: async () => null, updateRuntimeBlock: async () => { changed = true; }, notificationAudit: { create: async () => {} } });
    } };
    await expect(blockNewSends(store, command)).rejects.toThrow(); expect(changed).toBe(false);
  });
});
