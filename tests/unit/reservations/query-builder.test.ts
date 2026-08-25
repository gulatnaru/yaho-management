import { describe, expect, it } from "vitest";
import { buildReservationListWhere, parseReservationListStatus } from "@/lib/reservations/query-builder";

describe("buildReservationListWhere", () => {
  it("has no filters when nothing is provided", () => {
    expect(buildReservationListWhere({})).toEqual({});
  });

  it("filters by status only", () => {
    expect(buildReservationListWhere({ status: "CANCELLED" })).toEqual({ status: "CANCELLED" });
  });

  it("has no status filter for status 'all'", () => {
    expect(buildReservationListWhere({ status: "all" })).toEqual({});
  });

  it("filters by childName via a case-insensitive contains on child.name", () => {
    const where = buildReservationListWhere({ childName: "홍길동" });
    expect(where.child).toEqual({ name: { contains: "홍길동", mode: "insensitive" } });
  });

  it("filters by programName via a case-insensitive contains on classSchedule.program.name", () => {
    const where = buildReservationListWhere({ programName: "발레" });
    expect(where.classSchedule).toEqual({ program: { name: { contains: "발레", mode: "insensitive" } } });
  });

  it("filters by dateFrom only (gte KST midnight) on classSchedule.startsAt", () => {
    const where = buildReservationListWhere({ dateFrom: "2026-09-05" });
    expect(where.classSchedule).toEqual({ startsAt: { gte: new Date("2026-09-04T15:00:00.000Z") } });
  });

  it("filters by dateTo only (lt the day after KST midnight) on classSchedule.startsAt", () => {
    const where = buildReservationListWhere({ dateTo: "2026-09-05" });
    expect(where.classSchedule).toEqual({ startsAt: { lt: new Date("2026-09-05T15:00:00.000Z") } });
  });

  it("combines programName and date range under classSchedule", () => {
    const where = buildReservationListWhere({
      programName: "발레",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-05",
    });
    expect(where.classSchedule).toEqual({
      program: { name: { contains: "발레", mode: "insensitive" } },
      startsAt: {
        gte: new Date("2026-08-31T15:00:00.000Z"),
        lt: new Date("2026-09-05T15:00:00.000Z"),
      },
    });
  });

  it("combines childName, programName, date range, and status filters", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const where = buildReservationListWhere(
      {
        childName: "홍길동",
        programName: "발레",
        dateFrom: "2026-09-01",
        dateTo: "2026-09-05",
        status: "RESERVED",
      },
      now,
    );
    expect(where.status).toBe("RESERVED");
    expect(where.child).toEqual({ name: { contains: "홍길동", mode: "insensitive" } });
    expect(where.classSchedule).toEqual({
      program: { name: { contains: "발레", mode: "insensitive" } },
      startsAt: {
        gte: new Date("2026-08-31T15:00:00.000Z"),
        lt: new Date("2026-09-05T15:00:00.000Z"),
      },
      endsAt: { gte: now },
    });
  });
});

describe("display-status-aware RESERVED/COMPLETED filtering", () => {
  const now = new Date("2026-09-10T00:00:00.000Z");

  it("status=RESERVED filters to DB status RESERVED and classSchedule.endsAt >= now", () => {
    const where = buildReservationListWhere({ status: "RESERVED" }, now);
    expect(where).toEqual({ status: "RESERVED", classSchedule: { endsAt: { gte: now } } });
  });

  it("status=COMPLETED includes recorded completions and past unrecorded reservations", () => {
    const where = buildReservationListWhere({ status: "COMPLETED" }, now);
    expect(where).toEqual({
      OR: [
        { status: "COMPLETED" },
        { status: "RESERVED", classSchedule: { endsAt: { lt: now } } },
      ],
    });
  });

  it("status=CANCELLED has no endsAt condition and no classSchedule filter", () => {
    const where = buildReservationListWhere({ status: "CANCELLED" }, now);
    expect(where).toEqual({ status: "CANCELLED" });
    expect(where.classSchedule).toBeUndefined();
  });

  it("status=NO_SHOW has no endsAt condition and no classSchedule filter", () => {
    const where = buildReservationListWhere({ status: "NO_SHOW" }, now);
    expect(where).toEqual({ status: "NO_SHOW" });
    expect(where.classSchedule).toBeUndefined();
  });

  it("status=all has no status/endsAt condition and no classSchedule filter", () => {
    const where = buildReservationListWhere({ status: "all" }, now);
    expect(where).toEqual({});
    expect(where.classSchedule).toBeUndefined();
  });

  it("merges endsAt condition with an existing programName classSchedule filter", () => {
    const where = buildReservationListWhere({ status: "COMPLETED", programName: "발레" }, now);
    expect(where.classSchedule).toEqual({
      program: { name: { contains: "발레", mode: "insensitive" } },
    });
    expect(where.OR).toEqual([
      { status: "COMPLETED" },
      { status: "RESERVED", classSchedule: { endsAt: { lt: now } } },
    ]);
  });

  it("defaults now to the current time when not provided", () => {
    const before = new Date();
    const where = buildReservationListWhere({ status: "RESERVED" });
    const after = new Date();
    const classSchedule = where.classSchedule as { endsAt: { gte: Date } };
    expect(classSchedule.endsAt.gte.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(classSchedule.endsAt.gte.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("parseReservationListStatus", () => {
  it("returns 'all' as-is when status=all (regression: must not fall back to RESERVED)", () => {
    expect(parseReservationListStatus("all")).toBe("all");
  });

  it("defaults to 'RESERVED' when no value is provided", () => {
    expect(parseReservationListStatus(undefined)).toBe("RESERVED");
  });

  it("returns 'CANCELLED' as-is", () => {
    expect(parseReservationListStatus("CANCELLED")).toBe("CANCELLED");
  });

  it("returns 'COMPLETED' as-is", () => {
    expect(parseReservationListStatus("COMPLETED")).toBe("COMPLETED");
  });

  it("returns 'NO_SHOW' as-is", () => {
    expect(parseReservationListStatus("NO_SHOW")).toBe("NO_SHOW");
  });

  it("returns 'RESERVED' as-is", () => {
    expect(parseReservationListStatus("RESERVED")).toBe("RESERVED");
  });

  it("falls back to 'RESERVED' for an unknown value", () => {
    expect(parseReservationListStatus("foo")).toBe("RESERVED");
  });
});
