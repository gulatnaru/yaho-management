import type { ReservationApplicationStatus } from "@prisma/client";
import { formatKstDate } from "@/lib/classes/datetime";

/**
 * 예약 신청 개인정보의 보관기간(ADR-055). DB 에 값을 저장하지 않고 조회 시점에 계산한다(ADR-026 과 같은 방식).
 * - 확정되지 않은(처리 대기·반려·취소) 신청: 해당 수업일(KST)로부터 1년
 * - 확정된 신청: 연결된 아이의 마지막 프로그램 이용일(KST)로부터 3년
 * 만료일 당일까지 보관하고, 그다음 날부터 파기 대상이다.
 */
export const UNCONFIRMED_APPLICATION_RETENTION_YEARS = 1;
export const CONFIRMED_APPLICATION_RETENTION_YEARS = 3;

/** "YYYY-MM-DD"에 years 년을 더한다. 없는 날짜(2월 29일 → 평년)는 그 달의 마지막 날로 맞춘다. */
export function addYearsToKstDate(kstDate: string, years: number): string {
  const [year, month, day] = kstDate.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export type ApplicationRetentionBasis = "CLASS_DATE" | "LAST_PROGRAM_USE";

export type ApplicationRetention = {
  basis: ApplicationRetentionBasis;
  /** 기준일(KST, YYYY-MM-DD) */
  basisDate: string;
  /** 보관 만료일(KST, YYYY-MM-DD). 이 날짜까지 보관한다. */
  retainUntil: string;
};

/**
 * @param lastProgramUseAt 확정된 신청일 때 연결된 아이의 마지막 프로그램 이용 클래스 시작 시각.
 *   없으면 신청 클래스 시작 시각을 기준으로 삼는다.
 */
export function computeApplicationRetention(input: {
  status: ReservationApplicationStatus;
  classStartsAt: Date;
  lastProgramUseAt: Date | null;
}): ApplicationRetention {
  if (input.status === "CONFIRMED") {
    const basisAt =
      input.lastProgramUseAt && input.lastProgramUseAt > input.classStartsAt
        ? input.lastProgramUseAt
        : input.classStartsAt;
    const basisDate = formatKstDate(basisAt);
    return {
      basis: "LAST_PROGRAM_USE",
      basisDate,
      retainUntil: addYearsToKstDate(basisDate, CONFIRMED_APPLICATION_RETENTION_YEARS),
    };
  }

  const basisDate = formatKstDate(input.classStartsAt);
  return {
    basis: "CLASS_DATE",
    basisDate,
    retainUntil: addYearsToKstDate(basisDate, UNCONFIRMED_APPLICATION_RETENTION_YEARS),
  };
}

/** 오늘(KST)이 보관 만료일보다 뒤이면 파기 대상이다. */
export function isRetentionExpired(retention: Pick<ApplicationRetention, "retainUntil">, now: Date): boolean {
  return formatKstDate(now) > retention.retainUntil;
}

/** 파기 가능한 상태. 처리 대기 신청은 먼저 반려·취소한 뒤에 파기한다. */
export function isPurgeableStatus(status: ReservationApplicationStatus): boolean {
  return status !== "SUBMITTED";
}
