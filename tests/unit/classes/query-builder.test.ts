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
