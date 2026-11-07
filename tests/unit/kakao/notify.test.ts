import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDedupeKey, eventSchema } from "@/lib/kakao/notify";

describe("buildDedupeKey", () => {
  it("is deterministic and opaque: same input gives the same key, raw ids never appear in it", () => {
    const entityId = `phase8_${randomUUID()}`;
    const first = buildDedupeKey("application.received", entityId, "created");
    expect(first).toBe(buildDedupeKey("application.received", entityId, "created"));
    expect(first).toMatch(/^application\.received:[a-f0-9]{64}$/);
    expect(first).not.toContain(entityId);
  });

  it("changes with entity or occasion", () => {
    const entityId = `phase8_${randomUUID()}`;
    const base = buildDedupeKey("application.received", entityId, "created");
    expect(buildDedupeKey("application.received", entityId, "updated")).not.toBe(base);
    expect(buildDedupeKey("application.received", `phase8_${randomUUID()}`, "created")).not.toBe(base);
    expect(buildDedupeKey("application.confirmed", entityId, "created")).not.toBe(base);
  });

  it("rejects invalid input", () => {
    const entityId = `phase8_${randomUUID()}`;
    expect(() => buildDedupeKey("application.received", "", "created")).toThrow("Invalid notification dedupe input.");
    expect(() => buildDedupeKey("application.received", "   ", "created")).toThrow("Invalid notification dedupe input.");
    expect(() => buildDedupeKey("application.received", entityId, "")).toThrow("Invalid notification dedupe input.");
    expect(() => buildDedupeKey("application.unknown" as never, entityId, "created")).toThrow("Invalid notification dedupe input.");
  });
});

describe("eventSchema", () => {
  it("accepts the four known events and rejects the rest", () => {
    expect(eventSchema.safeParse("application.received").success).toBe(true);
    expect(eventSchema.safeParse("application.confirmed").success).toBe(true);
    expect(eventSchema.safeParse("application.changed").success).toBe(true);
    expect(eventSchema.safeParse("application.cancelled").success).toBe(true);
    expect(eventSchema.safeParse("application.sent").success).toBe(false);
  });
});
