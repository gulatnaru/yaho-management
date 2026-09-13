import { z } from "zod";
import {
  CLASS_CAPACITY_DEFAULT,
  CLASS_CAPACITY_MAX,
  CLASS_CAPACITY_MIN,
} from "@/lib/classes/capacity";
import { combineKstToUtc } from "@/lib/classes/datetime";
import { generateRecurringClassDates } from "@/lib/classes/recurrence";

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

const classCommonFields = {
  programId: z.string().trim().min(1, "프로그램을 선택해주세요"),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  location: z.string().trim().min(1, "장소를 입력해주세요"),
  capacity: z.coerce
    .number()
    .int("정수를 입력해주세요")
    .min(CLASS_CAPACITY_MIN, `정원은 ${CLASS_CAPACITY_MIN}명 이상이어야 합니다`)
    .max(CLASS_CAPACITY_MAX, `정원은 ${CLASS_CAPACITY_MAX}명을 초과할 수 없습니다`)
    .default(CLASS_CAPACITY_DEFAULT),
  teacherIds: z
    .array(z.string().trim().min(1))
    .transform((ids) => Array.from(new Set(ids)))
    .pipe(z.array(z.string()).min(1, "선생님을 1명 이상 배정해주세요")),
  memo: z.string().optional(),
  insured: z.boolean().default(false),
  insurer: z.string().trim().max(200).optional(),
  insurancePolicyNo: z.string().trim().max(200).optional(),
  safetyMemo: z.string().trim().max(2000).optional(),
};

export const classInputSchema = z
  .object({
    ...classCommonFields,
    date: dateStringSchema,
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

const weekdaySchema = z
  .union([z.number(), z.string().regex(/^[0-6]$/, "유효한 요일을 선택해주세요").transform(Number)])
  .pipe(z.number().int().min(0).max(6));

const recurringClassRawInputSchema = z
  .object({
    ...classCommonFields,
    repeatStartDate: dateStringSchema,
    repeatEndDate: dateStringSchema,
    weekdays: z.array(weekdaySchema),
  })
  .superRefine((data, context) => {
    const recurrence = generateRecurringClassDates(data);
    if (!recurrence.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [recurrence.field],
        message: recurrence.message,
      });
    }

    const hasTimeShape = /^\d{2}:\d{2}$/.test(data.startTime) && /^\d{2}:\d{2}$/.test(data.endTime);
    const startsAt = hasTimeShape ? combineKstToUtc("2000-01-01", data.startTime) : null;
    const endsAt = hasTimeShape ? combineKstToUtc("2000-01-01", data.endTime) : null;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "종료 시간은 시작 시간보다 나중이어야 합니다",
      });
    }
  });

export const recurringClassInputSchema = recurringClassRawInputSchema.transform((data) => {
  const recurrence = generateRecurringClassDates(data);
  if (!recurrence.success) {
    // superRefine 에서 이미 같은 입력을 거부하므로 정상 parse 경로에서는 도달하지 않는다.
    throw new Error("반복 클래스 날짜 계산에 실패했습니다");
  }

  return {
    ...data,
    weekdays: recurrence.weekdays,
    targetDates: recurrence.dates,
  };
});

export type RecurringClassInput = z.infer<typeof recurringClassInputSchema>;

export const classRegistrationModeSchema = z.enum(["single", "recurring"]);
export type ClassRegistrationMode = z.infer<typeof classRegistrationModeSchema>;

/** 브라우저와 Server Action이 같은 반복 등록 입력 변환을 사용한다. 생성 날짜는 포함하지 않는다. */
export function getRecurringClassFormInput(formData: FormData) {
  return {
    programId: formData.get("programId"),
    repeatStartDate: formData.get("repeatStartDate"),
    repeatEndDate: formData.get("repeatEndDate"),
    weekdays: formData
      .getAll("weekdays")
      .filter((value): value is string => typeof value === "string"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    location: formData.get("location"),
    capacity: formData.get("capacity") || undefined,
    teacherIds: formData
      .getAll("teacherIds")
      .filter((value): value is string => typeof value === "string"),
    memo: formData.get("memo") || undefined,
    insured: formData.get("insured") === "on",
    insurer: formData.get("insurer") || undefined,
    insurancePolicyNo: formData.get("insurancePolicyNo") || undefined,
    safetyMemo: formData.get("safetyMemo") || undefined,
  };
}

export const cancelClassInputSchema = z.object({
  cancelReason: z.enum(["WEATHER", "SAFETY", "MINIMUM_ENROLLMENT", "OPERATION", "OTHER"], {
    errorMap: () => ({ message: "취소 사유를 선택해주세요" }),
  }),
  cancelDetail: z.string().optional(),
});

export type CancelClassInput = z.infer<typeof cancelClassInputSchema>;
