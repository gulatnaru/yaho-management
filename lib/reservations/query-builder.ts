import type { Prisma } from "@prisma/client";
import { combineKstToUtc } from "@/lib/classes/datetime";

export type ReservationListStatus = "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "all";

export type ReservationListParams = {
  childName?: string;
  programName?: string;
  status?: ReservationListStatus;
  dateFrom?: string;
  dateTo?: string;
};

const VALID_RESERVATION_LIST_STATUSES: ReservationListStatus[] = [
  "RESERVED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
  "all",
];

/**
 * 예약 목록 조회 쿼리스트링의 status 값을 파싱하는 순수 함수.
 * ADR-022: 목록 기본 필터는 "지금 처리해야 할 것"만 보여준다 — 예약도 기본값은 RESERVED.
 * 알 수 없는 값이거나 값이 없으면 기본값 "RESERVED" 로 폴백한다.
 */
export function parseReservationListStatus(value?: string): ReservationListStatus {
  return (VALID_RESERVATION_LIST_STATUSES as string[]).includes(value ?? "")
    ? (value as ReservationListStatus)
    : "RESERVED";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 예약 목록 조회용 where 절을 만드는 순수 함수.
 * dateFrom/dateTo 는 classSchedule.startsAt 기준(KST 기준 날짜 문자열 "YYYY-MM-DD")이다.
 * childName/programName 은 각각 child.name / classSchedule.program.name 의 contains(insensitive) 관계 필터다.
 *
 * status 는 화면 표시 상태(getReservationDisplayStatus) 기준으로 해석한다 — "RESERVED"/"COMPLETED" 필터는
 * 둘 다 DB status="RESERVED" 를 전제로 소속 클래스의 endsAt 을 now 와 비교해 나눈다.
 * "CANCELLED"/"NO_SHOW"/"all" 은 시간 조건 없이 기존대로 동작한다.
 */
export function buildReservationListWhere(
  params: ReservationListParams,
  now: Date = new Date(),
): Prisma.ReservationWhereInput {
  const where: Prisma.ReservationWhereInput = {};

  if (params.status === "RESERVED") {
    where.status = "RESERVED";
  } else if (params.status === "COMPLETED") {
    where.status = "RESERVED";
  } else if (params.status && params.status !== "all") {
    where.status = params.status;
  }

  const childName = params.childName?.trim();
  if (childName) {
    where.child = { name: { contains: childName, mode: "insensitive" } };
  }

  const startsAt: Prisma.DateTimeFilter = {};
  if (params.dateFrom) {
    startsAt.gte = combineKstToUtc(params.dateFrom, "00:00");
  }
  if (params.dateTo) {
    const dateToStart = combineKstToUtc(params.dateTo, "00:00");
    startsAt.lt = new Date(dateToStart.getTime() + MS_PER_DAY);
  }

  const programName = params.programName?.trim();
  const hasStartsAtFilter = Object.keys(startsAt).length > 0;

  const endsAt: Prisma.DateTimeFilter = {};
  if (params.status === "RESERVED") {
    endsAt.gte = now;
  } else if (params.status === "COMPLETED") {
    endsAt.lt = now;
  }
  const hasEndsAtFilter = Object.keys(endsAt).length > 0;

  if (programName || hasStartsAtFilter || hasEndsAtFilter) {
    where.classSchedule = {
      ...(programName ? { program: { name: { contains: programName, mode: "insensitive" } } } : {}),
      ...(hasStartsAtFilter ? { startsAt } : {}),
      ...(hasEndsAtFilter ? { endsAt } : {}),
    };
  }

  return where;
}
