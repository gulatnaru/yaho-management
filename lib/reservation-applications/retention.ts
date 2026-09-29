import type { ReservationApplicationStatus } from "@prisma/client";
import { formatKstDate } from "@/lib/classes/datetime";

/**
 * 개인정보 보관기간(ADR-055~057). DB 에 값을 저장하지 않고 조회 시점에 계산한다(ADR-026 과 같은 방식).
 * - 확정되지 않은(처리 대기·반려·취소) 신청: 해당 수업일(KST)로부터 1년
 * - 확정 고객(확정된 신청과 그 아이의 개인정보·동의이력): 아이의 마지막 예약 수업일(KST)로부터 5년.
 *   유효한 예약이 하나도 없으면 확정된 신청의 대상 클래스 수업일을 쓴다.
 * 만료일 당일까지 보관하고, 그다음 날부터 파기 대상이다.
 * 계약·결제·환불 거래기록(Payment/PaymentItem/Refund)은 이 보관기간과 별도로 법령 기준을 따른다.
 */
export const UNCONFIRMED_APPLICATION_RETENTION_YEARS = 1;
export const CONFIRMED_CUSTOMER_RETENTION_YEARS = 5;

/** "YYYY-MM-DD"에 years 년을 더한다. 없는 날짜(2월 29일 → 평년)는 그 달의 마지막 날로 맞춘다. */
export function addYearsToKstDate(kstDate: string, years: number): string {
  const [year, month, day] = kstDate.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export type ApplicationRetentionBasis = "CLASS_DATE" | "LAST_RESERVED_CLASS_DATE";

export type ApplicationRetention = {
  basis: ApplicationRetentionBasis;
  /** 기준일(KST, YYYY-MM-DD) */
  basisDate: string;
  /** 보관 만료일(KST, YYYY-MM-DD). 이 날짜까지 보관한다. */
  retainUntil: string;
};

/**
 * @param lastReservedClassAt 확정된 신청일 때 연결된 아이의 마지막 유효 예약 클래스 시작 시각
 *   (lib/reservation-applications/last-reserved-class.ts). 유효한 예약이 없으면 null 이다.
 */
/**
 * 확정 고객의 보관 만료일. 마지막 유효 예약 수업일이 있으면 그 날, 없으면 fallbackClassAt(확정된 신청의 대상 클래스)을 쓴다.
 * 둘 다 없으면 확정 고객 기준을 적용할 수 없으므로 null 이다.
 */
export function computeConfirmedCustomerRetention(input: {
  lastReservedClassAt: Date | null;
  fallbackClassAt: Date | null;
}): ApplicationRetention | null {
  const basisAt = input.lastReservedClassAt ?? input.fallbackClassAt;
  if (!basisAt) return null;
  const basisDate = formatKstDate(basisAt);
  return {
    basis: "LAST_RESERVED_CLASS_DATE",
    basisDate,
    retainUntil: addYearsToKstDate(basisDate, CONFIRMED_CUSTOMER_RETENTION_YEARS),
  };
}

export function computeApplicationRetention(input: {
  status: ReservationApplicationStatus;
  classStartsAt: Date;
  lastReservedClassAt: Date | null;
}): ApplicationRetention {
  if (input.status === "CONFIRMED") {
    // fallbackClassAt 이 항상 있으므로 null 이 될 수 없다.
    return computeConfirmedCustomerRetention({
      lastReservedClassAt: input.lastReservedClassAt,
      fallbackClassAt: input.classStartsAt,
    })!;
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
