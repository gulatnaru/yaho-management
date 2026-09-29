import { describe, expect, it } from "vitest";
import {
  applicationConfirmSchema,
  applicationResolutionSchema,
  isCalendarDate,
  reservationApplicationSubmissionSchema,
} from "@/lib/validation/reservation-application";

// 합성 테스트 데이터만 사용한다(실제 개인정보 아님).
function formInput(overrides: Record<string, unknown> = {}) {
  return {
    childName: "테스트아이",
    childBirthDate: "2019-05-01",
    childGender: "FEMALE",
    guardianName: "테스트보호자",
    guardianPhone: "010-0000-0000",
    requestNote: "",
    privacyConsent: "on",
    photoShareConsent: "on",
    photoMarketingConsent: null,
    ...overrides,
  };
}

function fieldErrors(overrides: Record<string, unknown>) {
  const result = reservationApplicationSubmissionSchema.safeParse(formInput(overrides));
  expect(result.success).toBe(false);
  return result.success ? {} : result.error.flatten().fieldErrors;
}

describe("reservation application submission schema", () => {
  it("accepts required fields and normalizes optional values", () => {
    const result = reservationApplicationSubmissionSchema.safeParse(formInput());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      childName: "테스트아이",
      childBirthDate: "2019-05-01",
      childGender: "FEMALE",
      guardianName: "테스트보호자",
      guardianPhone: "010-0000-0000",
      privacyConsent: true,
      photoShareConsent: true,
      photoMarketingConsent: false,
    });
    expect(result.data.requestNote).toBeUndefined();
  });

  it("allows 선택 안 함 as an explicit gender choice", () => {
    const result = reservationApplicationSubmissionSchema.safeParse(formInput({ childGender: "UNSPECIFIED" }));
    expect(result.success).toBe(true);
  });

  it("requires every identity field", () => {
    const errors = fieldErrors({
      childName: null,
      childBirthDate: null,
      childGender: null,
      guardianName: null,
      guardianPhone: null,
    });

    expect(errors.childName?.[0]).toBe("아이 이름을 입력해주세요");
    expect(errors.childBirthDate?.[0]).toBe("생년월일을 입력해주세요");
    expect(errors.childGender?.[0]).toBe("성별을 선택해주세요");
    expect(errors.guardianName?.[0]).toBe("보호자 이름을 입력해주세요");
    expect(errors.guardianPhone?.[0]).toBe("보호자 연락처를 입력해주세요");
  });

  it("rejects blank text after trimming", () => {
    const errors = fieldErrors({ childName: "   ", guardianName: "  " });
    expect(errors.childName?.[0]).toBe("아이 이름을 입력해주세요");
    expect(errors.guardianName?.[0]).toBe("보호자 이름을 입력해주세요");
  });

  it("rejects impossible and future birth dates", () => {
    expect(fieldErrors({ childBirthDate: "2019-02-30" }).childBirthDate?.[0]).toBe("유효한 날짜가 아닙니다");
    expect(fieldErrors({ childBirthDate: "2999-01-01" }).childBirthDate?.[0]).toBe(
      "미래 날짜는 입력할 수 없습니다",
    );
  });

  it("reuses the child phone rules", () => {
    expect(fieldErrors({ guardianPhone: "010-abcd-0000" }).guardianPhone?.[0]).toBe(
      "전화번호 형식이 올바르지 않습니다 (숫자, 하이픈만 가능)",
    );
    expect(fieldErrors({ guardianPhone: "---------" }).guardianPhone?.[0]).toBe(
      "전화번호는 숫자를 9자 이상 포함해야 합니다",
    );
  });

  it("requires the two mandatory consents and keeps marketing optional", () => {
    const errors = fieldErrors({ privacyConsent: null, photoShareConsent: null });
    expect(errors.privacyConsent?.[0]).toBe("개인정보 수집·이용에 동의해주세요");
    expect(errors.photoShareConsent?.[0]).toBe("활동 사진 촬영 및 보호자 공유에 동의해주세요");

    const withMarketing = reservationApplicationSubmissionSchema.safeParse(
      formInput({ photoMarketingConsent: "on" }),
    );
    expect(withMarketing.success && withMarketing.data.photoMarketingConsent).toBe(true);
  });

  it("limits free text lengths", () => {
    expect(fieldErrors({ childName: "가".repeat(51) }).childName?.[0]).toBe("아이 이름은 50자 이하로 입력해주세요");
    expect(fieldErrors({ requestNote: "가".repeat(1001) }).requestNote?.[0]).toBe(
      "요청사항은 1000자 이하로 입력해주세요",
    );
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates only", () => {
    expect(isCalendarDate("2020-02-29")).toBe(true);
    expect(isCalendarDate("2019-02-29")).toBe(false);
    expect(isCalendarDate("2019-13-01")).toBe(false);
    expect(isCalendarDate("20190501")).toBe(false);
  });
});

describe("admin application schemas", () => {
  it("requires a reason to reject or cancel", () => {
    const result = applicationResolutionSchema.safeParse({ resolutionNote: "  " });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.resolutionNote?.[0]).toBe("사유를 입력해주세요");
    expect(applicationResolutionSchema.safeParse({ resolutionNote: "정원 마감" }).success).toBe(true);
  });

  it("requires a child choice and treats a blank memo as absent", () => {
    const missing = applicationConfirmSchema.safeParse({ childChoice: null, memo: null });
    expect(missing.success).toBe(false);

    const parsed = applicationConfirmSchema.safeParse({ childChoice: "NEW", memo: "   " });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ childChoice: "NEW", memo: undefined });
  });
});
