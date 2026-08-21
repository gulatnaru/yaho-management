import { describe, expect, it } from "vitest";
import { buildChildListWhere } from "@/lib/children/query-builder";

describe("buildChildListWhere", () => {
  it("filters isActive: true for status active", () => {
    expect(buildChildListWhere({ status: "active" })).toEqual({ isActive: true });
  });

  it("filters isActive: false for status inactive", () => {
    expect(buildChildListWhere({ status: "inactive" })).toEqual({ isActive: false });
  });

  it("has no isActive filter for status all", () => {
    expect(buildChildListWhere({ status: "all" })).toEqual({});
  });

  it("adds an OR search on name/guardianPhone when q is provided", () => {
    const where = buildChildListWhere({ status: "all", q: "김하윤" });
    expect(where.OR).toEqual([
      { name: { contains: "김하윤", mode: "insensitive" } },
      { guardianPhone: { contains: "김하윤", mode: "insensitive" } },
    ]);
  });

  it("ignores a blank q", () => {
    const where = buildChildListWhere({ status: "all", q: "   " });
    expect(where.OR).toBeUndefined();
  });

  it("combines a status filter and a q search", () => {
    const where = buildChildListWhere({ status: "active", q: "010" });
    expect(where.isActive).toBe(true);
    expect(where.OR).toBeDefined();
  });

  it("filters by an exact birthDate when a valid YYYY-MM-DD is provided", () => {
    const where = buildChildListWhere({ status: "all", birthDate: "2018-05-01" });
    expect(where.birthDate).toEqual(new Date("2018-05-01"));
  });

  it("ignores an invalid birthDate string without throwing", () => {
    const where = buildChildListWhere({ status: "all", birthDate: "not-a-date" });
    expect(where.birthDate).toBeUndefined();
  });

  it("ignores a blank birthDate", () => {
    const where = buildChildListWhere({ status: "all", birthDate: "   " });
    expect(where.birthDate).toBeUndefined();
  });
});
