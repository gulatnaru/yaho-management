"use server";

import { prisma } from "@/lib/db/prisma";
import { readFormString } from "@/lib/forms/form-data";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import {
  APPLICATION_CLOSED_MESSAGE,
  APPLICATION_RETRY_MESSAGE,
} from "@/lib/reservation-applications/constants";
import {
  ApplicationClosedError,
  ApplicationRateLimitedError,
  describeErrorForLog,
} from "@/lib/reservation-applications/errors";
import { buildLegacyApplicationAvailabilityContext } from "@/lib/reservation-applications/runtime";
import { reservationApplicationSubmissionSchema } from "@/lib/validation/reservation-application";
import { submitReservationApplicationCore } from "@/server/reservation-applications/submit";

export type ReservationApplicationFormFieldKey =
  | "childName"
  | "childBirthDate"
  | "childGender"
  | "guardianName"
  | "guardianPhone"
  | "guardianRelationship"
  | "requestNote"
  | "programTerms"
  | "privacyConsent"
  | "legalGuardianConfirmation"
  | "photoShareConsent"
  | "photoMarketingConsent"
  | "refundTerms";

export type ReservationApplicationFormValues = {
  childName?: string;
  childBirthDate?: string;
  childGender?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelationship?: string;
  requestNote?: string;
  programTerms?: boolean;
  privacyConsent?: boolean;
  legalGuardianConfirmation?: boolean;
  photoShareConsent?: boolean;
  photoMarketingConsent?: boolean;
  refundTerms?: boolean;
};

/** 검증·재확인·저장 실패. 입력값과 오류를 돌려줘 화면이 그대로 유지한다. */
type ReservationApplicationFailureState = {
  submitted?: false;
  errors?: Partial<Record<ReservationApplicationFormFieldKey, string[]>>;
  formError?: string;
  values?: ReservationApplicationFormValues;
};

/** 저장 성공. 입력값·개인정보는 담지 않는다 — 브라우저가 완료 화면으로 전체 문서 이동한다. */
type ReservationApplicationSubmittedState = {
  submitted: true;
  errors?: never;
  formError?: never;
  values?: never;
};

export type ReservationApplicationFormState = ReservationApplicationFailureState | ReservationApplicationSubmittedState;

/** 검증·서버 재확인 실패 시 입력값을 돌려준다(docs/UI-GUIDELINES.md 8). 숨은 봇 차단 칸은 돌려주지 않는다. */
function readValues(formData: FormData): ReservationApplicationFormValues {
  return {
    childName: readFormString(formData, "childName"),
    childBirthDate: readFormString(formData, "childBirthDate"),
    childGender: readFormString(formData, "childGender"),
    guardianName: readFormString(formData, "guardianName"),
    guardianPhone: readFormString(formData, "guardianPhone"),
    guardianRelationship: readFormString(formData, "guardianRelationship"),
    requestNote: readFormString(formData, "requestNote"),
    programTerms: formData.get("programTerms") === "on",
    privacyConsent: formData.get("privacyConsent") === "on",
    legalGuardianConfirmation: formData.get("legalGuardianConfirmation") === "on",
    photoShareConsent: formData.get("photoShareConsent") === "on",
    photoMarketingConsent: formData.get("photoMarketingConsent") === "on",
    refundTerms: formData.get("refundTerms") === "on",
  };
}

/**
 * 비로그인 보호자의 예약 신청 제출(ADR-052~054). 인증 없이 열리는 Server Action 이므로
 * 모든 판정을 서버에서 다시 한다. 대상 클래스는 링크 토큰으로만 결정한다.
 *
 * 성공하면 redirect() 대신 `{ submitted: true }` 만 돌려준다. redirect() 는 클라이언트 전환이라 이전 신청 페이지의
 * RSC payload 가 완료 화면 문서에 남기 때문에, 신청서가 완료 화면으로 전체 문서 이동한다(complete-navigation.ts).
 */
export async function submitReservationApplication(
  token: string,
  _previousState: ReservationApplicationFormState,
  formData: FormData,
): Promise<ReservationApplicationFormState> {
  const values = readValues(formData);

  // 봇 차단용 숨은 입력칸. 사람에게는 보이지 않으므로 값이 있으면 저장하지 않는다.
  if (readFormString(formData, "website")) {
    return { formError: APPLICATION_RETRY_MESSAGE, values };
  }

  const parsed = reservationApplicationSubmissionSchema.safeParse({
    childName: formData.get("childName"),
    childBirthDate: formData.get("childBirthDate"),
    childGender: formData.get("childGender"),
    guardianName: formData.get("guardianName"),
    guardianPhone: formData.get("guardianPhone"),
    guardianRelationship: formData.get("guardianRelationship"),
    requestNote: formData.get("requestNote"),
    programTerms: formData.get("programTerms"),
    privacyConsent: formData.get("privacyConsent"),
    legalGuardianConfirmation: formData.get("legalGuardianConfirmation"),
    photoShareConsent: formData.get("photoShareConsent"),
    photoMarketingConsent: formData.get("photoMarketingConsent"),
    refundTerms: formData.get("refundTerms"),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values };
  }

  try {
    await submitReservationApplicationCore(prisma, {
      token,
      data: parsed.data,
      consentVersion: APPLICATION_CONSENT_CONTENT.version,
      context: await buildLegacyApplicationAvailabilityContext(prisma, new Date()),
    });
  } catch (error) {
    if (error instanceof ApplicationClosedError) {
      return { formError: APPLICATION_CLOSED_MESSAGE, values };
    }
    if (error instanceof ApplicationRateLimitedError) {
      return { formError: APPLICATION_RETRY_MESSAGE, values };
    }
    // 입력값이 섞일 수 있는 오류 메시지는 기록하지 않는다(20장).
    console.error("[reservation-applications] failed to submit application:", describeErrorForLog(error));
    return { formError: "신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", values };
  }

  return { submitted: true };
}
