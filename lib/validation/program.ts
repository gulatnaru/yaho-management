import { z } from "zod";

/** 빈 문자열(폼 입력)을 undefined 로 정규화한다 — Child의 birthDate/guardianPhone optional 처리 패턴 참고. */
function emptyToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
}

const optionalNonNegativeInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int("정수를 입력해주세요").min(0, "0 이상의 정수를 입력해주세요").optional(),
);

const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int("정수를 입력해주세요").min(1, "0보다 큰 정수를 입력해주세요").optional(),
);

const priceInput = z
  .preprocess(emptyToUndefined, z.coerce.number().int("정수를 입력해주세요").min(0, "0 이상의 정수를 입력해주세요").optional())
  .transform((value) => value ?? 0);

const operationalProgramShape = {
  name: z.string().trim().min(1, "프로그램명을 입력해주세요"),
  description: z.string().optional(),
  targetAgeMin: optionalNonNegativeInt,
  targetAgeMax: optionalNonNegativeInt,
  defaultDuration: optionalPositiveInt,
  memo: z.string().optional(),
};

function hasValidAgeRange(data: { targetAgeMin?: number; targetAgeMax?: number }) {
  return data.targetAgeMin === undefined || data.targetAgeMax === undefined || data.targetAgeMin <= data.targetAgeMax;
}

export const programOperationalInputSchema = z.object(operationalProgramShape).refine(hasValidAgeRange, {
  message: "최소 대상연령은 최대 대상연령보다 클 수 없습니다",
  path: ["targetAgeMax"],
});

export const programInputSchema = z
  .object({ ...operationalProgramShape, defaultPrice: priceInput })
  .refine(hasValidAgeRange, {
    message: "최소 대상연령은 최대 대상연령보다 클 수 없습니다",
    path: ["targetAgeMax"],
  });

export type ProgramInput = z.infer<typeof programInputSchema>;
export type ProgramOperationalInput = z.infer<typeof programOperationalInputSchema>;
