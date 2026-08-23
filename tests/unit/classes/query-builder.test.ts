import { describe, expect, it } from "vitest";
import { buildClassListWhere, parseClassListStatus } from "@/lib/classes/query-builder";

describe("buildClassListWhere", () => {
  it("has no filters when nothing is provided", () => {
    expect(buildClassListWhere({})).toEqual({});
  });

  it("filters by status only", () => {
    expect(buildClassListWhere({ status: "CANCELLED" })).toEqual({ status: "CANCELLED" });
  });

  it("has no status filter for status 'all'", () => {
    expect(buildClassListWhere({ status: "all" })).toEqual({});
  });

  it("filters by dateFrom only (gte KST midnight)", () => {
    const where = buildClassListWhere({ dateFrom: "2026-09-05" });
    expect(where.startsAt).toEqual({ gte: new Date("2026-09-04T15:00:00.000Z") });
  });

  it("filters by dateTo only (lt the day after KST midnight)", () => {
    const where = buildClassListWhere({ dateTo: "2026-09-05" });
    expect(where.startsAt).toEqual({ lt: new Date("2026-09-05T15:00:00.000Z") });
  });

  it("filters by both dateFrom and dateTo", () => {
    const where = buildClassListWhere({ dateFrom: "2026-09-01", dateTo: "2026-09-05" });
    expect(where.startsAt).toEqual({
      gte: new Date("2026-08-31T15:00:00.000Z"),
      lt: new Date("2026-09-05T15:00:00.000Z"),
    });
  });

  it("combines date range and status filters", () => {
    const where = buildClassListWhere({ dateFrom: "2026-09-01", dateTo: "2026-09-05", status: "SCHEDULED" });
    expect(where.status).toBe("SCHEDULED");
    expect(where.startsAt).toEqual({
      gte: new Date("2026-08-31T15:00:00.000Z"),
      lt: new Date("2026-09-05T15:00:00.000Z"),
    });
  });

  describe("display-status-aware SCHEDULED/COMPLETED filtering", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");

    it("status=SCHEDULED filters to DB status SCHEDULED and endsAt >= now", () => {
      const where = buildClassListWhere({ status: "SCHEDULED" }, now);
      expect(where).toEqual({ status: "SCHEDULED", endsAt: { gte: now } });
    });

    it("status=COMPLETED filters to DB status SCHEDULED and endsAt < now", () => {
      const where = buildClassListWhere({ status: "COMPLETED" }, now);
      expect(where).toEqual({ status: "SCHEDULED", endsAt: { lt: now } });
    });

    it("status=CANCELLED has no endsAt condition", () => {
      const where = buildClassListWhere({ status: "CANCELLED" }, now);
      expect(where).toEqual({ status: "CANCELLED" });
      expect(where.endsAt).toBeUndefined();
    });

    it("status=all has no status or endsAt condition", () => {
      const where = buildClassListWhere({ status: "all" }, now);
      expect(where).toEqual({});
      expect(where.endsAt).toBeUndefined();
    });

    it("defaults now to the current time when not provided", () => {
      const before = new Date();
      const where = buildClassListWhere({ status: "SCHEDULED" });
      const after = new Date();
      const gte = (where.endsAt as { gte: Date }).gte;
      expect(gte.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(gte.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});

describe("parseClassListStatus", () => {
  it("returns 'all' as-is when status=all (regression: must not fall back to SCHEDULED)", () => {
    expect(parseClassListStatus("all")).toBe("all");
  });

  it("defaults to 'SCHEDULED' when no value is provided", () => {
    expect(parseClassListStatus(undefined)).toBe("SCHEDULED");
  });

  it("returns 'CANCELLED' as-is", () => {
    expect(parseClassListStatus("CANCELLED")).toBe("CANCELLED");
  });

  it("returns 'COMPLETED' as-is", () => {
    expect(parseClassListStatus("COMPLETED")).toBe("COMPLETED");
  });

  it("returns 'SCHEDULED' as-is", () => {
    expect(parseClassListStatus("SCHEDULED")).toBe("SCHEDULED");
  });

  it("falls back to 'SCHEDULED' for an unknown value", () => {
    expect(parseClassListStatus("foo")).toBe("SCHEDULED");
  });
});
