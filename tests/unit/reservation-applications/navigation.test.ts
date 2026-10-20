import { describe, expect, it } from "vitest";
import { familyDetailHref, familyListHref, familyReturnHref, parseFamilyFilters } from "@/lib/reservation-applications/navigation";
describe("family navigation", () => {
  it("round trips only allowlisted context and a stable family anchor", () => {
    const input = { status: "all", page: "3", classScheduleId: "class-1", notification: "received", bankRecord: "recorded", returnTo: "https://evil.test", guardianPhone: "private", amount: "999" };
    expect(familyReturnHref("submission", "s1", input)).toBe("/reservation-applications?status=all&classScheduleId=class-1&notification=received&bankRecord=recorded&page=3#family-submission-s1");
    expect(familyDetailHref("legacy", "a1", input)).toBe("/reservation-applications/a1?status=all&classScheduleId=class-1&notification=received&bankRecord=recorded&page=3");
  });
  it.each(["2x", "-1", "0", "Infinity", ["2", "3"], "1.5", "9007199254740992"])("rejects invalid page %s", (page) => expect(parseFamilyFilters({ page }).page).toBe(1));
  it("rejects injected ids, arrays and anchors and ignores arbitrary return URLs", () => {
    expect(familyListHref({ classScheduleId: "//evil.test", status: ["all"], returnTo: "/evil" }, "family-legacy-x#evil")).toBe("/reservation-applications");
  });
  it("omitting page on filter submit resets to one", () => expect(parseFamilyFilters({ status: "CONFIRMED" }).page).toBe(1));
});
