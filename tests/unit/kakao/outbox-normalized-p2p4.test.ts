import { describe, expect, it } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
const at = new Date("2026-10-28T00:00:00Z");
async function claimed() {
  const db = new InMemoryOutboxStore();
  await db.enqueue(buildOutboxInput("application.received", `c${"1".repeat(24)}`, "created", "admin", at));
  const [row] = await db.claimDue(1, at); if (!row.claimToken) throw new Error("claim missing");
  return { db, row, token: row.claimToken };
}
describe("normalized outbox data", () => {
  it("rejects a validated reference when no dispatch slot exists", async () => {
    const { db, row, token } = await claimed(); const ref = `g2ref_${"a".repeat(32)}`;
    await expect(db.markSent(row.id, token, ref)).rejects.toThrow();
    expect(await db.findByDedupeKey(row.dedupeKey)).toMatchObject({ status: "processing", providerRef: null });
  });
  it("preserves unknown as terminal and rejects a retry timestamp", async () => {
    const { db, row, token } = await claimed();
    await expect(db.markFailed(row.id, token, "provider_result_unknown", at)).rejects.toThrow();
    expect(await db.markFailed(row.id, token, "provider_result_unknown", null)).toMatchObject({ status: "failed", nextRetryAt: null, lastErrorCode: "provider_result_unknown" });
  });
  it("stores only approved skip codes", async () => {
    const { db, row, token } = await claimed();
    expect(await db.markSkipped(row.id, token, "event_expired")).toMatchObject({ status: "skipped", lastErrorCode: "event_expired" });
  });
});
