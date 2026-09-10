import { describe, expect, it } from "vitest";
import { getAttendanceLabel, groupClassParticipants } from "@/lib/reservations/participants";

describe("class participant presentation", () => {
  it("groups RESERVED/COMPLETED/NO_SHOW separately from CANCELLED", () => {
    const items = [
      { id: "reserved", status: "RESERVED" as const },
      { id: "completed", status: "COMPLETED" as const },
      { id: "no-show", status: "NO_SHOW" as const },
      { id: "cancelled", status: "CANCELLED" as const },
    ];

    const result = groupClassParticipants(items);
    expect(result.participants.map((item) => item.id)).toEqual(["reserved", "completed", "no-show"]);
    expect(result.cancelled.map((item) => item.id)).toEqual(["cancelled"]);
  });

  it.each([
    ["PRESENT", "참석"],
    ["ABSENT", "불참"],
    [null, "출결 미처리"],
  ] as const)("maps attendance %s without consulting reservation/payment status", (attendance, label) => {
    expect(getAttendanceLabel(attendance)).toBe(label);
  });
});
