import { describe, expect, it } from "vitest";
import { buildTeacherListWhere } from "@/lib/teachers/query-builder";

describe("buildTeacherListWhere", () => {
  it("filters isActive: true for status active", () => {
    expect(buildTeacherListWhere({ status: "active" })).toEqual({ isActive: true });
  });

  it("filters isActive: false for status inactive", () => {
    expect(buildTeacherListWhere({ status: "inactive" })).toEqual({ isActive: false });
  });

  it("has no isActive filter for status all", () => {
    expect(buildTeacherListWhere({ status: "all" })).toEqual({});
  });

  it("adds a name contains condition when q is provided", () => {
    const where = buildTeacherListWhere({ status: "all", q: "김선생" });
    expect(where.name).toEqual({ contains: "김선생", mode: "insensitive" });
  });

  it("ignores a blank q", () => {
    const where = buildTeacherListWhere({ status: "all", q: "   " });
    expect(where.name).toBeUndefined();
  });

  it("combines a status filter and a q search", () => {
    const where = buildTeacherListWhere({ status: "active", q: "김" });
    expect(where.isActive).toBe(true);
    expect(where.name).toEqual({ contains: "김", mode: "insensitive" });
  });
});
