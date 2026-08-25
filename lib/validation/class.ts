import { z } from "zod";
import { combineKstToUtc } from "@/lib/classes/datetime";

// ADR-004: 정원 상한 8명. 서버 규칙으로만 강제하는 값이라 한 곳에서만 정의하고 export 한다
// (class-form.tsx 의 <Input max/min> 이 이 값을 그대로 import 해서 쓴다).
export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 8;

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 입력해주세요")
  .refine(
    (value) => {
      const [year, month, day] = value.split("-").map(Number);
      const utc = new Date(Date.UTC(year, month - 1, day));
      // JS Date 는 존재하지 않는 캘린더 날짜(예: 2월 30일, 13월 1일)를 다음 달/년으로 조용히
      // 롤오버시킨다. 라운드트립으로 원래 입력한 year/month/day 와 정확히 일치하는지 확인해
      // 이런 값을 걸러낸다. 브라우저 `type="date"` 피커를 신뢰하지 않는다 — 직접 POST 로
      // 잘못된 날짜가 들어올 수 있다.
      return (
        utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
      );
    },
    { message: "유효하지 않은 날짜입니다" },
  );
const timeStringSchema = z.string().regex(/^\d{2}:\d{2}$/, "시간을 입력해주세요");

export const classInputSchema = z
  .object({
    programId: z.string().trim().min(1, "프로그램을 선택해주세요"),
    date: dateStringSchema,
    startTime: timeStringSchema,
    endTime: timeStringSchema,
    location: z.string().trim().min(1, "장소를 입력해주세요"),
    capacity: z.coerce
      .number()
      .int("정수를 입력해주세요")
      .min(CAPACITY_MIN, `정원은 ${CAPACITY_MIN}명 이상이어야 합니다`)
      .max(CAPACITY_MAX, `정원은 ${CAPACITY_MAX}명을 초과할 수 없습니다`)
      .default(CAPACITY_MAX),
    teacherIds: z
      .array(z.string().trim().min(1))
      .transform((ids) => Array.from(new Set(ids)))
      .pipe(z.array(z.string()).min(1, "선생님을 1명 이상 배정해주세요")),
    memo: z.string().optional(),
    insured: z.boolean().default(false),
    insurer: z.string().trim().max(200).optional(),
    insurancePolicyNo: z.string().trim().max(200).optional(),
    safetyMemo: z.string().trim().max(2000).optional(),
  })
  .transform((data) => ({
    ...data,
    startsAt: combineKstToUtc(data.date, data.startTime),
    endsAt: combineKstToUtc(data.date, data.endTime),
  }))
  .refine((data) => data.endsAt.getTime() > data.startsAt.getTime(), {
    message: "종료 시간은 시작 시간보다 나중이어야 합니다",
    path: ["endTime"],
  });

export type ClassInput = z.infer<typeof classInputSchema>;

export const cancelClassInputSchema = z.object({
  cancelReason: z.enum(["WEATHER", "SAFETY", "MINIMUM_ENROLLMENT", "OPERATION", "OTHER"], {
    errorMap: () => ({ message: "취소 사유를 선택해주세요" }),
  }),
  cancelDetail: z.string().optional(),
});

export type CancelClassInput = z.infer<typeof cancelClassInputSchema>;
