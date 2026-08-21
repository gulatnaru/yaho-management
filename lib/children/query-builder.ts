import type { Prisma } from "@prisma/client";

export type ChildListStatus = "active" | "inactive" | "all";

export type ChildListParams = {
  q?: string;
  status: ChildListStatus;
  birthDate?: string;
};

/**
 * 아이 목록 조회용 where 절을 만드는 순수 함수.
 * status에 따라 isActive 조건을, q가 있으면 name/guardianPhone OR 검색 조건을,
 * birthDate(YYYY-MM-DD)가 유효하면 정확히 일치하는 생년월일 조건을 추가한다.
 * birthDate 파싱에 실패하면(유효하지 않은 날짜 문자열) 조건 없이 무시한다.
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

  const birthDate = params.birthDate?.trim();
  if (birthDate) {
    const parsed = new Date(birthDate);
    if (!Number.isNaN(parsed.getTime())) {
      where.birthDate = parsed;
    }
  }

  return where;
}
