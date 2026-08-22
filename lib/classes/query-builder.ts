import type { Prisma } from "@prisma/client";
import { combineKstToUtc } from "@/lib/classes/datetime";

export type ClassListStatus = "SCHEDULED" | "CANCELLED" | "COMPLETED" | "all";

export type ClassListParams = {
  dateFrom?: string;
  dateTo?: string;
  status?: ClassListStatus;
};

const VALID_CLASS_LIST_STATUSES: ClassListStatus[] = ["SCHEDULED", "CANCELLED", "COMPLETED", "all"];

/**
 * 클래스 목록 조회 쿼리스트링의 status 값을 파싱하는 순수 함수.
 * 알 수 없는 값이거나 값이 없으면 기본값 "SCHEDULED" 로 폴백한다.
 */
export function parseClassListStatus(value?: string): ClassListStatus {
  return (VALID_CLASS_LIST_STATUSES as string[]).includes(value ?? "")
    ? (value as ClassListStatus)
    : "SCHEDULED";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 클래스 목록 조회용 where 절을 만드는 순수 함수.
 * ADR-021: 검색은 날짜(기간)와 상태 2개 항목뿐이다 — 프로그램/장소/선생님 검색은 만들지 않는다.
 * dateFrom/dateTo 는 KST 기준 날짜 문자열("YYYY-MM-DD")이다.
 */
export function buildClassListWhere(params: ClassListParams): Prisma.ClassScheduleWhereInput {
  const where: Prisma.ClassScheduleWhereInput = {};

  if (params.status && params.status !== "all") {
    where.status = params.status;
  }

  const startsAt: Prisma.DateTimeFilter = {};
  if (params.dateFrom) {
    startsAt.gte = combineKstToUtc(params.dateFrom, "00:00");
  }
  if (params.dateTo) {
    const dateToStart = combineKstToUtc(params.dateTo, "00:00");
    startsAt.lt = new Date(dateToStart.getTime() + MS_PER_DAY);
  }

  if (Object.keys(startsAt).length > 0) {
    where.startsAt = startsAt;
  }

  return where;
}
