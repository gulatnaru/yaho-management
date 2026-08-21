import type { Prisma } from "@prisma/client";

export type TeacherListStatus = "active" | "inactive" | "all";

export type TeacherListParams = {
  q?: string;
  status: TeacherListStatus;
};

/**
 * 선생님 목록 조회용 where 절을 만드는 순수 함수.
 * status에 따라 isActive 조건을, q가 있으면 name contains 검색 조건을 추가한다.
 * 선생님은 이름+상태만 검색한다(연락처 검색 없음).
 */
export function buildTeacherListWhere(params: TeacherListParams): Prisma.TeacherWhereInput {
  const where: Prisma.TeacherWhereInput = {};

  if (params.status === "active") {
    where.isActive = true;
  } else if (params.status === "inactive") {
    where.isActive = false;
  }

  const q = params.q?.trim();
  if (q) {
    where.name = { contains: q, mode: "insensitive" };
  }

  return where;
}
