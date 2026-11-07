import { describe, expect, it } from "vitest";
import { PrismaDispatchRepository, type PrismaGuardClient, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";
import { consumeSyntheticNonce } from "@/server/kakao/runtime-settings";
function fakeCounter(failAudit = false, recoveryVerified = true) {
  let counter = 0n;
  let tail = Promise.resolve();
  const client: PrismaGuardClient = { async $transaction<T>(work: (tx: PrismaGuardTransaction) => Promise<T>): Promise<T> {
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await previous;
    let candidate = counter;
    const tx: PrismaGuardTransaction = {
      async $queryRaw<T>(): Promise<T> { return [{ keyVersion: "synthetic_key_v1", nonceHighWater: candidate, nonceCurrent: true, recoveryVerified, rotationComplete: true }] as T; },
      async $executeRaw(strings, ...values): Promise<number> {
        if (strings[0].includes("UPDATE")) candidate = values[0] as bigint;
        if (strings[0].includes("INSERT") && failAudit) throw new Error("audit failure");
        return 1;
      },
    };
    try { const result = await work(tx); counter = candidate; return result; } finally { release(); }
  } };
  return { repository: new PrismaDispatchRepository(client), read: () => counter };
}
describe("synthetic nonce transaction contract", () => {
  const input = { keyVersion: "synthetic_key_v1", at: new Date("2026-10-28T00:00:00Z") };
  it("commits distinct counters before a subsequent operation", async () => {
    const fake = fakeCounter(); const values = await Promise.all([consumeSyntheticNonce(fake.repository, input), consumeSyntheticNonce(fake.repository, input)]);
    expect(values).toEqual([1n, 2n]); expect(fake.read()).toBe(2n);
  });
  it("returns no nonce and rolls back on audit failure", async () => {
    const fake = fakeCounter(true); await expect(consumeSyntheticNonce(fake.repository, input)).rejects.toThrow(); expect(fake.read()).toBe(0n);
  });
  it("blocks recovery without current counter evidence", async () => {
    const fake = fakeCounter(false, false); await expect(consumeSyntheticNonce(fake.repository, input)).rejects.toThrow(); expect(fake.read()).toBe(0n);
  });
});
