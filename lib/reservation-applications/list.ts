import type { Prisma, ReservationApplicationStatus } from "@prisma/client";

export const APPLICATION_LIST_PAGE_SIZE = 20;

export type ApplicationListStatus = ReservationApplicationStatus | "all";

const LIST_STATUSES: readonly ApplicationListStatus[] = ["SUBMITTED", "CONFIRMED", "REJECTED", "CANCELLED", "all"];

/** 기본 필터는 처리 대기(SUBMITTED)다 — "지금 처리해야 할 것만" 원칙(ADR-022). */
export function parseApplicationListStatus(value: string | undefined): ApplicationListStatus {
  return LIST_STATUSES.find((status) => status === value) ?? "SUBMITTED";
}

export function parseApplicationListPage(value: string | undefined): number {
  const page = value ? Number.parseInt(value, 10) : 1;
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function buildApplicationListWhere(status: ApplicationListStatus): Prisma.ReservationApplicationWhereInput {
  return status === "all" ? {} : { status };
}

/** 처리 대기는 클래스가 가까운 순(먼저 처리할 것 위로), 그 외는 최근 신청 순. */
export function buildApplicationListOrderBy(
  status: ApplicationListStatus,
): Prisma.ReservationApplicationOrderByWithRelationInput[] {
  if (status === "SUBMITTED") {
    return [{ classSchedule: { startsAt: "asc" } }, { submittedAt: "asc" }, { id: "asc" }];
  }
  return [{ submittedAt: "desc" }, { id: "desc" }];
}
