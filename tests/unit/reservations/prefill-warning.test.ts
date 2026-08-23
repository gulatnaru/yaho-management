import { describe, expect, it } from "vitest";
import { resolveChildPrefillWarning, resolveClassPrefillWarning } from "@/lib/reservations/prefill-warning";

describe("resolveClassPrefillWarning", () => {
  const now = new Date("2026-09-10T00:00:00.000Z");
  const future = new Date("2026-09-11T00:00:00.000Z");
  const past = new Date("2026-09-09T00:00:00.000Z");

  it("returns a not-found message when the class does not exist", () => {
    expect(resolveClassPrefillWarning(null, now)).toBe("선택한 클래스를 찾을 수 없습니다.");
  });

  it("returns a cancelled/completed message when the class is not SCHEDULED", () => {
    expect(resolveClassPrefillWarning({ status: "CANCELLED", endsAt: future }, now)).toBe(
      "선택한 클래스는 이미 취소되었거나 완료되었습니다.",
    );
    expect(resolveClassPrefillWarning({ status: "COMPLETED", endsAt: future }, now)).toBe(
      "선택한 클래스는 이미 취소되었거나 완료되었습니다.",
    );
  });

  it("returns an ended message when SCHEDULED but endsAt is already past (ADR-026 display-ended)", () => {
    expect(resolveClassPrefillWarning({ status: "SCHEDULED", endsAt: past }, now)).toBe(
      "선택한 클래스는 이미 종료되었습니다.",
    );
  });

  it("returns a capacity-full message when SCHEDULED, not yet ended, but absent from candidates", () => {
    expect(resolveClassPrefillWarning({ status: "SCHEDULED", endsAt: future }, now)).toBe(
      "선택한 클래스는 정원이 가득 찼습니다.",
    );
  });

  it("defaults now to the current time when not provided", () => {
    const definitelyPast = new Date("2000-01-01T00:00:00.000Z");
    expect(resolveClassPrefillWarning({ status: "SCHEDULED", endsAt: definitelyPast })).toBe(
      "선택한 클래스는 이미 종료되었습니다.",
    );
  });
});

describe("resolveChildPrefillWarning", () => {
  it("returns a not-found message when the child does not exist", () => {
    expect(resolveChildPrefillWarning(null)).toBe("선택한 아이를 찾을 수 없습니다.");
  });

  it("returns an inactive message when the child is inactive", () => {
    expect(resolveChildPrefillWarning({ isActive: false })).toBe("선택한 아이는 비활성 상태입니다.");
  });

  it("returns null when active but absent from candidates for an unknown reason", () => {
    expect(resolveChildPrefillWarning({ isActive: true })).toBeNull();
  });
});
