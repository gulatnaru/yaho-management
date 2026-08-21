import type { Prisma } from "@prisma/client";

export type ProgramListStatus = "active" | "inactive" | "all";

export type ProgramListParams = {
  q?: string;
  status: ProgramListStatus;
};

/**
 * 프로그램 목록 조회용 where 절을 만드는 순수 함수.
 * status에 따라 Program.status 조건을, q가 있으면 name contains 검색 조건을 추가한다.
 * 프로그램은 이름만 검색한다(설명/메모/대상연령 범위 검색 없음).
 */
export function buildProgramListWhere(params: ProgramListParams): Prisma.ProgramWhereInput {
  const where: Prisma.ProgramWhereInput = {};

  if (params.status === "active") {
    where.status = "ACTIVE";
  } else if (params.status === "inactive") {
    where.status = "INACTIVE";
  }

  const q = params.q?.trim();
  if (q) {
    where.name = { contains: q, mode: "insensitive" };
  }

  return where;
}
