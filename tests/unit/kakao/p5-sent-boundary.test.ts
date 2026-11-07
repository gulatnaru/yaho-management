import { describe, expect, it, vi } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";

describe("P5 sent boundary", () => {
  it("rejects a missing reference and a reference without a committed dispatch", async () => {
    const store = new InMemoryOutboxStore();
    const at = new Date("2026-10-28T00:00:00Z");
    const input = buildOutboxInput("application.received", `c${"1".repeat(24)}`, "created", "admin", at);
    await store.enqueue(input);
    const [row] = await store.claimDue(1, at);
    await expect(store.markSent(row.id, row.claimToken!)).rejects.toThrow();
    await expect(store.markSent(row.id, row.claimToken!, `g2ref_${"a".repeat(32)}`)).rejects.toThrow();
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", providerRef: null, claimToken: row.claimToken });
  });
  it("never calls a legacy provider without a dispatch permit", async () => {
    const store = new InMemoryOutboxStore();
    const at = new Date("2026-10-28T00:00:00Z");
    await store.enqueue(buildOutboxInput("application.received", `c${"2".repeat(24)}`, "created", "admin", at));
    const send = vi.fn(async () => ({ status: "sent" as const }));
    await processOutboxBatch(store, { provider: { send }, isProviderConfigured: true, now: at });
    expect(send).not.toHaveBeenCalled();
  });
});
