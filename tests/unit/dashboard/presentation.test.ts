import { describe, expect, it } from "vitest";
import { getDashboardReservationLabel } from "@/server/dashboard/presentation";

describe("dashboard reservation labels", () => {
  it("distinguishes attendance history retained after cancellation", () => {
    expect(getDashboardReservationLabel("CANCELLED", "PRESENT")).toBe("참여완료 후 취소");
    expect(getDashboardReservationLabel("CANCELLED", "ABSENT")).toBe("노쇼 후 취소");
  });

  it("labels active operation states", () => {
    expect(getDashboardReservationLabel("RESERVED", null)).toBe("예약됨");
    expect(getDashboardReservationLabel("COMPLETED", "PRESENT")).toBe("참여완료");
    expect(getDashboardReservationLabel("NO_SHOW", "ABSENT")).toBe("노쇼");
  });
});
