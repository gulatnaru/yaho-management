import type { Prisma } from "@prisma/client";

export type ChildListStatus = "active" | "inactive" | "all";

export type ChildListParams = {
  q?: string;
  status: ChildListStatus;
};

/**
 * 아이 목록 조회용 where 절을 만드는 순수 함수.
 * status에 따라 isActive 조건을, q가 있으면 name/guardianPhone OR 검색 조건을 추가한다.
 */
export function buildChildListWhere(params: ChildListParams): Prisma.ChildWhereInput {
  const where: Prisma.ChildWhereInput = {};

  if (params.status === "active") {
    where.isActive = true;
  } else if (params.status === "inactive") {
    where.isActive = false;
  }

  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { guardianPhone: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}
