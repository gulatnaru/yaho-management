import { describe, expect, it } from "vitest";
import {
  getChildHistoryClassLabel,
  getChildHistoryReservationLabel,
} from "@/lib/children/history";

const NOW = new Date("2026-09-11T03:00:00.000Z");

describe("child history presentation", () => {
  it("keeps class cancellation separate from time-based completion", () => {
    expect(
      getChildHistoryClassLabel({ status: "CANCELLED", endsAt: new Date("2099-01-01") }, NOW),
    ).toBe("수업 취소");
    expect(
      getChildHistoryClassLabel({ status: "SCHEDULED", endsAt: new Date("2026-09-11T02:59:59Z") }, NOW),
    ).toBe("수업 완료");
    expect(
      getChildHistoryClassLabel({ status: "SCHEDULED", endsAt: NOW }, NOW),
    ).toBe("수업 예정");
  });

  it.each([
    ["RESERVED", "예약됨"],
    ["CANCELLED", "예약 취소"],
    ["COMPLETED", "참여완료"],
    ["NO_SHOW", "노쇼"],
  ] as const)("maps raw reservation status %s independently", (status, label) => {
    expect(getChildHistoryReservationLabel(status)).toBe(label);
  });
});
