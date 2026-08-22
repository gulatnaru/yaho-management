import { describe, expect, it } from "vitest";
import { cancelClassInputSchema, classInputSchema } from "@/lib/validation/class";

const baseInput = {
  programId: "program-1",
  date: "2026-09-05",
  startTime: "09:00",
  endTime: "11:00",
  location: "실외 운동장",
  teacherIds: ["teacher-1"],
};

describe("classInputSchema", () => {
  it("rejects when required fields are missing", () => {
    const result = classInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects when endTime is before startTime", () => {
    const result = classInputSchema.safeParse({ ...baseInput, startTime: "11:00", endTime: "09:00" });
    expect(result.success).toBe(false);
  });

  it("rejects when endTime equals startTime", () => {
    const result = classInputSchema.safeParse({ ...baseInput, startTime: "09:00", endTime: "09:00" });
    expect(result.success).toBe(false);
  });

  it("rejects capacity of 9 or more", () => {
    const result = classInputSchema.safeParse({ ...baseInput, capacity: 9 });
    expect(result.success).toBe(false);
  });

  it("defaults capacity to 8 when omitted", () => {
    const result = classInputSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capacity).toBe(8);
    }
  });

  it("rejects an empty teacherIds array with a clear message", () => {
    const result = classInputSchema.safeParse({ ...baseInput, teacherIds: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.flatten().fieldErrors.teacherIds ?? [];
      expect(messages).toContain("선생님을 1명 이상 배정해주세요");
    }
  });

  it("accepts a single teacherId", () => {
    const result = classInputSchema.safeParse({ ...baseInput, teacherIds: ["teacher-1"] });
    expect(result.success).toBe(true);
  });

  it("accepts 5 or more teacherIds — there is no upper bound (regression guard)", () => {
    const result = classInputSchema.safeParse({
      ...baseInput,
      teacherIds: ["t1", "t2", "t3", "t4", "t5"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teacherIds).toHaveLength(5);
    }
  });

  it("dedupes teacherIds", () => {
    const result = classInputSchema.safeParse({ ...baseInput, teacherIds: ["teacher-1", "teacher-1"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teacherIds).toEqual(["teacher-1"]);
    }
  });

  // 버그 리그레션: 09:00~11:00 (시작 < 종료) 은 항상 통과해야 한다. 사용자가 "종료시간이
  // 시작시간보다 나중이어야 한다"는 오류를 봤던 실제 원인은 이 스키마/combineKstToUtc 자체의
  // 로직 결함이 아니라(둘 다 KST 고정 오프셋을 동일하게 적용하므로 순서가 보존된다),
  // React 19 Server Action 폼이 1차 제출 실패 후 uncontrolled 필드를 리셋해 재제출 시 값이
  // 달라졌기 때문이었다(actions.ts 의 `values` 보존 처리로 별도 수정, class-form.tsx 참고).
  // 이 테스트는 스키마 로직 자체가 항상 정상임을 회귀 검증한다.
  it("accepts startTime=09:00 and endTime=11:00 (regression: reported as falsely rejected)", () => {
    const result = classInputSchema.safeParse({
      ...baseInput,
      date: "2026-09-05",
      startTime: "09:00",
      endTime: "11:00",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startsAt.getTime()).toBeLessThan(result.data.endsAt.getTime());
    }
  });

  // Minor 리뷰 이슈: 형식만 검사하는 정규식(\d{4}-\d{2}-\d{2})은 2026-02-30 같은 존재하지 않는
  // 캘린더 날짜를 통과시키고, combineKstToUtc 의 Date.UTC 가 이를 조용히 다음 달로 롤오버시킨다.
  // 서버는 브라우저 type="date" 피커를 신뢰하면 안 되므로 라운드트립 검증을 refine 으로 추가했다.
  it("rejects 2026-02-30 (a day that does not exist in February)", () => {
    const result = classInputSchema.safeParse({ ...baseInput, date: "2026-02-30" });
    expect(result.success).toBe(false);
  });

  it("rejects 2026-13-01 (a month that does not exist)", () => {
    const result = classInputSchema.safeParse({ ...baseInput, date: "2026-13-01" });
    expect(result.success).toBe(false);
  });

  it("accepts 2028-02-29 (a valid leap day)", () => {
    const result = classInputSchema.safeParse({ ...baseInput, date: "2028-02-29" });
    expect(result.success).toBe(true);
  });

  it("rejects 2027-02-29 (2027 is not a leap year, so this day does not exist)", () => {
    const result = classInputSchema.safeParse({ ...baseInput, date: "2027-02-29" });
    expect(result.success).toBe(false);
  });

  it("combines date/startTime/endTime into startsAt/endsAt in UTC", () => {
    const result = classInputSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startsAt.toISOString()).toBe("2026-09-05T00:00:00.000Z");
      expect(result.data.endsAt.toISOString()).toBe("2026-09-05T02:00:00.000Z");
    }
  });
});

describe("cancelClassInputSchema", () => {
  it.each(["WEATHER", "SAFETY", "MINIMUM_ENROLLMENT", "OPERATION", "OTHER"])(
    "accepts a valid cancel reason code: %s",
    (cancelReason) => {
      const result = cancelClassInputSchema.safeParse({ cancelReason });
      expect(result.success).toBe(true);
    },
  );

  it("accepts an optional cancelDetail alongside a valid reason", () => {
    const result = cancelClassInputSchema.safeParse({
      cancelReason: "OTHER",
      cancelDetail: "인근 도로 공사로 접근 불가",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cancelDetail).toBe("인근 도로 공사로 접근 불가");
    }
  });

  it("rejects a cancel reason code outside the enum", () => {
    const result = cancelClassInputSchema.safeParse({ cancelReason: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing cancel reason", () => {
    const result = cancelClassInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
