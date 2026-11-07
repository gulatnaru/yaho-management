import { describe, expect, it, vi } from "vitest";
import { stopNewSends } from "@/server/kakao/block-action-service";
import type { BlockTransaction, RuntimeRepository } from "@/server/kakao/runtime-settings";
const input = { actorId: "admin", reason: "operator_stop" };
describe("stop action", () => {
  it("does not issue a command when already blocked", async () => {
    const transaction = vi.fn();
    expect(await stopNewSends(input, { read: async () => ({ blocked: true, revision: 3 }), repository: { transaction } })).toBe("already_blocked");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("reports revision race separately and never treats audit failure as success", async () => {
    const repo = (message: string) => ({ transaction: async () => { throw new Error(message); } }) as RuntimeRepository;
    const read = vi.fn().mockResolvedValueOnce({ blocked: false, revision: 1 }).mockResolvedValueOnce({ blocked: true, revision: 2 });
    expect(await stopNewSends(input, { read, repository: repo("Runtime revision conflict.") })).toBe("conflict_blocked");
    expect(await stopNewSends(input, { read: async () => ({ blocked: false, revision: 1 }), repository: repo("Audit failure") })).toBe("failed");
  });
  it("commits once and makes the next explicit click a no-op", async () => {
    let state = { blocked: false, revision: 0, audits: 0 };
    const repository: RuntimeRepository = { async transaction<T>(fn: (tx: BlockTransaction) => Promise<T>) {
      const next = { ...state };
      const result = await fn({ getRuntimeForUpdate: async () => ({ environment: "preview", blocked: next.blocked, revision: next.revision }),
        getActiveAdminForUpdate: async () => ({ role: "ADMIN", isActive: true, mustChangePassword: false }), getCommand: async () => null,
        updateRuntimeBlock: async () => { next.blocked = true; next.revision++; }, notificationAudit: { create: async () => { next.audits++; } } });
      state = next; return result;
    } };
    const deps = { read: async () => ({ blocked: state.blocked, revision: state.revision }), repository, newId: () => "synthetic-command" };
    expect(await stopNewSends(input, deps)).toBe("blocked");
    expect(await stopNewSends(input, deps)).toBe("already_blocked");
    expect(state).toEqual({ blocked: true, revision: 1, audits: 1 });
  });
  it("shows a concurrent block separately when two reads see the same revision", async () => {
    let state = { blocked: false, revision: 0, audits: 0 };
    let tail = Promise.resolve();
    const repository: RuntimeRepository = { async transaction<T>(fn: (tx: BlockTransaction) => Promise<T>) {
      const prior = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; });
      await prior; const next = { ...state };
      try {
        const result = await fn({ getRuntimeForUpdate: async () => ({ environment: "preview", blocked: next.blocked, revision: next.revision }),
          getActiveAdminForUpdate: async () => ({ role: "ADMIN", isActive: true, mustChangePassword: false }), getCommand: async () => null,
          updateRuntimeBlock: async () => { next.blocked = true; next.revision++; }, notificationAudit: { create: async () => { next.audits++; } } });
        state = next; return result;
      } finally { release(); }
    } };
    let reads = 0; let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
    const read = async () => {
      const snapshot = { blocked: state.blocked, revision: state.revision };
      if (++reads <= 2) { if (reads === 2) releaseReads(); await bothRead; }
      return snapshot;
    };
    let commands = 0;
    const deps = { read, repository, newId: () => `synthetic-${++commands}` };
    expect((await Promise.all([stopNewSends(input, deps), stopNewSends(input, deps)])).sort()).toEqual(["blocked", "conflict_blocked"]);
    expect(state).toEqual({ blocked: true, revision: 1, audits: 1 });
  });
});
