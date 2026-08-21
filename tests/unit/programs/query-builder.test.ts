import { describe, expect, it } from "vitest";
import { buildProgramListWhere } from "@/lib/programs/query-builder";

describe("buildProgramListWhere", () => {
  it("filters status: ACTIVE for status active", () => {
    expect(buildProgramListWhere({ status: "active" })).toEqual({ status: "ACTIVE" });
  });

  it("filters status: INACTIVE for status inactive", () => {
    expect(buildProgramListWhere({ status: "inactive" })).toEqual({ status: "INACTIVE" });
  });

  it("has no status filter for status all", () => {
    expect(buildProgramListWhere({ status: "all" })).toEqual({});
  });

  it("adds a name contains condition when q is provided", () => {
    const where = buildProgramListWhere({ status: "all", q: "발레" });
    expect(where.name).toEqual({ contains: "발레", mode: "insensitive" });
  });

  it("ignores a blank q", () => {
    const where = buildProgramListWhere({ status: "all", q: "   " });
    expect(where.name).toBeUndefined();
  });

  it("combines a status filter and a q search", () => {
    const where = buildProgramListWhere({ status: "active", q: "발레" });
    expect(where.status).toBe("ACTIVE");
    expect(where.name).toEqual({ contains: "발레", mode: "insensitive" });
  });
});
