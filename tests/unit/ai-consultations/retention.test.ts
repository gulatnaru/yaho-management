import { describe, it, expect, vi } from "vitest";
import { claim } from "@/server/ai-consultations/ledger";
import {
  purgeExpired,
  runRetentionCycle,
} from "@/server/ai-consultations/retention";
import { RETENTION_MS } from "@/lib/ai-consultations/contracts";
import { scope, skill, keys, limits, memoryClient } from "./fixtures";
describe("AC21-09/10/11 own-run retention", () => {
  it("90d exact boundary deletes only owned expired raw and identifiers, preserving aggregates", async () => {
    const db = memoryClient();
    const now = new Date();
    await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(now.getTime() - RETENTION_MS),
    );
    await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(now.getTime() - RETENTION_MS + 1),
    );
    db.state.consultations.push({
      ...db.state.consultations[0],
      id: "foreign",
      runId: "foreign-run",
    });
    db.state.metrics.push({
      day: new Date(),
      category: "PROGRAMS",
      count: 20,
      modelCalls: 3,
      syntheticCost: 0,
    });
    const metrics = structuredClone(db.state.metrics);
    const result = await purgeExpired(db.client, scope, now);
    expect(result).toEqual({ deleted: 1, status: "SUCCEEDED" });
    expect(db.state.consultations).toHaveLength(2);
    expect(db.state.consultations.some((x) => x.id === "foreign")).toBe(true);
    expect(db.state.metrics).toEqual(metrics);
    expect(JSON.stringify(db.state.metrics)).not.toMatch(
      /subjectHashes|runId|question|requestKey/,
    );
    expect((await purgeExpired(db.client, scope, now)).deleted).toBe(0);
  });
  it("failure rolls back deletion and exposes only fixed status, bounded retry restores", async () => {
    const db = memoryClient();
    const now = new Date();
    await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(now.getTime() - RETENTION_MS),
    );
    db.setFailDelete(true);
    expect(await purgeExpired(db.client, scope, now)).toEqual({
      deleted: 0,
      status: "FAILED",
    });
    expect(db.state.consultations).toHaveLength(1);
    expect(JSON.stringify(db.state.jobs)).not.toContain(
      "RAW_SENSITIVE_DB_FAILURE",
    );
    expect(await runRetentionCycle(db.client, scope, () => new Date())).toEqual(
      { deleted: 0, status: "WAITING" },
    );
    db.setFailDelete(false);
    expect(
      (
        await runRetentionCycle(
          db.client,
          scope,
          () => new Date(Date.now() + 61000),
        )
      ).status,
    ).toBe("SUCCEEDED");
    expect(db.state.consultations).toHaveLength(0);
  });
  it("revoked run cannot purge even when rows have expired", async () => {
    const db = memoryClient();
    await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(Date.now() - RETENTION_MS),
    );
    db.revoke();
    expect((await purgeExpired(db.client, scope, new Date())).status).toBe(
      "FAILED",
    );
    expect(db.state.consultations).toHaveLength(1);
  });
  it("overlapping job executions delete each row once", async () => {
    const db = memoryClient();
    await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(Date.now() - RETENTION_MS),
    );
    const result = await Promise.all([
      purgeExpired(db.client, scope, new Date()),
      purgeExpired(db.client, scope, new Date()),
    ]);
    expect(result.reduce((sum, x) => sum + x.deleted, 0)).toBe(1);
    expect(db.state.jobs[0].deletedCount).toBe(1);
  });
});

import { syntheticRetentionScheduler } from "@/server/ai-consultations/synthetic-scheduler";
it("synthetic scheduler automatically processes expiry and stops without deployed cron", async () => {
  vi.useFakeTimers();
  try {
    const db = memoryClient();
    await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(Date.now() - RETENTION_MS),
    );
    const scheduler = syntheticRetentionScheduler(
      db.client,
      scope,
      () => new Date(),
      1000,
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.state.consultations).toHaveLength(0);
    expect(db.state.jobs[0].status).toBe("SUCCEEDED");
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
